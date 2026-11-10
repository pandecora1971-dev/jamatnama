// Applies db/migrations/*.sql in order, once each, under an advisory lock.
// Requires DATABASE_ADMIN_URL: a direct or session-mode owner connection, never the transaction pooler.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionConfig } from "../lib/pg-config.mjs";
nextEnv.loadEnvConfig(process.cwd());
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw Error("Set DATABASE_ADMIN_URL (owner connection; never paste it into chat).");
const checkOnly = process.argv.includes("--status");
const client = new pg.Client(connectionConfig(url));
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(727001)");
  await client.query(`CREATE TABLE IF NOT EXISTS public.jamatnama_schema_migrations(
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query("ALTER TABLE public.jamatnama_schema_migrations ENABLE ROW LEVEL SECURITY");
  await client.query("REVOKE ALL ON public.jamatnama_schema_migrations FROM PUBLIC");
  const { rows } = await client.query("SELECT version, checksum FROM public.jamatnama_schema_migrations");
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw Error(`${file} changed after it was applied; add a new migration instead.`);
      console.log(`ok       ${file}`);
      continue;
    }
    if (checkOnly) {
      console.log(`pending  ${file}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO public.jamatnama_schema_migrations(version, checksum) VALUES($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`applied  ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
  await client.end();
}
