// Encrypted logical backup of the jamatnama schema from one consistent snapshot. Complements, and does
// not replace, Supabase's managed backups. Sessions and rate limits are left out on purpose.
//   BACKUP_ENCRYPTION_KEY=<64 hex> npm run db:backup -- /restricted/path/backup-name
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionConfig } from "../lib/pg-config.mjs";
nextEnv.loadEnvConfig(process.cwd());
export const BACKUP_TABLES = ["reports", "accused", "source_links", "supports", "evidence", "submission_intents", "upload_files", "upload_budget", "staff", "audit_log", "totp_replay", "meta"];
const target = process.argv[2];
if (!target) throw Error("Usage: npm run db:backup -- <new-empty-directory>");
const keyHex = process.env.BACKUP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw Error("Set BACKUP_ENCRYPTION_KEY to 64 hexadecimal characters.");
if (!process.env.DATABASE_ADMIN_URL) throw Error("Set DATABASE_ADMIN_URL.");
if (existsSync(target) && readdirSync(target).length) throw Error("Destination must be new or empty.");
mkdirSync(target, { recursive: true, mode: 0o700 });
const key = Buffer.from(keyHex, "hex");
const client = new pg.Client(connectionConfig(process.env.DATABASE_ADMIN_URL));
await client.connect();
const manifest = { format: 1, createdAt: new Date().toISOString(), migrations: [], tables: {} };
try {
  manifest.migrations = (await client.query("SELECT version,checksum FROM public.jamatnama_schema_migrations ORDER BY version")).rows;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  for (const table of BACKUP_TABLES) {
    await client.query(`DECLARE backup_cursor NO SCROLL CURSOR FOR SELECT to_jsonb(t)-'search_text' AS row FROM jamatnama.${table} t`);
    const lines = [], digest = createHash("sha256");
    let rows = 0;
    for (;;) {
      const page = await client.query("FETCH 1000 FROM backup_cursor");
      if (!page.rowCount) break;
      for (const { row } of page.rows) {
        const line = JSON.stringify(row);
        lines.push(line);
        digest.update(line + "\n");
        rows++;
      }
    }
    await client.query("CLOSE backup_cursor");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(gzipSync(lines.join("\n"))), cipher.final()]);
    writeFileSync(path.join(target, `${table}.jsonl.gz.enc`), body, { mode: 0o600 });
    manifest.tables[table] = { rows, sha256: digest.digest("hex"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }
  await client.query("COMMIT");
} finally {
  await client.end();
}
writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, tables: Object.fromEntries(Object.entries(manifest.tables).map(([t, m]) => [t, m.rows])) }));
