import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { consumeTotp } from "../lib/admin-auth";
import { objectStore } from "../lib/r2";
import { hash, passwordValid } from "../lib/security";
import { openSecret } from "../lib/secrets";
import { clamdEngine, scanBatch } from "../lib/scanner";
import { listPublished } from "../lib/reports";
import { totpCode } from "../lib/totp";
import { admin, asScanner, finish, resetData } from "./support/db";

process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const dir = mkdtempSync(path.join(tmpdir(), "jamatnama-migration-"));
const file = path.join(dir, "jamatnama.sqlite");
const REPORTS = 450, MOD_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", RECEIPT = "c".repeat(48);
const fileHash = (name = file) => createHash("sha256").update(readFileSync(name)).digest("hex");
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate-sqlite.mts", "--sqlite", file, ...args], { encoding: "utf8", env: process.env });
  let output: Record<string, never> | null = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {}
  return { status: result.status, output: output as Record<string, any> | null, stderr: result.stderr, raw: result.stdout };
};
let png: Buffer, evidenceIds: string[] = [];
// Creates the exact schema the old application created, with synthetic data only.
before(async () => {
  await resetData();
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).webp().toBuffer();
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE reports(id TEXT PRIMARY KEY, receipt_hash TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, division TEXT NOT NULL, district TEXT NOT NULL, upazila TEXT NOT NULL, incident_date TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', facts TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, review_note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, ward TEXT NOT NULL DEFAULT '', ward_area TEXT NOT NULL DEFAULT '');
   CREATE TABLE evidence(id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), mime TEXT NOT NULL, bytes BLOB NOT NULL);
   CREATE TABLE source_links(report_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, PRIMARY KEY(report_id,position));
   CREATE TABLE accused(report_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, information TEXT NOT NULL, PRIMARY KEY(report_id,position));
   CREATE TABLE supports(report_id TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(report_id,token));
   CREATE TABLE challenges(nonce TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
   CREATE TABLE rate_limits(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, credential_version TEXT NOT NULL);
   CREATE TABLE meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
   CREATE TABLE staff(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, totp_secret TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
   CREATE TABLE staff_sessions(token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const insert = db.prepare("INSERT INTO reports(id,receipt_hash,title,description,category,division,district,upazila,incident_date,created_at,status,facts,fingerprint,review_note,updated_at,ward,ward_area) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const statuses = ["pending", "published", "rejected"];
  for (let i = 0; i < REPORTS; i++) {
    const id = `report${String(i).padStart(4, "0")}`;
    const legacy = i % 7 === 0;
    insert.run(id, i === 0 ? hash(RECEIPT) : hash(`receipt-${i}`), `কাল্পনিক পরীক্ষার শিরোনাম ${i}`, `সম্পূর্ণ কাল্পনিক বিবরণ ${i}`, legacy ? "চুরি" : "রাজনৈতিক মামলা", "ঢাকা", "ঢাকা", "সাভার", "2026-10-20", new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), statuses[i % 3], legacy ? '{"theft_amount":"500"}' : "{}", `fp-${i}`, i % 3 === 2 ? "কাল্পনিক কারণ" : "", new Date(Date.UTC(2026, 0, 2, 0, 0, 0, i)).toISOString(), i % 5 === 0 ? "5" : "", i % 5 === 0 ? "সাভার পৌরসভা" : "");
  }
  db.prepare("INSERT INTO accused VALUES('report0001',0,'কাল্পনিক অভিযুক্ত ক','গোপন তথ্য')").run();
  db.prepare("INSERT INTO accused VALUES('report0001',1,'','দ্বিতীয় কাল্পনিক')").run();
  db.prepare("INSERT INTO source_links VALUES('report0001',0,'https://example.com/a')").run();
  for (const token of ["t1", "t2", "t3"]) db.prepare("INSERT INTO supports VALUES('report0001',?)").run(hash(token));
  for (let i = 0; i < 6; i++) {
    const id = `evidence${i}`;
    evidenceIds.push(id);
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.4 ${i}`), randomBytes(2000)]);
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?)").run(id, `report000${i}`, i % 2 ? "image/webp" : "application/pdf", i % 2 ? png : pdf);
  }
  const salt = "syntheticsalt";
  db.prepare("INSERT INTO staff VALUES('mod1','moderator-one',?,?,1,'2026-02-01T00:00:00.000Z')").run(MOD_SECRET, `${salt}:${scryptSync("synthetic-password-1", salt, 64).toString("hex")}`);
  db.prepare("INSERT INTO staff VALUES('mod2','moderator-two',?,?,0,'2026-02-02T00:00:00.000Z')").run(MOD_SECRET, `${salt}:${scryptSync("synthetic-password-2", salt, 64).toString("hex")}`);
  db.prepare("INSERT INTO staff_sessions VALUES(?,'mod1',?)").run(hash("old-session"), Date.now() + 100000);
  db.prepare("INSERT INTO admin_sessions VALUES(?,?,'v')").run(hash("old-owner-session"), Date.now() + 100000);
  for (let i = 1; i <= 10; i++)
    db.prepare("INSERT INTO audit_log(id,actor_id,actor_name,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)").run(i * 3, "mod1", "moderator-one", "report.review", `report000${i % 5}`, '{"to":"published"}', new Date(Date.UTC(2026, 3, 1, 0, 0, i)).toISOString());
  db.prepare("INSERT INTO meta VALUES('revision',41)").run();
  db.prepare("INSERT INTO meta VALUES('admin-totp-step',2000000)").run();
  db.prepare("INSERT INTO meta VALUES('totp:mod1',55555555)").run();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
});
after(async () => {
  await finish();
  rmSync(dir, { recursive: true, force: true });
});
const targetCount = async () => Number((await admin.query("SELECT count(*) AS n FROM jamatnama.reports")).rows[0].n);
test("dry run writes nothing, reports counts, and leaves the source byte-identical", async () => {
  const before = fileHash();
  const { status, output, raw } = run("--dry-run");
  assert.equal(status, 0, raw);
  assert.equal(output!.preflight.counts.reports, REPORTS);
  assert.equal(output!.preflight.counts.evidence, 6);
  assert.equal(output!.preflight.counts.not_migrated_staff_sessions, 1);
  assert.deepEqual(output!.preflight.problems, []);
  assert.equal(output!.source.unchanged, true);
  assert.equal(await targetCount(), 0);
  assert.equal(fileHash(), before);
  assert.equal(raw.includes("কাল্পনিক"), false, "output holds no report content");
  assert.equal(raw.includes(MOD_SECRET), false, "output holds no credentials");
});
test("a corrupt source is refused before anything is written", async () => {
  const bad = path.join(dir, "bad.sqlite");
  copyFileSync(file, bad);
  const db = new DatabaseSync(bad);
  db.exec("UPDATE reports SET facts='{not json' WHERE id='report0002'");
  db.close();
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate-sqlite.mts", "--sqlite", bad, "--execute"], { encoding: "utf8", env: process.env });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /facts_invalid_json/);
  assert.equal(await targetCount(), 0);
});
test("a partial run resumes without duplicates, then verification passes", async () => {
  const before = fileHash();
  let step = run("--execute", "--max-reports", "250");
  assert.equal(step.status, 0, step.raw + step.stderr);
  assert.equal(step.output!.complete, false);
  assert.equal(await targetCount(), 250);
  assert.equal(run("--verify").status, 1, "verification fails while incomplete");
  step = run("--execute", "--max-evidence", "2");
  assert.equal(step.status, 0, step.raw + step.stderr);
  assert.equal(step.output!.written.reports, REPORTS - 250);
  assert.equal(step.output!.written.reportsSkipped, 250);
  assert.equal(step.output!.written.evidence, 2);
  assert.equal(step.output!.complete, false);
  step = run("--execute");
  assert.equal(step.status, 0, step.raw + step.stderr);
  assert.equal(step.output!.written.evidence, 4);
  assert.equal(step.output!.written.evidenceSkipped, 2);
  assert.equal(step.output!.complete, true);
  assert.equal(await targetCount(), REPORTS);
  const again = run("--execute");
  assert.equal(again.output!.written.reports, 0, "a further run changes nothing");
  assert.equal(again.output!.written.audit, 0);
  const verified = run("--verify", "--deep");
  assert.equal(verified.status, 0, verified.raw + verified.stderr);
  assert.equal(verified.output!.verified, true);
  assert.equal(fileHash(), before, "the original database stays byte-identical");
});
test("verification detects tampered rows, audit history and stored objects", async () => {
  const original = (await admin.query("SELECT status FROM jamatnama.reports WHERE id='report0003'")).rows[0].status;
  await admin.query("UPDATE jamatnama.reports SET status='rejected',updated_at=now() WHERE id='report0003'");
  await admin.query("UPDATE jamatnama.audit_log SET detail='changed' WHERE id=3");
  const key = (await admin.query("SELECT object_key FROM jamatnama.evidence WHERE id='evidence0'")).rows[0].object_key;
  const head = await objectStore().head(key);
  const saved = await objectStore().readRange(key, 0, head!.size);
  await objectStore().put(key, new Uint8Array(randomBytes(head!.size)), "application/pdf");
  const result = run("--verify", "--deep");
  assert.equal(result.status, 1);
  const text = result.output!.mismatches.join("\n");
  assert.match(text, /report report0003: status/);
  assert.match(text, /audit 3: differs/);
  assert.match(text, /evidence evidence0: checksum/);
  await admin.query("UPDATE jamatnama.reports SET status=$1,updated_at=$2 WHERE id='report0003'", [original, new Date(Date.UTC(2026, 0, 2, 0, 0, 0, 3)).toISOString()]);
  await admin.query("UPDATE jamatnama.audit_log SET detail='{\"to\":\"published\"}' WHERE id=3");
  await objectStore().put(key, new Uint8Array(saved), "application/pdf");
  assert.equal(run("--verify", "--deep").status, 0);
});
test("identifiers, receipts, statuses, relations, roles and audit history survive", async () => {
  const { rows } = await admin.query("SELECT id,status FROM jamatnama.reports WHERE receipt_hash=$1", [hash(RECEIPT)]);
  assert.deepEqual(rows, [{ id: "report0000", status: "pending" }], "an existing receipt code still resolves");
  const one = (await admin.query("SELECT *,created_at::text AS raw_created FROM jamatnama.reports WHERE id='report0001'")).rows[0];
  assert.equal(one.status, "published");
  assert.equal(one.supports_count, 3);
  assert.equal(new Date(one.created_at).getTime(), Date.UTC(2026, 0, 1, 0, 0, 0, 1));
  const accused = await admin.query("SELECT name,information FROM jamatnama.accused WHERE report_id='report0001' ORDER BY position");
  assert.equal(accused.rows.length, 2);
  const legacy = (await admin.query("SELECT category,facts,display_category,display_facts FROM jamatnama.reports WHERE id='report0000'")).rows[0];
  assert.equal(legacy.category, "চুরি", "original category is preserved");
  assert.deepEqual(legacy.facts, { theft_amount: "500" });
  assert.equal(legacy.display_category, "চুরি, ডাকাতি ও ছিনতাই");
  assert.deepEqual(legacy.display_facts, { loss_amount: "500" });
  const audit = await admin.query("SELECT id,actor_name FROM jamatnama.audit_log ORDER BY id");
  assert.deepEqual(audit.rows.map((r) => Number(r.id)), [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  assert.ok(audit.rows.every((r) => r.actor_name === "moderator-one"));
  const fresh = await admin.query("INSERT INTO jamatnama.audit_log(actor_id,actor_name,action,target,detail,created_at) VALUES('x','x','x','x','x',now()) RETURNING id");
  assert.equal(Number(fresh.rows[0].id), 31, "new entries continue after migrated ids");
  await admin.query("DELETE FROM jamatnama.audit_log WHERE id=31");
  assert.equal(Number((await admin.query("SELECT value FROM jamatnama.meta WHERE key='revision'")).rows[0].value), 42);
});
test("moderator access and MFA carry over; old sessions do not; replay state is kept", async () => {
  const staff = (await admin.query("SELECT * FROM jamatnama.staff ORDER BY id")).rows;
  assert.deepEqual(staff.map((s) => [s.username, s.active]), [["moderator-one", true], ["moderator-two", false]]);
  assert.equal(await passwordValid("synthetic-password-1", staff[0].password_hash), true);
  assert.equal(staff[0].totp_secret.includes(MOD_SECRET), false, "sealed at rest");
  assert.equal(openSecret(staff[0].totp_secret), MOD_SECRET);
  assert.equal(Number((await admin.query("SELECT count(*) AS n FROM jamatnama.staff_sessions")).rows[0].n), 0);
  assert.equal(Number((await admin.query("SELECT count(*) AS n FROM jamatnama.admin_sessions")).rows[0].n), 0);
  const step = 55555555;
  assert.equal(await consumeTotp(MOD_SECRET, totpCode(MOD_SECRET, step), step * 30000, "mod1"), false, "used step stays used");
  assert.equal(await consumeTotp(MOD_SECRET, totpCode(MOD_SECRET, step + 2), (step + 2) * 30000, "mod1"), true);
});
test("migrated evidence stays quarantined until scanned, then opens with an unchanged checksum", async () => {
  const before = (await admin.query("SELECT id,sha256,state,origin,object_key FROM jamatnama.evidence ORDER BY id")).rows;
  assert.equal(before.length, 6);
  assert.ok(before.every((e) => e.state === "pending_scan" && e.origin === "legacy" && e.object_key.startsWith("quarantine/legacy/")));
  const source = new DatabaseSync(file, { readOnly: true });
  const handled = await asScanner(() => scanBatch(clamdEngine(process.env.CLAMD_HOST, Number(process.env.CLAMD_PORT))));
  assert.equal(handled, 6);
  const after = (await admin.query("SELECT id,sha256,state,object_key FROM jamatnama.evidence ORDER BY id")).rows;
  assert.ok(after.every((e) => e.state === "clean" && e.object_key === `evidence/${e.id}`));
  assert.deepEqual(after.map((e) => e.sha256), before.map((e) => e.sha256), "legacy bytes are not rewritten");
  for (const row of source.prepare("SELECT id,bytes FROM evidence").iterate()) {
    const stored = Buffer.from(await objectStore().readRange(`evidence/${String(row.id)}`, 0, 10 * 1024 * 1024));
    assert.deepEqual(stored, Buffer.from(row.bytes as Uint8Array));
  }
  source.close();
  const verified = run("--verify", "--deep");
  assert.equal(verified.status, 0, "verification follows the object to its final key: " + verified.raw);
});
test("published reports are served from PostgreSQL after migration", async () => {
  const { total } = await listPublished({}, 6);
  assert.equal(total, REPORTS / 3);
  assert.equal(fileHash().length, 64);
});
