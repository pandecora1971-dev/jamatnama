import { createHash } from "node:crypto";
import { connect } from "node:net";
import sharp from "sharp";
import { query, transaction } from "./db";
import { MIME_TYPES } from "./filetypes";
import { logError, logEvent } from "./log";
import { objectStore, type ObjectStore } from "./r2";

// Runs outside Vercel beside clamd, because ClamAV needs a long-lived host and large files exceed
// function limits. Fails closed: nothing leaves quarantine without an explicit clean verdict.
const MAX_ATTEMPTS = 5;
const SCANNER_ACTOR = ["scanner", "malware-scanner"];
type Verdict = { clean: true } | { clean: false; signature: string };
export type ScanEngine = {
  name: string;
  ping(): Promise<boolean>;
  scan(stream: ReadableStream<Uint8Array>, onChunk: (chunk: Uint8Array) => void): Promise<Verdict>;
};
function clamdCall(host: string, port: number, drive: (socket: ReturnType<typeof connect>) => Promise<void>, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    let reply = "";
    socket.setTimeout(timeoutMs, () => socket.destroy(Object.assign(Error("clamd timed out"), { code: "CLAMD_TIMEOUT" })));
    socket.on("data", (data) => (reply += data.toString("latin1")));
    socket.on("end", () => resolve(reply.replace(/\0/g, "").trim()));
    socket.on("error", reject);
    socket.on("connect", () => void drive(socket).catch((error) => socket.destroy(error)));
  });
}
const write = (socket: ReturnType<typeof connect>, data: Uint8Array | string) =>
  new Promise<void>((resolve, reject) => socket.write(data, (error) => (error ? reject(error) : resolve())));
