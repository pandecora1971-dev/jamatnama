import { pool, query, transaction, type Queryable } from "./db";
import {
  DEFAULT_LIMITS,
  MIME_TYPES,
  MULTIPART_THRESHOLD,
  PART_SIZE,
  SNIFF_BYTES,
  mp3AudioOffset,
  partCount,
  sniffMime,
  type UploadLimits,
} from "./filetypes";
import { objectStore } from "./r2";
import { insertReport, type NewReport } from "./reports";
import { audit, hash, random, sign, SYSTEM_ACTOR, type Actor } from "./security";
import { today } from "./shared";

// Lifecycle: incoming/<intent>/<file>  browser PUT, signed for exact type and length
//            quarantine/<file>         immutable server-side copy; validated at finalize, scanned by the worker
//            evidence/<file>           clean object, reachable only through expiring reviewer links
export const INTENT_TTL_MS = 2 * 3600_000;
export const PUT_URL_SECONDS = 900;
const INCOMING_GRACE_MS = 30 * 60_000;
const MB = 1024 * 1024, GB = 1024 * MB;
const HARD_MAX_OBJECT = 4 * GB;

export class UploadError extends Error {
  constructor(public status: number, public code: string, message: string, public fileId?: string, public retryAfter?: number) {
    super(message);
    this.name = "UploadError";
  }
}
const envMb = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(value * MB, HARD_MAX_OBJECT) : fallback;
};
export function uploadLimits(): UploadLimits {
  const maxFiles = Number(process.env.UPLOAD_MAX_FILES);
  return {
    maxFiles: maxFiles > 0 ? Math.floor(maxFiles) : DEFAULT_LIMITS.maxFiles,
    maxTotalBytes: envMb("UPLOAD_MAX_TOTAL_MB", DEFAULT_LIMITS.maxTotalBytes),
    maxBytes: {
      image: envMb("UPLOAD_MAX_IMAGE_MB", DEFAULT_LIMITS.maxBytes.image),
      document: envMb("UPLOAD_MAX_DOCUMENT_MB", DEFAULT_LIMITS.maxBytes.document),
      audio: envMb("UPLOAD_MAX_AUDIO_MB", DEFAULT_LIMITS.maxBytes.audio),
      video: envMb("UPLOAD_MAX_VIDEO_MB", DEFAULT_LIMITS.maxBytes.video),
    },
  };
}
export function budgetLimits() {
  const total = Number(process.env.UPLOAD_BUDGET_TOTAL_GB), daily = Number(process.env.UPLOAD_BUDGET_DAILY_GB);
  return { total: (total > 0 ? total : 800) * GB, daily: (daily > 0 ? daily : 40) * GB };
}
export const uploadsEnabled = () => process.env.UPLOADS_ENABLED !== "false";
/** Deterministic, so a retried finalize returns the same receipt although only its hash is stored. */
export const receiptFor = (token: string) => sign(`receipt:${token}`).slice(0, 48);

