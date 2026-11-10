import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { objectStore } from "../lib/r2";
import { sealSecret, openSecret } from "../lib/secrets";
import { admin, finish, resetData, seedReport } from "./support/db";

const dir = mkdtempSync(path.join(tmpdir(), "jamatnama-backup-"));
const backupDir = path.join(dir, "backup");
const key = randomBytes(32).toString("hex");
const restoreName = `restore_${randomBytes(4).toString("hex")}`;
const adminBase = process.env.TEST_ADMIN_BASE!;
const restoreUrl = `${adminBase}/${restoreName}`;
const script = (name: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, name.endsWith(".mts") ? ["--import", "tsx", `scripts/${name}`, ...args] : [`scripts/${name}`, ...args], { encoding: "utf8", env: { ...process.env, BACKUP_ENCRYPTION_KEY: key, ...env } });
const dumpAll = async (client: pg.Pool | pg.Client) => {
  const tables = ["reports", "accused", "source_links", "supports", "evidence", "staff", "audit_log", "totp_replay", "meta"];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await client.query(`SELECT * FROM jamatnama.${t} ORDER BY 1,2`)).rows;
  return out;
};
let reportId = "";
const bytes = randomBytes(5000);
before(async () => {
  await resetData();
  reportId = await seedReport({ title: "ব্যাকআপ-পরীক্ষার-কাল্পনিক-শিরোনাম", facts: { x: "1" } });
  await seedReport({ status: "pending" });
  await admin.query("INSERT INTO jamatnama.accused(report_id,position,name,information) VALUES($1,0,'কাল্পনিক','তথ্য')", [reportId]);
  await admin.query("INSERT INTO jamatnama.staff(id,username,totp_secret,password_hash,created_at) VALUES('m','mod-restore',$1,'salt:hash',now())", [sealSecret("A".repeat(32))]);
  await admin.query("INSERT INTO jamatnama.staff_sessions(token_hash,staff_id,expires) VALUES('session-hash','m',$1)", [Date.now() + 100000]);
  await admin.query("INSERT INTO jamatnama.audit_log(id,actor_id,actor_name,action,target,detail,created_at) VALUES(77,'owner','superadmin','x','y','z',now())");
  await admin.query("INSERT INTO jamatnama.totp_replay(identity,step) VALUES('m',123)");
  const { createHash } = await import("node:crypto");
  await objectStore().put("evidence/ev1", new Uint8Array(bytes), "application/pdf");
  await admin.query("INSERT INTO jamatnama.evidence(id,report_id,mime,size_bytes,object_key,sha256,state,origin,created_at) VALUES('ev1',$1,'application/pdf',$2,'evidence/ev1',$3,'clean','upload',now())", [reportId, bytes.length, createHash("sha256").update(bytes).digest("hex")]);
});
after(async () => {
  await finish();
  rmSync(dir, { recursive: true, force: true });
});
test("database backup is encrypted and leaves out sessions", () => {
  const result = script("pg-backup.mjs", [backupDir]);
  assert.equal(result.status, 0, result.stderr);
  for (const file of readdirSync(backupDir).filter((f) => f.endsWith(".enc"))) {
    const content = readFileSync(path.join(backupDir, file));
    assert.equal(content.includes("ব্যাকআপ-পরীক্ষার"), false);
    assert.equal(content.includes("কাল্পনিক"), false);
  }
  assert.equal(readdirSync(backupDir).some((f) => f.includes("session")), false);
  assert.equal(script("pg-backup.mjs", [backupDir]).status, 1, "never overwrites an existing backup");
});
test("restore into a new database reproduces the data exactly and is verified", async () => {
  const bootstrap = new pg.Client({ connectionString: `${adminBase}/postgres` });
  await bootstrap.connect();
  await bootstrap.query(`CREATE DATABASE ${restoreName}`);
  await bootstrap.end();
  const migrated = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { encoding: "utf8", env: { ...process.env, DATABASE_ADMIN_URL: restoreUrl } });
  assert.equal(migrated.status, 0, migrated.stderr);
  const result = script("pg-restore.mjs", [backupDir], { DATABASE_ADMIN_URL: restoreUrl });
  assert.equal(result.status, 0, result.stderr);
  const restored = new pg.Client({ connectionString: restoreUrl });
  await restored.connect();
  try {
    assert.deepEqual(await dumpAll(restored), await dumpAll(admin));
    assert.equal(Number((await restored.query("SELECT count(*) AS n FROM jamatnama.staff_sessions")).rows[0].n), 0, "old sessions do not return");
    const search = await restored.query("SELECT id FROM jamatnama.reports WHERE search_text ILIKE '%ব্যাকআপ-পরীক্ষার%'");
    assert.deepEqual(search.rows, [{ id: reportId }], "generated search column is rebuilt");
    const staff = (await restored.query("SELECT totp_secret FROM jamatnama.staff")).rows[0];
    assert.equal(openSecret(staff.totp_secret), "A".repeat(32), "MFA secrets open with the same key");
    const next = await restored.query("INSERT INTO jamatnama.audit_log(actor_id,actor_name,action,target,detail,created_at) VALUES('a','a','a','a','a',now()) RETURNING id");
    assert.equal(Number(next.rows[0].id), 78);
  } finally {
    await restored.end();
  }
});
test("restore refuses a non-empty target, the wrong key and a tampered file", async () => {
  const nonEmpty = script("pg-restore.mjs", [backupDir], { DATABASE_ADMIN_URL: restoreUrl });
  assert.equal(nonEmpty.status, 1);
  assert.match(nonEmpty.stderr, /not empty/);
  const secondName = `${restoreName}_b`, secondUrl = `${adminBase}/${secondName}`;
  const bootstrap = new pg.Client({ connectionString: `${adminBase}/postgres` });
  await bootstrap.connect();
  await bootstrap.query(`CREATE DATABASE ${secondName}`);
  await bootstrap.end();
  assert.equal(spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { encoding: "utf8", env: { ...process.env, DATABASE_ADMIN_URL: secondUrl } }).status, 0);
  const wrongKey = script("pg-restore.mjs", [backupDir], { DATABASE_ADMIN_URL: secondUrl, BACKUP_ENCRYPTION_KEY: "0".repeat(64) });
  assert.equal(wrongKey.status, 1, "wrong key");
  const tampered = path.join(dir, "tampered");
  cpSync(backupDir, tampered, { recursive: true });
  const target = path.join(tampered, "reports.jsonl.gz.enc");
  const data = readFileSync(target);
  data[10] ^= 0xff;
  writeFileSync(target, data);
  assert.equal(script("pg-restore.mjs", [tampered], { DATABASE_ADMIN_URL: secondUrl }).status, 1, "tampered file");
  const check = new pg.Client({ connectionString: secondUrl });
  await check.connect();
  assert.equal(Number((await check.query("SELECT count(*) AS n FROM jamatnama.reports")).rows[0].n), 0, "a failed restore leaves nothing behind");
  await check.end();
});
test("evidence backup copies to a second bucket, verifies, and restores a lost object", async () => {
  const env = { R2_BACKUP_BUCKET: "jamatnama-evidence-backup" };
  let result = script("r2-backup.mts", [], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).copied, 1);
  result = script("r2-backup.mts", [], env);
  assert.equal(JSON.parse(result.stdout).alreadyPresent, 1, "a repeat copies nothing");
  assert.equal(script("r2-backup.mts", ["--verify"], env).status, 0);
  await objectStore().remove("evidence/ev1");
  assert.equal(await objectStore().head("evidence/ev1"), null);
  result = script("r2-backup.mts", ["--restore"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).restored, 1);
  assert.deepEqual(Buffer.from(await objectStore().readRange("evidence/ev1", 0, bytes.length)), bytes);
  await objectStore().put("evidence/orphan", new Uint8Array([1]), "application/pdf");
  result = script("r2-backup.mts", ["--orphans"], env);
  assert.deepEqual(JSON.parse(result.stdout).orphans, ["evidence/orphan"]);
  await objectStore().remove("evidence/orphan");
});
