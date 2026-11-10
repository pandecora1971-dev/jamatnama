import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { connectionConfig } from "./pg-config.mjs";
import { logError } from "./log";

export type Queryable = Pick<PoolClient, "query">;
const shared = globalThis as typeof globalThis & { __jamatnamaPool?: Pool; __jamatnamaPgTypes?: boolean };

// pg's parser registry is process-wide, while this module can be evaluated once per route bundle.
// Registering only once stops the timestamp parser from wrapping itself.
if (!shared.__jamatnamaPgTypes) {
  shared.__jamatnamaPgTypes = true;
  types.setTypeParser(1082, (value) => value);
  const parseTimestamp = types.getTypeParser(1184) as (value: string) => Date;
  types.setTypeParser(1184, (value) => parseTimestamp(value).toISOString());
}

// Connect through Supavisor's transaction mode (port 6543): pg issues only unnamed statements, so
// no prepared-statement state survives between transactions. Each instance holds few connections.
export function pool() {
  if (shared.__jamatnamaPool) return shared.__jamatnamaPool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseUnavailable("DATABASE_URL is not configured");
  const created = new Pool({
    ...connectionConfig(url),
    max: Number(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4_000,
    allowExitOnIdle: true,
    application_name: "jamatnama",
  });
  created.on("error", (error) => logError("db.pool", error));
  if (process.env.VERCEL) attachDatabasePool(created);
  shared.__jamatnamaPool = created;
  return created;
}
export async function closePool() {
  const current = shared.__jamatnamaPool;
  shared.__jamatnamaPool = undefined;
  await current?.end();
}
export class DatabaseUnavailable extends Error {
  code = "DB_UNAVAILABLE";
}
const UNAVAILABLE = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE", "53300", "57P01", "57P02", "57P03", "57014", "55P03", "DB_UNAVAILABLE"]);
export function databaseUnavailable(error: unknown) {
  const { code, message } = (error || {}) as { code?: string; message?: string };
  return (
    (typeof code === "string" && (UNAVAILABLE.has(code) || code.startsWith("08"))) ||
    /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error/.test(message || "")
  );
}
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool().query<T>(text, params);
}
/** All-or-nothing unit of work. Only deadlocks and serialization conflicts retry, since neither committed. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool().connect();
    let failure: unknown;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      failure = error;
      await client.query("ROLLBACK").catch(() => {});
      const code = (error as { code?: string }).code;
      if (attempt >= retries || (code !== "40001" && code !== "40P01")) throw error;
    } finally {
      client.release(failure && databaseUnavailable(failure) ? (failure as Error) : undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }
}
export async function revision(client: Queryable = pool()) {
  const { rows } = await client.query<{ value: string }>("SELECT value FROM jamatnama.meta WHERE key='revision'");
  return Number(rows[0].value);
}
/** Call inside the transaction that changes public data so a rollback undoes both. */
export async function bump(client: Queryable = pool()) {
  await client.query("UPDATE jamatnama.meta SET value=value+1 WHERE key='revision'");
}
let lastSweep = 0;
export async function rateLimit(bucket: string, max: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const { rows } = await query<{ count: number }>(
    `INSERT INTO jamatnama.rate_limits(bucket,count,expires) VALUES($1,1,$2)
     ON CONFLICT(bucket) DO UPDATE SET
       count=CASE WHEN rate_limits.expires<=$3 THEN 1 ELSE rate_limits.count+1 END,
       expires=CASE WHEN rate_limits.expires<=$3 THEN excluded.expires ELSE rate_limits.expires END
     RETURNING count`,
    [bucket, now + seconds, now],
  );
  // Scheduled maintenance is the main sweep; this keeps the table small if cron is delayed.
  if (now - lastSweep > 300) {
    lastSweep = now;
    void query("DELETE FROM jamatnama.rate_limits WHERE expires<=$1", [now]).catch(() => {});
  }
  return rows[0].count <= max;
}
