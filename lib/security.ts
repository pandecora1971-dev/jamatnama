import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { query, pool, databaseUnavailable, type Queryable } from "./db";
import { productionReady, matchesPublicOrigin } from "./production-config.mjs";
import { logError } from "./log";
import { cookies } from "next/headers";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const random = () => randomBytes(24).toString("hex");
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32)
    throw new Error("প্রথমে অ্যাডমিন সেটআপ সম্পন্ন করুন।");
  return s;
}
export function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}
function equal(a: string, b: string) {
  return (
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function validSignature(v: string, s: string) {
  return equal(sign(v), s);
}
const derive = promisify(scrypt);
export async function passwordValid(value: string, encoded = process.env.ADMIN_PASSWORD_HASH || "") {
  const [salt, expected] = encoded.split(":");
  if (!salt || !/^[a-f0-9]{128}$/.test(expected || "")) return false;
  const result = (await derive(value, salt, 64)) as Buffer;
  return equal(result.toString("hex"), expected);
}
const credentialVersion = () =>
  sign(
    `credentials:${process.env.ADMIN_PASSWORD_HASH}:${process.env.ADMIN_TOTP_SECRET || ""}`,
  );
/** Superadmin sessions are short-lived on purpose; moderators keep theirs for a week. */
export const SUPERADMIN_SESSION_MS = 3600_000;
export const STAFF_SESSION_MS = 7 * 24 * 3600_000;
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;

export async function session() {
  const token = random(),
    expires = Date.now() + SUPERADMIN_SESSION_MS;
  await query("DELETE FROM jamatnama.admin_sessions WHERE expires<=$1", [Date.now()]);
  await query(
    "INSERT INTO jamatnama.admin_sessions(token_hash,expires,credential_version) VALUES($1,$2,$3)",
    [hash(token), expires, credentialVersion()],
  );
  return token;
}
/** Returns when a live superadmin session ends, or null when the token is not one. */
async function superadminSessionExpiry(token: string): Promise<number | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { rows } = await query<{ expires: string; credential_version: string }>(
    "SELECT expires,credential_version FROM jamatnama.admin_sessions WHERE token_hash=$1",
    [hash(token)],
  );
  const expires = Number(rows[0]?.expires);
  const live = rows[0] && expires > Date.now() && equal(rows[0].credential_version, credentialVersion());
  return live ? expires : null;
}
export async function sessionValid(token: string) {
  return (await superadminSessionExpiry(token)) !== null;
}
export async function revokeSession(token: string) {
  if (!TOKEN_PATTERN.test(token)) return;
  const key = hash(token);
  await query("DELETE FROM jamatnama.staff_sessions WHERE token_hash=$1", [key]);
  await query("DELETE FROM jamatnama.admin_sessions WHERE token_hash=$1", [key]);
}
export async function isAdmin() {
  return Boolean(await currentActor());
}
export function sameOrigin(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    if (process.env.PUBLIC_ORIGIN) return matchesPublicOrigin(origin, process.env.PUBLIC_ORIGIN);
    if (process.env.NODE_ENV === "production") return false;
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      (origin === new URL(req.url).origin || parsed.host === req.headers.get("host"));
  } catch {
    return false;
  }
}
export const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure:
    process.env.NODE_ENV === "production" ||
    process.env.COOKIE_SECURE === "true",
  path: "/",
};
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
/** Maps an unexpected failure to a safe response. Details stay out of the body and the logs. */
export function serverFailure(scope: string, error: unknown) {
  logError(scope, error);
  return databaseUnavailable(error)
    ? json({ error: "সার্ভার এখন ব্যস্ত। কিছুক্ষণ পরে আবার চেষ্টা করুন।" }, 503, { "Retry-After": "5" })
    : json({ error: "অনুরোধটি সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।" }, 500);
}

export type Actor = { id: string; username: string; role: "superadmin" | "moderator" };
export const SYSTEM_ACTOR: Actor = { id: "public", username: "anonymous", role: "moderator" };
export type ActorSession = { actor: Actor; expiresAt: number };
const SUPERADMIN: Actor = { id: "owner", username: "superadmin", role: "superadmin" };

async function staffSession(token: string): Promise<ActorSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { rows } = await query<{ id: string; username: string; expires: string }>(
    "SELECT s.id,s.username,t.expires FROM jamatnama.staff s JOIN jamatnama.staff_sessions t ON t.staff_id=s.id WHERE t.token_hash=$1 AND t.expires>$2 AND s.active",
    [hash(token), Date.now()],
  );
  const row = rows[0];
  return row
    ? { actor: { id: row.id, username: row.username, role: "moderator" }, expiresAt: Number(row.expires) }
    : null;
}
export async function staffIdentity(token: string): Promise<Actor | null> {
  return (await staffSession(token))?.actor ?? null;
}
/** The signed-in actor and when their session ends, so the panel can sign out on time. */
export async function currentSession(): Promise<ActorSession | null> {
  if (!productionReady() || !process.env.SESSION_SECRET) return null;
  const token = (await cookies()).get("jamatnama_admin")?.value;
  if (!token) return null;
  const superadminExpiry = await superadminSessionExpiry(token);
  if (superadminExpiry !== null) return { actor: SUPERADMIN, expiresAt: superadminExpiry };
  return staffSession(token);
}
export async function currentActor(): Promise<Actor | null> {
  return (await currentSession())?.actor ?? null;
}
/** Pass the transaction client so the audit entry commits or rolls back with the change it records. */
export async function audit(actor: Actor, action: string, target = "", detail = "", client: Queryable = pool()) {
  await client.query(
    "INSERT INTO jamatnama.audit_log(actor_id,actor_name,action,target,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [actor.id, actor.username, action, target, detail, new Date().toISOString()],
  );
}
export async function encodePassword(value: string) {
  const salt=random(); const derived=await derive(value,salt,64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
