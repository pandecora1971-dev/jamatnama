// Resumable SQLite to PostgreSQL + R2 migration. The source is opened read-only and never changed.
//   npm run migrate:sqlite -- --sqlite ./data/jamatnama.sqlite --dry-run
//   npm run migrate:sqlite -- --sqlite ./data/jamatnama.sqlite --execute [--max-reports N] [--max-evidence N]
//   npm run migrate:sqlite -- --sqlite ./data/jamatnama.sqlite --verify [--deep]
// Interrupted or limited runs resume safely: every row is keyed by its original primary key.
// Output holds only counts and identifiers, never report content, credentials or file data.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import pg from "pg";
import { sniffMime } from "../lib/filetypes";
import { connectionConfig } from "../lib/pg-config.mjs";
import { objectStore } from "../lib/r2";
import { openSecret, sealSecret } from "../lib/secrets";
import { normalizeCategory } from "../lib/shared";
import { validTotpSecret } from "../lib/totp";

nextEnv.loadEnvConfig(process.cwd());
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const sourcePath = option("sqlite");
const mode = flag("execute") ? "execute" : flag("verify") ? "verify" : flag("dry-run") ? "dry-run" : null;
if (!sourcePath || !mode) {
  console.error("Usage: --sqlite <path> (--dry-run | --execute [--max-reports N] [--max-evidence N] | --verify [--deep])");
  process.exit(2);
}
type Row = Record<string, unknown>;
const hashFile = () =>
  new Promise<string>((resolve, reject) => {
    const digest = createHash("sha256");
    createReadStream(sourcePath).on("data", (d) => digest.update(d)).on("end", () => resolve(digest.digest("hex"))).on("error", reject);
  });
const before = await hashFile();
const source = new DatabaseSync(sourcePath, { readOnly: true });
const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => String(t.name)));
const count = (table: string) => (tables.has(table) ? Number((source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n) : 0);
const rowsOf = (table: string, order: string) => (tables.has(table) ? source.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate() : ([] as unknown as Iterable<Row>));
const iso = (value: unknown) => new Date(String(value)).toISOString();
const isoValid = (value: unknown) => !Number.isNaN(Date.parse(String(value)));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const legacyKey = (id: string) => `quarantine/legacy/${id}`;

function preflight() {
  const problems: string[] = [];
  const integrity = source.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || (integrity[0] as Row).integrity_check !== "ok") problems.push("sqlite_integrity_check_failed");
  for (const r of rowsOf("reports", "id") as Iterable<Row>) {
    const id = String(r.id);
    try {
      const facts = JSON.parse(String(r.facts));
      if (!facts || typeof facts !== "object") problems.push(`report ${id}: facts_not_object`);
    } catch {
      problems.push(`report ${id}: facts_invalid_json`);
    }
    if (!isoValid(r.created_at) || !isoValid(r.updated_at)) problems.push(`report ${id}: invalid_timestamp`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.incident_date)) || !isoValid(r.incident_date)) problems.push(`report ${id}: invalid_incident_date`);
    if (!["pending", "published", "rejected"].includes(String(r.status))) problems.push(`report ${id}: invalid_status`);
    if (!/^[a-f0-9]{64}$/.test(String(r.receipt_hash))) problems.push(`report ${id}: unexpected_receipt_hash_format`);
  }
  for (const table of ["evidence", "accused", "source_links", "supports"]) {
    if (!tables.has(table)) continue;
    const orphans = Number((source.prepare(`SELECT COUNT(*) AS n FROM ${table} t LEFT JOIN reports r ON r.id=t.report_id WHERE r.id IS NULL`).get() as Row).n);
    if (orphans) problems.push(`${table}: ${orphans}_orphan_rows`);
  }
  let evidenceBytes = 0, mismatched = 0;
  if (tables.has("evidence"))
    for (const e of source.prepare("SELECT id,mime,bytes FROM evidence ORDER BY id").iterate() as Iterable<Row>) {
      const bytes = e.bytes as Uint8Array;
      evidenceBytes += bytes.length;
      if (sniffMime(bytes.subarray(0, 64 * 1024), bytes.length) !== e.mime) mismatched++;
    }
  if (tables.has("staff"))
    for (const s of source.prepare("SELECT id,totp_secret FROM staff").iterate() as Iterable<Row>)
      if (!validTotpSecret(String(s.totp_secret))) problems.push(`staff ${String(s.id)}: invalid_totp_secret`);
  return {
    counts: {
      reports: count("reports"), accused: count("accused"), source_links: count("source_links"), supports: count("supports"),
      evidence: count("evidence"), staff: count("staff"), audit_log: count("audit_log"),
      not_migrated_admin_sessions: count("admin_sessions"), not_migrated_staff_sessions: count("staff_sessions"),
      not_migrated_rate_limits: count("rate_limits"), not_migrated_challenges: count("challenges"),
    },
    evidenceBytes,
    // Reported for review only: files still pass through the scanner and stay quarantined until clean.
    evidenceFormatWarnings: mismatched,
    problems,
  };
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
async function connect() {
  if (!adminUrl) throw Error("Set DATABASE_ADMIN_URL.");
  const client = new pg.Client(connectionConfig(adminUrl));
  await client.connect();
  const schema = await client.query("SELECT 1 FROM pg_tables WHERE schemaname='jamatnama' AND tablename='reports'");
  if (!schema.rowCount) throw Error("Target schema is missing. Run npm run db:migrate first.");
  return client;
}
const summary: Row = { mode, source: { sha256Before: before } };
const check = preflight();
summary.preflight = check;
let exitCode = 0;