export type DeclaredFile = { mime: string; size: number };
export function checkDeclaredFiles(files: DeclaredFile[]) {
  const limits = uploadLimits();
  if (files.length > limits.maxFiles) throw new UploadError(400, "too_many_files", `সর্বোচ্চ ${limits.maxFiles}টি ফাইল দিন।`);
  let total = 0;
  for (const file of files) {
    const type = MIME_TYPES[file.mime];
    if (!type) throw new UploadError(415, "unsupported_type", "এই ধরনের ফাইল গ্রহণ করা হয় না।");
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new UploadError(400, "bad_size", "ফাইলের আকার সঠিক নয়।");
    if (file.size > limits.maxBytes[type.kind]) throw new UploadError(413, "file_too_large", "ফাইলের আকার অনুমোদিত সীমার বেশি।");
    total += file.size;
  }
  if (total > limits.maxTotalBytes) throw new UploadError(413, "total_too_large", "ফাইলগুলোর মোট আকার অনুমোদিত সীমার বেশি।");
  return total;
}
async function reserveBudget(client: Queryable, day: string, bytes: number) {
  if (!bytes) return;
  const limits = budgetLimits();
  for (const [period, limit] of [["total", limits.total], [`day:${day}`, limits.daily]] as const) {
    const { rowCount } = bytes <= limit
      ? await client.query(
          `INSERT INTO jamatnama.upload_budget(period,bytes) VALUES($1,$2)
           ON CONFLICT(period) DO UPDATE SET bytes=upload_budget.bytes+$2 WHERE upload_budget.bytes+$2<=$3`,
          [period, bytes, limit],
        )
      : { rowCount: 0 };
    if (!rowCount) throw new UploadError(503, "budget_exhausted", "এই মুহূর্তে আপলোডের সীমা পূর্ণ। পরে আবার চেষ্টা করুন বা ফাইল ছাড়া রিপোর্ট জমা দিন।", undefined, 3600);
  }
}
export async function releaseBudget(client: Queryable, day: string, bytes: number) {
  if (bytes <= 0) return;
  await client.query(
    "UPDATE jamatnama.upload_budget SET bytes=GREATEST(0,bytes-$1) WHERE period=ANY($2)",
    [bytes, ["total", `day:${day}`]],
  );
}
/** Caller has already passed the origin, rate limit, bot and one-time challenge checks. */
export async function createIntent(files: DeclaredFile[]) {
  const totalBytes = checkDeclaredFiles(files);
  if (files.length && !uploadsEnabled()) throw new UploadError(503, "uploads_disabled", "ফাইল আপলোড সাময়িকভাবে বন্ধ। ফাইল ছাড়া রিপোর্ট জমা দিতে পারেন।", undefined, 3600);
  const token = random(), intentId = random(), now = Date.now(), expiresAt = new Date(now + INTENT_TTL_MS).toISOString();
  const store = files.length ? objectStore() : null;
  const prepared: (DeclaredFile & { id: string; key: string; uploadId: string | null })[] = [];
  for (const file of files) {
    const id = random(), key = `incoming/${intentId}/${id}`;
    const multipart = file.size > MULTIPART_THRESHOLD;
    prepared.push({ id, key, ...file, uploadId: multipart ? await store!.createMultipart(key, file.mime) : null });
  }
  try {
    await transaction(async (client) => {
      const day = today();
      await client.query(
        "INSERT INTO jamatnama.submission_intents(id,token_hash,created_at,expires_at,reserved_bytes,budget_day) VALUES($1,$2,$3,$4,$5,$6)",
        [intentId, hash(token), new Date(now).toISOString(), expiresAt, totalBytes, day],
      );
      await reserveBudget(client, day, totalBytes);
      for (const file of prepared)
        await client.query(
          "INSERT INTO jamatnama.upload_files(id,intent_id,incoming_key,mime,size_bytes,multipart_upload_id,part_size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [file.id, intentId, file.key, file.mime, file.size, file.uploadId, file.uploadId ? PART_SIZE : null, new Date(now).toISOString()],
        );
    });
  } catch (error) {
    await Promise.all(prepared.filter((f) => f.uploadId).map((f) => store!.abortMultipart(f.key, f.uploadId!).catch(() => {})));
    throw error;
  }
  return {
    token,
    expiresAt,
    files: await Promise.all(
      prepared.map(async (file) =>
        file.uploadId
          ? { id: file.id, mode: "multipart" as const, partSize: PART_SIZE, partCount: partCount(file.size) }
          : { id: file.id, mode: "put" as const, ...(await store!.presignPut(file.key, file.mime, file.size, PUT_URL_SECONDS)) },
      ),
    ),
  };
}
type IntentRow = { id: string; expires_at: string; reserved_bytes: string; budget_day: string; report_id: string | null };
type FileRow = { id: string; incoming_key: string; mime: string; size_bytes: string; multipart_upload_id: string | null; part_size: string | null; state: string };
async function loadIntent(token: unknown, client: Queryable = pool(), lock = "") {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) throw new UploadError(400, "bad_token", "আপলোডের অনুমোদন সঠিক নয়।");
  const { rows } = await client.query<IntentRow>(
    `SELECT id,expires_at,reserved_bytes,budget_day,report_id FROM jamatnama.submission_intents WHERE token_hash=$1 ${lock}`,
    [hash(token)],
  );
  if (!rows[0]) throw new UploadError(404, "unknown_intent", "আপলোডের অনুমোদন পাওয়া যায়নি। ফর্মটি আবার জমা দিন।");
  return rows[0];
}
const expired = (intent: IntentRow) => Date.parse(intent.expires_at) <= Date.now();
const expiredError = () => new UploadError(410, "intent_expired", "আপলোডের সময় শেষ হয়েছে। ফর্মটি আবার জমা দিন।");
async function openIntentFile(token: unknown, fileId: unknown) {
  const intent = await loadIntent(token);
  if (intent.report_id) throw new UploadError(409, "intent_consumed", "এই আপলোড অনুমোদন আগেই ব্যবহার হয়েছে।");
  if (expired(intent)) throw expiredError();
  const { rows } = await query<FileRow>(
    "SELECT id,incoming_key,mime,size_bytes,multipart_upload_id,part_size,state FROM jamatnama.upload_files WHERE id=$1 AND intent_id=$2",
    [String(fileId), intent.id],
  );
  if (!rows[0]) throw new UploadError(403, "foreign_file", "এই ফাইলটি এই অনুমোদনের অন্তর্ভুক্ত নয়।");
  if (rows[0].state !== "issued") throw new UploadError(409, "file_closed", "এই ফাইলটি আর গ্রহণ করা যাবে না।", rows[0].id);
  return rows[0];
}
const partLength = (size: number, partSize: number, partNumber: number) => {
  const count = partCount(size, partSize);
  return partNumber < count ? partSize : size - partSize * (count - 1);
};
export async function signParts(token: unknown, fileId: unknown, partNumbers: unknown) {
  const file = await openIntentFile(token, fileId);
  if (!file.multipart_upload_id) throw new UploadError(400, "not_multipart", "এই ফাইলের জন্য অংশভিত্তিক আপলোড প্রযোজ্য নয়।", file.id);
  const size = Number(file.size_bytes), partSize = Number(file.part_size), count = partCount(size, partSize);
  if (!Array.isArray(partNumbers) || !partNumbers.length || partNumbers.length > 16 || partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > count))
    throw new UploadError(400, "bad_parts", "অংশের নম্বর সঠিক নয়।", file.id);
  const store = objectStore();
  return Promise.all(
    (partNumbers as number[]).map(async (partNumber) => ({
      partNumber,
      url: await store.presignPart(file.incoming_key, file.multipart_upload_id!, partNumber, partLength(size, partSize, partNumber), PUT_URL_SECONDS),
    })),
  );
}
async function rejectFile(file: FileRow, code: string) {
  const store = objectStore();
  await store.remove(file.incoming_key).catch(() => {});
  await store.remove(`quarantine/${file.id}`).catch(() => {});
  await query("UPDATE jamatnama.upload_files SET state='rejected',incoming_removed=true WHERE id=$1", [file.id]);
  const messages: Record<string, string> = {
    size_mismatch: "ফাইলের আকার ঘোষিত আকারের সঙ্গে মেলেনি।",
    format_mismatch: "ফাইলের আসল ধরন ঘোষিত ধরনের সঙ্গে মেলেনি।",
  };
  return new UploadError(422, code, messages[code] || "ফাইলটি গ্রহণ করা যায়নি।", file.id);
}
/** Idempotent. The part list comes from storage, so a browser cannot misreport sizes or ETags. */
export async function completeUpload(token: unknown, fileId: unknown) {
  const file = await openIntentFile(token, fileId);
  if (!file.multipart_upload_id) throw new UploadError(400, "not_multipart", "এই ফাইলের জন্য প্রযোজ্য নয়।", file.id);
  const store = objectStore();
  const size = Number(file.size_bytes), partSize = Number(file.part_size), count = partCount(size, partSize);
  const parts = await store.listParts(file.incoming_key, file.multipart_upload_id);
  if (parts === null) {
    const head = await store.head(file.incoming_key);
    if (head?.size === size) return { ok: true };
    throw new UploadError(409, "upload_incomplete", "ফাইলের আপলোড সম্পূর্ণ হয়নি।", file.id);
  }
  const seen = new Set(parts.map((p) => p.partNumber));
  if (seen.size < count || parts.length < count) throw new UploadError(409, "upload_incomplete", "ফাইলের সব অংশ আপলোড হয়নি।", file.id);
  if (parts.length > count || parts.some((p) => p.partNumber > count || p.size !== partLength(size, partSize, p.partNumber))) {
    await store.abortMultipart(file.incoming_key, file.multipart_upload_id).catch(() => {});
    throw await rejectFile(file, "size_mismatch");
  }
  await store.completeMultipart(file.incoming_key, file.multipart_upload_id, parts.sort((a, b) => a.partNumber - b.partNumber));
  return { ok: true };
}
/**
 * Copies the object to a key no signed URL can reach, then validates that exact copy. A replayed
 * browser PUT therefore cannot change what was validated, and repeating this step is harmless.
 */
