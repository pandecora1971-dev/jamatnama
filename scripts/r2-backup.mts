// Keeps a second private bucket in step with evidence, using server-side copies (no egress).
//   R2_BACKUP_BUCKET=<name> npm run r2:backup            copy objects missing from the backup bucket
//   R2_BACKUP_BUCKET=<name> npm run r2:backup -- --verify   compare size and checksum
//   R2_BACKUP_BUCKET=<name> npm run r2:backup -- --restore  copy objects missing from primary back
//   R2_BACKUP_BUCKET=<name> npm run r2:backup -- --orphans  list primary objects with no database row
// Needs a token valid for both buckets and DATABASE_ADMIN_URL. Output holds only counts and object ids.
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionConfig } from "../lib/pg-config.mjs";
import { objectStore } from "../lib/r2";

nextEnv.loadEnvConfig(process.cwd());
const backupBucket = process.env.R2_BACKUP_BUCKET;
if (!backupBucket) throw Error("Set R2_BACKUP_BUCKET.");
if (!process.env.DATABASE_ADMIN_URL) throw Error("Set DATABASE_ADMIN_URL.");
const flag = (name: string) => process.argv.includes(`--${name}`);
const primary = objectStore(), backup = objectStore(backupBucket);
const client = new pg.Client(connectionConfig(process.env.DATABASE_ADMIN_URL));
await client.connect();
const { rows } = await client.query<{ id: string; object_key: string; size_bytes: string; sha256: string | null; state: string }>(
  "SELECT id,object_key,size_bytes,sha256,state FROM jamatnama.evidence WHERE state IN ('clean','pending_scan') ORDER BY created_at,id",
);
await client.end();
const result = { objects: rows.length, copied: 0, alreadyPresent: 0, restored: 0, problems: [] as string[], orphans: [] as string[] };
async function checksum(store: typeof primary, key: string) {
  const digest = createHash("sha256");
  for await (const chunk of (await store.stream(key)) as unknown as AsyncIterable<Uint8Array>) digest.update(chunk);
  return digest.digest("hex");
}
if (flag("orphans")) {
  const known = new Set(rows.map((r) => r.object_key));
  for (const prefix of ["evidence/", "quarantine/"])
    for await (const item of primary.list(prefix)) if (!known.has(item.key)) result.orphans.push(item.key);
} else {
  for (const row of rows) {
    const size = Number(row.size_bytes);
    if (flag("verify")) {
      const head = await backup.head(row.object_key);
      if (!head || head.size !== size) result.problems.push(`${row.id}: missing_or_wrong_size`);
      else if (row.sha256 && (await checksum(backup, row.object_key)) !== row.sha256) result.problems.push(`${row.id}: checksum`);
      continue;
    }
    if (flag("restore")) {
      const head = await primary.head(row.object_key);
      if (head?.size === size) {
        result.alreadyPresent++;
        continue;
      }
      await backup.copy(row.object_key, row.object_key, undefined, primary.bucket);
      if (row.sha256 && (await checksum(primary, row.object_key)) !== row.sha256) result.problems.push(`${row.id}: checksum_after_restore`);
      result.restored++;
      continue;
    }
    const head = await backup.head(row.object_key);
    if (head?.size === size) {
      result.alreadyPresent++;
      continue;
    }
    await primary.copy(row.object_key, row.object_key, undefined, backupBucket);
    result.copied++;
  }
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.problems.length ? 1 : 0;
