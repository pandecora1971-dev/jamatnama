import { cookies } from "next/headers";
import { sameSiteHost } from "./production-config.mjs";
import { rateLimit } from "./db";
import {
  cookieOptions,
  hash,
  random,
  sign,
  validSignature,
  json,
} from "./security";

export type LimitPolicy = { perBrowser: number; seconds: number; global: number };
// Endpoint-specific limits, enforced in PostgreSQL so every instance shares them. Global ceilings are
// charged only after the bot check where one applies, so unsolved requests cannot lock everyone out.
export const LIMITS = {
  challenge: { perBrowser: 20, global: 3000, seconds: 60 },
  intent: { perBrowser: 10, global: 1200, seconds: 300 },
  uploadSign: { perBrowser: 600, global: 20000, seconds: 300 },
  finalize: { perBrowser: 30, global: 3000, seconds: 300 },
  tracking: { perBrowser: 15, global: 1800, seconds: 60 },
  supports: { perBrowser: 30, global: 3000, seconds: 60 },
  login: { perBrowser: 5, global: 100, seconds: 900 },
  team: { perBrowser: 10, global: 30, seconds: 300 },
  evidenceAccess: { perBrowser: 120, global: 2000, seconds: 300 },
} satisfies Record<string, LimitPolicy>;

// Random, signed browser identifier; no IP address or browser fingerprint is collected.
// Per-IP enforcement belongs in the Vercel WAF rules (docs/DEPLOYMENT.md) so the app stores no IP data.
export async function browserLimit(scope: string, policy: LimitPolicy) {
  const jar = await cookies();
  let value = jar.get("jamatnama_guard")?.value || "";
  let [id, signature] = value.split(".");
  if (
    !/^[a-f0-9]{48}$/.test(id || "") ||
    !/^[a-f0-9]{64}$/.test(signature || "") ||
    !validSignature(`guard:${id}`, signature)
  ) {
    id = random();
    value = `${id}.${sign(`guard:${id}`)}`;
    jar.set("jamatnama_guard", value, { ...cookieOptions, maxAge: 3600 });
  }
  return rateLimit(`guard:${scope}:${hash(id)}`, policy.perBrowser, policy.seconds);
}
export function globalLimit(scope: string, policy: LimitPolicy) {
  return rateLimit(`guard:${scope}:global`, policy.global, policy.seconds);
}
export async function requestLimit(scope: string, policy: LimitPolicy) {
  return (await globalLimit(scope, policy)) && (await browserLimit(scope, policy));
}
export function throttled(seconds = 60) {
  const response = json(
    { error: "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।" },
    429,
  );
  response.headers.set("Retry-After", String(seconds));
  return response;
}
// Bounds CPU-heavy scrypt per instance; shared limits above bound attempts across instances.
const active = new Map<string, number>();
export function acquire(scope: string, max: number) {
  const count = active.get(scope) || 0;
  if (count >= max) return null;
  active.set(scope, count + 1);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active.set(scope, (active.get(scope) || 1) - 1);
    }
  };
}
export async function verifyBot(token: unknown, action: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (
    typeof token !== "string" ||
    !token ||
    token.length > 2048 ||
    !process.env.PUBLIC_ORIGIN
  )
    return false;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: token }),
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!response.ok) return false;
    const result = await response.json();
    return (
      result.success === true &&
      result.action === action &&
      typeof result.hostname === "string" && sameSiteHost(result.hostname, process.env.PUBLIC_ORIGIN)
    );
  } catch {
    return false;
  }
}