async function quarantineFile(file: FileRow) {
  const store = objectStore();
  const size = Number(file.size_bytes), target = `quarantine/${file.id}`;
  let head = await store.head(target);
  if (!head) {
    const source = await store.head(file.incoming_key);
    if (!source) throw new UploadError(409, "upload_incomplete", "ফাইলের আপলোড সম্পূর্ণ হয়নি।", file.id);
    if (source.size !== size) throw await rejectFile(file, "size_mismatch");
    await store.copy(file.incoming_key, target, source.etag);
    head = await store.head(target);
  }
  if (!head || head.size !== size) throw await rejectFile(file, "size_mismatch");
  const start = await store.readRange(target, 0, SNIFF_BYTES - 1);
  const audioAt = mp3AudioOffset(start);
  const audio = audioAt && audioAt + 4096 > start.length && audioAt < size
    ? await store.readRange(target, audioAt, audioAt + SNIFF_BYTES - 1)
    : undefined;
  if (sniffMime(start, size, audio) !== file.mime) throw await rejectFile(file, "format_mismatch");
}
export type SubmissionResult = { id: string; receipt: string; status: string };
/**
 * Retry-safe and one-time: the first success binds the intent to one report. Any repeat returns
 * that same report and receipt and can never create a second report or attach other files.
 */