if (mode === "dry-run") {
  if (adminUrl) {
    const client = await connect();
    const existing: Row = {};
    for (const table of ["reports", "accused", "source_links", "supports", "evidence", "staff", "audit_log"])
      existing[table] = Number((await client.query(`SELECT count(*) AS n FROM jamatnama.${table}`)).rows[0].n);
    summary.targetExisting = existing;
    await client.end();
  }
  summary.wouldWrite = false;
  if (check.problems.length) exitCode = 1;
}
if (mode === "execute") {
  if (check.problems.length) {
    summary.aborted = "Fix the listed problems in a copy of the source, then run again. Nothing was written.";
    exitCode = 1;
  } else {
    const client = await connect();
    const done = { reports: 0, reportsSkipped: 0, staff: 0, audit: 0, evidence: 0, evidenceSkipped: 0 };
    const maxReports = Number(option("max-reports")) || Infinity;
    const maxEvidence = Number(option("max-evidence")) || Infinity;
    const accused = tables.has("accused") ? source.prepare("SELECT position,name,information FROM accused WHERE report_id=? ORDER BY position") : null;
    const links = tables.has("source_links") ? source.prepare("SELECT position,url FROM source_links WHERE report_id=? ORDER BY position") : null;
    const supports = tables.has("supports") ? source.prepare("SELECT token FROM supports WHERE report_id=?") : null;
    let batch = 0;
    await client.query("BEGIN");
    for (const r of rowsOf("reports", "id") as Iterable<Row>) {
      if (done.reports >= maxReports) break;
      const facts = JSON.parse(String(r.facts));
      const display = normalizeCategory(String(r.category), facts);
      const tokens = supports ? (supports.all(String(r.id)) as Row[]) : [];
      const inserted = await client.query(
        `INSERT INTO jamatnama.reports(id,receipt_hash,title,description,category,facts,display_category,display_facts,division,district,upazila,ward,ward_area,incident_date,created_at,updated_at,status,fingerprint,review_note,supports_count)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT(id) DO NOTHING`,
        [r.id, r.receipt_hash, r.title, r.description, r.category, JSON.stringify(facts), display.category, JSON.stringify(display.facts), r.division, r.district, r.upazila, r.ward ?? "", r.ward_area ?? "", r.incident_date, iso(r.created_at), iso(r.updated_at), r.status, r.fingerprint, r.review_note ?? "", tokens.length],
      );
      if (!inserted.rowCount) {
        done.reportsSkipped++;
        continue;
      }
      // Relations share the report's transaction, so a report is never partly migrated.
      for (const a of (accused?.all(String(r.id)) || []) as Row[])
        await client.query("INSERT INTO jamatnama.accused(report_id,position,name,information) VALUES($1,$2,$3,$4)", [r.id, a.position, a.name, a.information]);
      for (const l of (links?.all(String(r.id)) || []) as Row[])
        await client.query("INSERT INTO jamatnama.source_links(report_id,position,url) VALUES($1,$2,$3)", [r.id, l.position, l.url]);
      for (const t of tokens)
        await client.query("INSERT INTO jamatnama.supports(report_id,token) VALUES($1,$2)", [r.id, t.token]);
      done.reports++;
      if (++batch >= 200) {
        await client.query("COMMIT");
        await client.query("BEGIN");
        batch = 0;
      }
    }
    await client.query("COMMIT");
    const reportsComplete = done.reports < maxReports;
    if (reportsComplete) {
      await client.query("BEGIN");
      for (const s of rowsOf("staff", "id") as Iterable<Row>) {
        const result = await client.query(
          "INSERT INTO jamatnama.staff(id,username,totp_secret,password_hash,active,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
          [s.id, s.username, sealSecret(String(s.totp_secret)), s.password_hash, Number(s.active) === 1, iso(s.created_at)],
        );
        done.staff += result.rowCount || 0;
      }
      for (const a of rowsOf("audit_log", "id") as Iterable<Row>) {
        const result = await client.query(
          "INSERT INTO jamatnama.audit_log(id,actor_id,actor_name,action,target,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
          [a.id, a.actor_id, a.actor_name, a.action, a.target, a.detail, iso(a.created_at)],
        );
        done.audit += result.rowCount || 0;
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('jamatnama.audit_log','id'), GREATEST((SELECT COALESCE(max(id),1) FROM jamatnama.audit_log),1))`);
      // Replay windows carry over so a code used just before cutover cannot be used again after it.
      if (tables.has("meta"))
        for (const m of source.prepare("SELECT key,value FROM meta").iterate() as Iterable<Row>) {
          const key = String(m.key);
          if (key === "revision") await client.query("UPDATE jamatnama.meta SET value=GREATEST(value,$1::bigint+1) WHERE key='revision'", [Number(m.value)]);
          const identity = key === "admin-totp-step" ? "owner" : key.startsWith("totp:") ? key.slice(5) : null;
          if (identity)
            await client.query("INSERT INTO jamatnama.totp_replay(identity,step) VALUES($1,$2) ON CONFLICT(identity) DO UPDATE SET step=GREATEST(totp_replay.step,excluded.step)", [identity, Number(m.value)]);
        }
      await client.query("COMMIT");
      if (tables.has("evidence") && count("evidence")) {
        const store = objectStore();
        const created = new Map((await client.query<{ id: string; created_at: Date }>("SELECT id,created_at FROM jamatnama.reports")).rows.map((x) => [x.id, x.created_at]));
        const present = new Set((await client.query<{ id: string }>("SELECT id FROM jamatnama.evidence")).rows.map((x) => x.id));
        let bytes = 0;
        for (const e of source.prepare("SELECT id,report_id,mime,bytes FROM evidence ORDER BY id").iterate() as Iterable<Row>) {
          const id = String(e.id), data = e.bytes as Uint8Array;
          bytes += data.length;
          if (present.has(id)) {
            done.evidenceSkipped++;
            continue;
          }
          if (done.evidence >= maxEvidence) continue;
          const digest = sha256(data), key = legacyKey(id);
          await store.put(key, new Uint8Array(data), String(e.mime), { sha256: digest });
          // Read back before recording: a row exists only for bytes confirmed in storage.
          const copy = await store.stream(key);
          const hasher = createHash("sha256");
          let size = 0;
          for await (const chunk of copy as unknown as AsyncIterable<Uint8Array>) {
            hasher.update(chunk);
            size += chunk.length;
          }
          if (size !== data.length || hasher.digest("hex") !== digest) throw Object.assign(Error("evidence checksum mismatch"), { code: "CHECKSUM" });
          await client.query(
            "INSERT INTO jamatnama.evidence(id,report_id,mime,size_bytes,object_key,sha256,state,origin,created_at) VALUES($1,$2,$3,$4,$5,$6,'pending_scan','legacy',$7) ON CONFLICT(id) DO NOTHING",
            [id, e.report_id, e.mime, data.length, key, digest, created.get(String(e.report_id))],
          );
          done.evidence++;
        }
        await client.query(
          "INSERT INTO jamatnama.upload_budget(period,bytes) VALUES('total',$1) ON CONFLICT(period) DO UPDATE SET bytes=GREATEST(upload_budget.bytes,excluded.bytes)",
          [bytes],
        );
      }
    }
    await client.end();
    summary.written = done;
    summary.complete = reportsComplete && done.evidence + done.evidenceSkipped === count("evidence");
  }
}
if (mode === "verify") {
  const client = await connect();
  const mismatches: string[] = [];
  const note = (text: string) => {
    if (mismatches.length < 200) mismatches.push(text);
  };
  for (const table of ["reports", "accused", "source_links", "supports", "evidence", "staff"]) {
    const target = Number((await client.query(`SELECT count(*) AS n FROM jamatnama.${table}`)).rows[0].n);
    if (target !== count(table)) note(`count ${table}: source ${count(table)} target ${target}`);
  }
  const auditTarget = Number((await client.query("SELECT count(*) AS n FROM jamatnama.audit_log WHERE id<=$1", [tables.has("audit_log") ? Number((source.prepare("SELECT COALESCE(MAX(id),0) AS m FROM audit_log").get() as Row).m) : 0])).rows[0].n);
  if (auditTarget !== count("audit_log")) note(`count audit_log: source ${count("audit_log")} target ${auditTarget}`);
  for (const r of rowsOf("reports", "id") as Iterable<Row>) {
    const id = String(r.id);
    const { rows } = await client.query("SELECT *,to_char(incident_date,'YYYY-MM-DD') AS day,extract(epoch FROM created_at)*1000 AS created_ms,extract(epoch FROM updated_at)*1000 AS updated_ms FROM jamatnama.reports WHERE id=$1", [id]);
    const t = rows[0];
    if (!t) {
      note(`report ${id}: missing`);
      continue;
    }
    for (const field of ["receipt_hash", "title", "description", "category", "division", "district", "upazila", "status", "fingerprint"])
      if (t[field] !== r[field]) note(`report ${id}: ${field}`);
    if (t.ward !== (r.ward ?? "") || t.ward_area !== (r.ward_area ?? "")) note(`report ${id}: ward`);
    if (t.review_note !== (r.review_note ?? "")) note(`report ${id}: review_note`);
    if (t.day !== r.incident_date) note(`report ${id}: incident_date`);
    if (Math.round(Number(t.created_ms)) !== Date.parse(String(r.created_at))) note(`report ${id}: created_at`);
    if (Math.round(Number(t.updated_ms)) !== Date.parse(String(r.updated_at))) note(`report ${id}: updated_at`);
    if (canonicalJson(t.facts) !== canonicalJson(JSON.parse(String(r.facts)))) note(`report ${id}: facts`);
    const relation = async (table: string, columns: string, order: string) => {
      const expected = tables.has(table) ? source.prepare(`SELECT ${columns} FROM ${table} WHERE report_id=? ORDER BY ${order}`).all(id) : [];
      const actual = (await client.query(`SELECT ${columns} FROM jamatnama.${table} WHERE report_id=$1 ORDER BY ${order}`, [id])).rows;
      if (canonicalJson(expected) !== canonicalJson(actual)) note(`report ${id}: ${table}`);
      return expected.length;
    };
    await relation("accused", "position,name,information", "position");
    await relation("source_links", "position,url", "position");
    const supportCount = await relation("supports", "token", "token");
    if (Number(t.supports_count) !== supportCount) note(`report ${id}: supports_count`);
  }
  for (const s of rowsOf("staff", "id") as Iterable<Row>) {
    const { rows } = await client.query("SELECT *,extract(epoch FROM created_at)*1000 AS created_ms FROM jamatnama.staff WHERE id=$1", [s.id]);
    const t = rows[0];
    if (!t) {
      note(`staff ${String(s.id)}: missing`);
      continue;
    }
    if (t.username !== s.username || t.password_hash !== s.password_hash || t.active !== (Number(s.active) === 1)) note(`staff ${String(s.id)}: account`);
    if (openSecret(t.totp_secret) !== s.totp_secret) note(`staff ${String(s.id)}: mfa`);
    if (Math.round(Number(t.created_ms)) !== Date.parse(String(s.created_at))) note(`staff ${String(s.id)}: created_at`);
  }
  for (const a of rowsOf("audit_log", "id") as Iterable<Row>) {
    const { rows } = await client.query("SELECT *,extract(epoch FROM created_at)*1000 AS created_ms FROM jamatnama.audit_log WHERE id=$1", [a.id]);
    const t = rows[0];
    if (!t || t.actor_id !== a.actor_id || t.actor_name !== a.actor_name || t.action !== a.action || t.target !== a.target || t.detail !== a.detail || Math.round(Number(t.created_ms)) !== Date.parse(String(a.created_at)))
      note(`audit ${String(a.id)}: differs`);
  }
  if (tables.has("evidence") && count("evidence")) {
    const store = objectStore();
    for (const e of source.prepare("SELECT id,report_id,mime,bytes FROM evidence ORDER BY id").iterate() as Iterable<Row>) {
      const id = String(e.id), data = e.bytes as Uint8Array;
      const t = (await client.query("SELECT report_id,mime,size_bytes,sha256,object_key FROM jamatnama.evidence WHERE id=$1", [id])).rows[0];
      if (!t) {
        note(`evidence ${id}: missing`);
        continue;
      }
      const digest = sha256(data);
      if (t.report_id !== e.report_id || t.mime !== e.mime || Number(t.size_bytes) !== data.length || t.sha256 !== digest) note(`evidence ${id}: metadata`);
      const head = await store.head(t.object_key);
      if (!head || head.size !== data.length) note(`evidence ${id}: object_missing_or_wrong_size`);
      else if (flag("deep")) {
        const hasher = createHash("sha256");
        for await (const chunk of (await store.stream(t.object_key)) as unknown as AsyncIterable<Uint8Array>) hasher.update(chunk);
        if (hasher.digest("hex") !== digest) note(`evidence ${id}: checksum`);
      }
    }
  }
  await client.end();
  summary.verified = mismatches.length === 0;
  summary.mismatches = mismatches;
  if (mismatches.length || check.problems.length) exitCode = 1;
}
source.close();
const after = await hashFile();
(summary.source as Row).sha256After = after;
(summary.source as Row).unchanged = before === after;
if (before !== after) exitCode = 1;
console.log(JSON.stringify(summary, null, 2));
process.exitCode = exitCode;
