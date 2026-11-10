// Restores a pg-backup directory into an EMPTY, already-migrated database, then verifies row counts
// and content hashes by reading the data back. Refuses a target that already holds reports.
//   DATABASE_ADMIN_URL=<new database> BACKUP_ENCRYPTION_KEY=<key> npm run db:restore -- <dir>
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionConfig } from "../lib/pg-config.mjs";
nextEnv.loadEnvConfig(process.cwd());
const dir = process.argv[2];
if (!dir) throw Error("Usage: npm run db:restore -- <backup-directory>");
const keyHex = process.env.BACKUP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw Error("Set BACKUP_ENCRYPTION_KEY.");
if (!process.env.DATABASE_ADMIN_URL) throw Error("Set DATABASE_ADMIN_URL to the restore target.");
const key = Buffer.from(keyHex, "hex");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const client = new pg.Client(connectionConfig(process.env.DATABASE_ADMIN_URL));
await client.connect();
const result = { ok: true, tables: {} };
try {
  const applied = (await client.query("SELECT version,checksum FROM public.jamatnama_schema_migrations ORDER BY version")).rows;
  if (JSON.stringify(applied) !== JSON.stringify(manifest.migrations)) throw Error("Run db:migrate on the target so its schema matches the backup.");
  const { rows } = await client.query("SELECT (SELECT count(*) FROM jamatnama.reports)+(SELECT count(*) FROM jamatnama.staff)+(SELECT count(*) FROM jamatnama.audit_log) AS n");
  if (Number(rows[0].n)) throw Error("Target is not empty. Restore only into a new database.");
  await client.query("BEGIN");
  for (const [table, entry] of Object.entries(manifest.tables)) {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    const encrypted = readFileSync(path.join(dir, `${table}.jsonl.gz.enc`));
    const text = gunzipSync(Buffer.concat([decipher.update(encrypted), decipher.final()])).toString("utf8");
    const lines = text ? text.split("\n") : [];
    const digest = createHash("sha256");
    for (const line of lines) digest.update(line + "\n");
    if (lines.length !== entry.rows || digest.digest("hex") !== entry.sha256) throw Error(`Backup file for ${table} failed its integrity check.`);
    const columns = (await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='jamatnama' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position",
      [table],
    )).rows.map((c) => `"${c.column_name}"`).join(",");
    if (table === "meta") await client.query("DELETE FROM jamatnama.meta");
    for (let i = 0; i < lines.length; i += 500) {
      const batch = `[${lines.slice(i, i + 500).join(",")}]`;
      await client.query(`INSERT INTO jamatnama.${table}(${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::jamatnama.${table},$1::jsonb)`, [batch]);
    }
    const count = Number((await client.query(`SELECT count(*) AS n FROM jamatnama.${table}`)).rows[0].n);
    if (count !== entry.rows) throw Error(`Row count mismatch after restoring ${table}.`);
    result.tables[table] = count;
  }
  await client.query("SELECT setval(pg_get_serial_sequence('jamatnama.audit_log','id'),GREATEST((SELECT COALESCE(max(id),1) FROM jamatnama.audit_log),1))");
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
console.log(JSON.stringify(result));