export function clamdEngine(host = process.env.CLAMD_HOST || "127.0.0.1", port = Number(process.env.CLAMD_PORT) || 3310): ScanEngine {
  return {
    name: "clamav",
    ping: () =>
      clamdCall(host, port, (socket) => write(socket, "zPING\0"), 5000)
        .then((reply) => reply === "PONG")
        .catch(() => false),
    async scan(stream, onChunk) {
      const reply = await clamdCall(
        host,
        port,
        async (socket) => {
          await write(socket, "zINSTREAM\0");
          const reader = stream.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            onChunk(value);
            // clamd reads length-prefixed chunks; stay well below its default StreamMaxLength framing.
            for (let offset = 0; offset < value.length; offset += 1024 * 1024) {
              const chunk = value.subarray(offset, offset + 1024 * 1024);
              const length = Buffer.alloc(4);
              length.writeUInt32BE(chunk.length);
              await write(socket, length);
              await write(socket, chunk);
            }
          }
          await write(socket, Buffer.alloc(4));
        },
        30 * 60_000,
      );
      if (/^stream: OK$/.test(reply)) return { clean: true };
      const found = reply.match(/^stream: (.{1,120}) FOUND$/);
      if (found) return { clean: false, signature: found[1] };
      // Includes "INSTREAM size limit exceeded" and every other unexpected reply: never treated as clean.
      throw Object.assign(Error("clamd did not return a verdict"), { code: "CLAMD_NO_VERDICT" });
    },
  };
}
type Job = { id: string; mime: string; size_bytes: string; object_key: string; sha256: string | null; origin: string; created_at: string };
export async function claimJob(leaseMs = 30 * 60_000): Promise<Job | null> {
  const now = new Date();
  const { rows } = await query<Job>(
    `UPDATE jamatnama.evidence SET scan_attempts=scan_attempts+1,scan_lease_until=$1
     WHERE id=(SELECT id FROM jamatnama.evidence
               WHERE state='pending_scan' AND (scan_lease_until IS NULL OR scan_lease_until<$2)
               ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id,mime,size_bytes,object_key,sha256,origin,created_at`,
    [new Date(now.getTime() + leaseMs).toISOString(), now.toISOString()],
  );
  return rows[0] || null;
}
async function settle(job: Job, state: "infected" | "rejected" | "scan_error" | "clean", fields: { detail?: string; objectKey?: string; mime?: string; size?: number; sha256?: string; engine: string }) {
  const released = state === "infected" || state === "rejected" ? Number(job.size_bytes) : 0;
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE jamatnama.evidence SET state=$1,scan_detail=$2,scan_engine=$3,scanned_at=$4,scan_lease_until=NULL,
         object_key=$5,mime=$6,size_bytes=$7,sha256=COALESCE($8,sha256)
       WHERE id=$9 AND state='pending_scan'`,
      [state, fields.detail || "", fields.engine, new Date().toISOString(), fields.objectKey || job.object_key, fields.mime || job.mime, fields.size ?? Number(job.size_bytes), fields.sha256 || null, job.id],
    );
    if (!rowCount) return;
    await client.query(
      "INSERT INTO jamatnama.audit_log(actor_id,actor_name,action,target,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [...SCANNER_ACTOR, `evidence.scan.${state}`, job.id, JSON.stringify({ engine: fields.engine }), new Date().toISOString()],
    );
    if (released) await client.query("UPDATE jamatnama.upload_budget SET bytes=GREATEST(0,bytes-$1) WHERE period='total'", [released]);
  });
}
async function sanitizeImage(bytes: Uint8Array) {
  // Decoding and re-encoding removes EXIF, GPS and any payload appended to the image.
  return sharp(bytes, { limitInputPixels: 100_000_000 }).rotate().webp({ quality: 85 }).toBuffer();
}
export async function processJob(job: Job, engine: ScanEngine, store: ObjectStore = objectStore()) {
  const digest = createHash("sha256");
  const chunks: Uint8Array[] = [];
  const image = job.origin === "upload" && MIME_TYPES[job.mime]?.kind === "image";
  const verdict = await engine.scan(await store.stream(job.object_key), (chunk) => {
    digest.update(chunk);
    if (image) chunks.push(chunk);
  });
  const sha256 = digest.digest("hex");
  if (!verdict.clean) {
    await store.remove(job.object_key);
    await settle(job, "infected", { detail: verdict.signature, engine: engine.name });
    return "infected";
  }
  const target = `evidence/${job.id}`;
  if (image) {
    let cleaned: Buffer;
    try {
      cleaned = await sanitizeImage(Buffer.concat(chunks));
    } catch {
      await store.remove(job.object_key);
      await settle(job, "rejected", { detail: "image_decode_failed", engine: engine.name });
      return "rejected";
    }
    const cleanHash = createHash("sha256").update(cleaned).digest("hex");
    await store.put(target, new Uint8Array(cleaned), "image/webp", { sha256: cleanHash });
    await settle(job, "clean", { objectKey: target, mime: "image/webp", size: cleaned.length, sha256: cleanHash, engine: engine.name });
  } else {
    // Migrated evidence carries the checksum taken at export; any change in storage is caught here.
    if (job.sha256 && job.sha256 !== sha256) {
      await settle(job, "scan_error", { detail: "checksum_mismatch", engine: engine.name });
      return "scan_error";
    }
    await store.copy(job.object_key, target);
    const head = await store.head(target);
    if (head?.size !== Number(job.size_bytes)) throw Object.assign(Error("copy size mismatch"), { code: "COPY_MISMATCH" });
    await settle(job, "clean", { objectKey: target, sha256, engine: engine.name });
  }
  await store.remove(job.object_key).catch((error) => logError("scanner.cleanup", error));
  return "clean";
}
/** Returns how many objects were handled; 0 means the queue is empty or clamd is unreachable. */
export async function scanBatch(engine: ScanEngine, limit = 10) {
  if (!(await engine.ping())) {
    logEvent("scanner.engine_unavailable");
    return 0;
  }
  let handled = 0;
  for (; handled < limit; handled++) {
    const job = await claimJob();
    if (!job) break;
    try {
      const outcome = await processJob(job, engine);
      logEvent(`scanner.${outcome}`, { bytes: Number(job.size_bytes) });
    } catch (error) {
      logError("scanner.job", error);
      // A failed attempt stays quarantined. Retry after a short lease, then stop for manual review.
      const attempts = await query<{ scan_attempts: number }>("SELECT scan_attempts FROM jamatnama.evidence WHERE id=$1", [job.id]);
      if ((attempts.rows[0]?.scan_attempts || 0) >= MAX_ATTEMPTS) await settle(job, "scan_error", { detail: "attempts_exhausted", engine: engine.name });
      else await query("UPDATE jamatnama.evidence SET scan_lease_until=$1 WHERE id=$2", [new Date(Date.now() + 5 * 60_000).toISOString(), job.id]);
    }
  }
  return handled;
}
