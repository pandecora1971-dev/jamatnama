// Enables LOGIN for a least-privilege role. The password comes from an environment variable and
// only a SCRAM verifier crosses the wire, so it cannot appear in server logs or statement history.
// Usage: DB_ROLE_PASSWORD=... npm run db:set-password -- jamatnama_app
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionConfig } from "../lib/pg-config.mjs";
nextEnv.loadEnvConfig(process.cwd());
const role = process.argv[2];
if (!["jamatnama_app", "jamatnama_scanner"].includes(role)) throw Error("Role must be jamatnama_app or jamatnama_scanner.");
const password = process.env.DB_ROLE_PASSWORD;
if (!password || password.length < 24) throw Error("Set DB_ROLE_PASSWORD (at least 24 characters) in the environment.");
if (!process.env.DATABASE_ADMIN_URL) throw Error("Set DATABASE_ADMIN_URL.");
const salt = randomBytes(16), iterations = 4096;
const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const stored = createHash("sha256").update(hmac(salted, "Client Key")).digest();
const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${stored.toString("base64")}:${hmac(salted, "Server Key").toString("base64")}`;
const client = new pg.Client(connectionConfig(process.env.DATABASE_ADMIN_URL));
await client.connect();
try {
  await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${verifier}'`);
  console.log(`${role} can now log in. Store its connection string only in provider secret settings.`);
} finally {
  await client.end();
}