export async function finalizeSubmission(token: string, report: NewReport, fileIds: string[]): Promise<SubmissionResult> {
  const intent = await loadIntent(token);
  const done = (id: string): SubmissionResult => ({ id, receipt: receiptFor(token), status: "pending" });
  if (intent.report_id) return done(intent.report_id);
  if (expired(intent)) throw expiredError();
  const { rows: files } = await query<FileRow>(
    "SELECT id,incoming_key,mime,size_bytes,multipart_upload_id,part_size,state FROM jamatnama.upload_files WHERE intent_id=$1",
    [intent.id],
  );
  const chosen = [...new Set(fileIds)].map((id) => {
    const file = files.find((f) => f.id === id);
    if (!file) throw new UploadError(403, "foreign_file", "এই ফাইলটি এই অনুমোদনের অন্তর্ভুক্ত নয়।");
    if (file.state !== "issued") throw new UploadError(422, "file_rejected", "একটি ফাইল আগেই বাতিল হয়েছে। ফর্মটি আবার জমা দিন।", file.id);
    return file;
  });
  await Promise.all(chosen.map(quarantineFile));
  const usedBytes = chosen.reduce((sum, file) => sum + Number(file.size_bytes), 0);
  return transaction(async (client) => {
    const locked = await loadIntent(token, client, "FOR UPDATE");
    if (locked.report_id) return done(locked.report_id);
    const now = new Date().toISOString(), id = random();
    await insertReport(client, id, hash(receiptFor(token)), report, now);
    for (const file of chosen) {
      await client.query(
        "INSERT INTO jamatnama.evidence(id,report_id,mime,size_bytes,object_key,state,origin,created_at) VALUES($1,$2,$3,$4,$5,'pending_scan','upload',$6)",
        [file.id, id, file.mime, file.size_bytes, `quarantine/${file.id}`, now],
      );
      await client.query("UPDATE jamatnama.upload_files SET state='attached' WHERE id=$1", [file.id]);
    }
    await client.query(
      "UPDATE jamatnama.submission_intents SET report_id=$1,finalized_at=$2,reserved_bytes=$3 WHERE id=$4",
      [id, now, usedBytes, locked.id],
    );
    await releaseBudget(client, locked.budget_day, Number(locked.reserved_bytes) - usedBytes);
    await audit(SYSTEM_ACTOR, "report.submitted", id, JSON.stringify({ files: chosen.length }), client);
    return done(id);
  }).catch((error) => {
    if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "reports_fingerprint_key")
      throw new UploadError(409, "duplicate_report", "এই রিপোর্টটি আগেই জমা দেওয়া হয়েছে।");
    throw error;
  });
}
const AVAILABLE_LABEL: Record<string, string> = {
  pending_scan: "এই ফাইলের নিরাপত্তা পরীক্ষা এখনও শেষ হয়নি।",
  infected: "এই ফাইলে ক্ষতিকর উপাদান পাওয়া গেছে; এটি খোলা যাবে না।",
  rejected: "এই ফাইলটি যাচাইয়ে বাতিল হয়েছে।",
  scan_error: "এই ফাইলের নিরাপত্তা পরীক্ষা সম্পন্ন করা যায়নি।",
};
/** The audit row is written first: if it fails, no link is issued. */
export async function evidenceLink(actor: Actor, id: string) {
  const { rows } = await query<{ mime: string; state: string; object_key: string; report_id: string }>(
    "SELECT mime,state,object_key,report_id FROM jamatnama.evidence WHERE id=$1",
    [id],
  );
  const row = rows[0];
  if (!row) throw new UploadError(404, "not_found", "ফাইল পাওয়া যায়নি।");
  if (row.state !== "clean") throw new UploadError(409, row.state, AVAILABLE_LABEL[row.state] || "ফাইলটি এখন খোলা যাবে না।");
  await audit(actor, "evidence.access", id, JSON.stringify({ report: row.report_id }));
  const extension = MIME_TYPES[row.mime]?.extension || "bin";
  return objectStore().presignGet(row.object_key, `evidence.${extension}`, row.mime, 120);
}
export async function runMaintenance(batch = 100) {
  const now = Date.now(), result = { expiredIntents: 0, sweptIncoming: 0, sessions: 0, challenges: 0, rateLimits: 0, oldIntents: 0 };
  const { rows: abandoned } = await query<IntentRow>(
    "SELECT id,expires_at,reserved_bytes,budget_day,report_id FROM jamatnama.submission_intents WHERE report_id IS NULL AND expires_at<$1 ORDER BY expires_at LIMIT $2",
    [new Date(now - 10 * 60_000).toISOString(), batch],
  );
  for (const intent of abandoned) {
    const { rows: files } = await query<FileRow>("SELECT id,incoming_key,mime,size_bytes,multipart_upload_id,part_size,state FROM jamatnama.upload_files WHERE intent_id=$1", [intent.id]);
    if (files.length) {
      const store = objectStore();
      await Promise.all(files.flatMap((file) => [
        file.multipart_upload_id ? store.abortMultipart(file.incoming_key, file.multipart_upload_id).catch(() => {}) : Promise.resolve(),
        store.remove(file.incoming_key),
        store.remove(`quarantine/${file.id}`),
      ]));
    }
    await transaction(async (client) => {
      // Skip if a finalize committed after the listing above.
      const { rowCount } = await client.query("DELETE FROM jamatnama.submission_intents WHERE id=$1 AND report_id IS NULL", [intent.id]);
      if (rowCount) await releaseBudget(client, intent.budget_day, Number(intent.reserved_bytes));
    });
    result.expiredIntents++;
  }
  // Keep attached incoming objects past the signed URL's life so that replays hit If-None-Match.
  const { rows: stale } = await query<{ id: string; incoming_key: string; multipart_upload_id: string | null }>(
    `SELECT id,incoming_key,multipart_upload_id FROM jamatnama.upload_files
     WHERE (state<>'issued' AND NOT incoming_removed AND created_at<$1) LIMIT $2`,
    [new Date(now - INCOMING_GRACE_MS).toISOString(), batch],
  );
  if (stale.length) {
    const store = objectStore();
    for (const file of stale) {
      await store.remove(file.incoming_key);
      await query("UPDATE jamatnama.upload_files SET incoming_removed=true WHERE id=$1", [file.id]);
      result.sweptIncoming++;
    }
  }
  // Files the browser declared but did not attach: their bytes were already released at finalize.
  const { rows: unattached } = await query<{ id: string; incoming_key: string; multipart_upload_id: string | null }>(
    `SELECT f.id,f.incoming_key,f.multipart_upload_id FROM jamatnama.upload_files f JOIN jamatnama.submission_intents i ON i.id=f.intent_id
     WHERE f.state='issued' AND i.report_id IS NOT NULL AND i.expires_at<$1 LIMIT $2`,
    [new Date(now).toISOString(), batch],
  );
  if (unattached.length) {
    const store = objectStore();
    for (const file of unattached) {
      if (file.multipart_upload_id) await store.abortMultipart(file.incoming_key, file.multipart_upload_id).catch(() => {});
      await store.remove(file.incoming_key);
      await store.remove(`quarantine/${file.id}`);
      await query("UPDATE jamatnama.upload_files SET state='rejected',incoming_removed=true WHERE id=$1", [file.id]);
    }
  }
  result.oldIntents = (await query("DELETE FROM jamatnama.submission_intents WHERE report_id IS NOT NULL AND finalized_at<$1 AND NOT EXISTS (SELECT 1 FROM jamatnama.upload_files f WHERE f.intent_id=submission_intents.id AND NOT f.incoming_removed)", [new Date(now - 7 * 86400_000).toISOString()])).rowCount || 0;
  result.sessions += (await query("DELETE FROM jamatnama.staff_sessions WHERE expires<=$1", [now])).rowCount || 0;
  result.sessions += (await query("DELETE FROM jamatnama.admin_sessions WHERE expires<=$1", [now])).rowCount || 0;
  result.challenges = (await query("DELETE FROM jamatnama.challenges WHERE used_at<$1", [now - 2 * 3600_000])).rowCount || 0;
  result.rateLimits = (await query("DELETE FROM jamatnama.rate_limits WHERE expires<=$1", [Math.floor(now / 1000)])).rowCount || 0;
  return result;
}
export async function operationsStatus() {
  const [scan, budget] = await Promise.all([
    query<{ state: string; n: string; oldest: string | null; bytes: string }>(
      "SELECT state,count(*) AS n,min(created_at) AS oldest,coalesce(sum(size_bytes),0) AS bytes FROM jamatnama.evidence GROUP BY state",
    ),
    query<{ period: string; bytes: string }>("SELECT period,bytes FROM jamatnama.upload_budget WHERE period=ANY($1)", [["total", `day:${today()}`]]),
  ]);
  return {
    evidence: Object.fromEntries(scan.rows.map((r) => [r.state, { count: Number(r.n), bytes: Number(r.bytes), oldest: r.oldest }])),
    budgetUsed: Object.fromEntries(budget.rows.map((r) => [r.period.startsWith("day:") ? "today" : "total", Number(r.bytes)])),
    budgetLimits: budgetLimits(),
    uploadsEnabled: uploadsEnabled(),
  };
}
