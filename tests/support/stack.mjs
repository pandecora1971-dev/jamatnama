// Starts real PostgreSQL 17 (embedded binaries) with simulated Supabase API roles, the R2 double and
// a clamd double. Used by the test runner, the end-to-end flow, the load test and local development.
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createTcp } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { startFakeR2 } from "./fake-r2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_DB_PASSWORD = "local-only-postgres-password";
export const LOCAL_APP_PASSWORD = "local-only-app-role-password-000000";
export const LOCAL_SCANNER_PASSWORD = "local-only-scanner-role-password-00";
export const EICAR_MARKER = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export function startFakeClamd(port = 0) {
  const scanned = { count: 0 };
  const server = createTcp((socket) => {
    let buffer = Buffer.alloc(0), command = null, content = [], done = false;
    socket.on("error", () => {});
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === "zPING") return socket.end("PONG\0");
        if (command !== "zINSTREAM") return socket.end("UNKNOWN COMMAND\0");
      }
      while (!done && buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (size === 0) {
          done = true;
          scanned.count++;
          socket.end(Buffer.concat(content).includes(EICAR_MARKER) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (buffer.length < 4 + size) return;
        content.push(Buffer.from(buffer.subarray(4, 4 + size)));
        buffer = buffer.subarray(4 + size);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () =>
    resolve({ port: server.address().port, scanned, close: () => new Promise((r) => server.close(r)) })));
}
async function freePort() {
  const probe = createTcp();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
export function runScript(script, env, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) throw Error(`${script} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
export async function createDatabase(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
export async function startStack({ dataDir, publicOrigin = "http://127.0.0.1:3000", pgPort, r2Port, clamdPort, persistent = false, maxConnections = 200 } = {}) {
  const directory = dataDir || mkdtempSync(path.join(tmpdir(), "jamatnama-stack-"));
  const port = pgPort || (await freePort());
  const postgres = new EmbeddedPostgres({
    databaseDir: directory, user: "postgres", password: LOCAL_DB_PASSWORD, port, persistent,
    onLog: () => {}, onError: () => {},
    initdbFlags: ["--encoding=UTF8", "--locale-provider=builtin", "--builtin-locale=C.UTF-8"],
    postgresFlags: ["-c", `max_connections=${maxConnections}`, "-c", "shared_buffers=256MB"],
  });
  let initialised = false;
  try {
    await postgres.initialise();
    initialised = true;
  } catch (error) {
    if (!persistent) throw error;
  }
  await postgres.start();
  const adminBase = `postgres://postgres:${LOCAL_DB_PASSWORD}@127.0.0.1:${port}`;
  const bootstrap = new pg.Client({ connectionString: `${adminBase}/postgres` });
  await bootstrap.connect();
  const exists = await bootstrap.query("SELECT 1 FROM pg_database WHERE datname='jamatnama'");
  if (!exists.rowCount) await bootstrap.query("CREATE DATABASE jamatnama");
  // The same API roles Supabase creates, so access-control tests exercise the real revokes.
  for (const role of ["anon", "authenticated", "service_role"]) {
    const has = await bootstrap.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (!has.rowCount) await bootstrap.query(`CREATE ROLE ${role} LOGIN PASSWORD 'local-${role}-password'`);
  }
  await bootstrap.end();
  const adminUrl = `${adminBase}/jamatnama`;
  const migrateEnv = { DATABASE_ADMIN_URL: adminUrl };
  runScript("db-migrate.mjs", migrateEnv);
  runScript("db-set-password.mjs", { ...migrateEnv, DB_ROLE_PASSWORD: LOCAL_APP_PASSWORD }, ["jamatnama_app"]);
  runScript("db-set-password.mjs", { ...migrateEnv, DB_ROLE_PASSWORD: LOCAL_SCANNER_PASSWORD }, ["jamatnama_scanner"]);
  const accessKeyId = "local-access-key";
  const secretAccessKey = "local-secret-key";
  const r2 = await startFakeR2({ port: r2Port || 0, accessKeyId, secretAccessKey, allowedOrigins: [publicOrigin] });
  const clamd = await startFakeClamd(clamdPort || 0);
  const env = {
    DATABASE_URL: `postgres://jamatnama_app:${LOCAL_APP_PASSWORD}@127.0.0.1:${port}/jamatnama`,
    DATABASE_ADMIN_URL: adminUrl,
    SCANNER_DATABASE_URL: `postgres://jamatnama_scanner:${LOCAL_SCANNER_PASSWORD}@127.0.0.1:${port}/jamatnama`,
    R2_ENDPOINT: r2.endpoint,
    R2_BUCKET: "jamatnama-evidence",
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    CLAMD_HOST: "127.0.0.1",
    CLAMD_PORT: String(clamd.port),
  };
  return {
    env, r2, clamd, adminBase, port, initialised,
    stop: async () => {
      await clamd.close();
      await r2.close();
      await postgres.stop();
      if (!persistent) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
/** Throwaway secrets for local runs only. */
export function testSecrets() {
  const salt = randomBytes(8).toString("hex");
  return { salt, sessionSecret: randomBytes(32).toString("hex"), mfaKey: randomBytes(32).toString("hex"), cronSecret: randomBytes(24).toString("hex") };
}
export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
