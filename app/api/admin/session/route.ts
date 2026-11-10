import { query } from "@/lib/db";
import { currentActor, audit, random, hash, serverFailure } from "@/lib/security";
import { cookies } from "next/headers";
import {
  passwordValid,
  session,
  revokeSession,
  cookieOptions,
  json,
  sameOrigin,
} from "@/lib/security";
import { consumeTotp } from "@/lib/admin-auth";
import { openSecret } from "@/lib/secrets";
import { LIMITS, browserLimit, globalLimit, throttled, acquire, verifyBot } from "@/lib/abuse";
import { rateLimit } from "@/lib/db";
import { limitedJson } from "@/lib/uploads";
import { productionReady } from "@/lib/production-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verified when the account is unknown, so response time does not reveal which usernames exist.
const requiresBotCheck = () => process.env.NODE_ENV === "production" || process.env.ADMIN_REQUIRE_BOT_CHECK === "true";
const DECOY_HASH = `decoy:${"0".repeat(128)}`;

export async function GET() {
  let actor = null;
  try {
    actor = await currentActor();
  } catch (error) {
    return serverFailure("admin.session", error);
  }
  return json({
    authenticated: Boolean(actor),
    actor,
    configured: !!process.env.ADMIN_PASSWORD_HASH,
    twoFactor: !!process.env.ADMIN_TOTP_SECRET,
    siteKey: requiresBotCheck() ? process.env.TURNSTILE_SITE_KEY || "" : "",
  });
}

export async function POST(req: Request) {
  if (!productionReady()) return json({ error: "সার্ভারের নিরাপত্তা সেটআপ অসম্পূর্ণ।" }, 503);
  if (!sameOrigin(req)) return json({ error: "অনুমোদিত উৎস প্রয়োজন।" }, 403);
  let release: (() => void) | null = null;
  try {
    if (!(await browserLimit("admin-login", LIMITS.login))) return throttled(LIMITS.login.seconds);
    const body = await limitedJson(req).catch(() => null);
    if (!body) return json({ error: "লগইন করা যায়নি।" }, 400);
    const { password, code, botToken, username } = body;
    if (requiresBotCheck()) {
      if (!(await verifyBot(botToken, "admin-login")))
        return json({ error: "নিরাপত্তা যাচাই আবার সম্পন্ন করুন।" }, 400);
    }
    if (typeof password !== "string" || password.length > 500) return json({ error: "লগইন করা যায়নি।" }, 401);
    
    // Counted after the bot check: unsolved requests cannot lock out an account or all staff.
    const account = typeof username === "string" && username ? username.toLowerCase().slice(0, 40) : "superadmin";
    if (!(await globalLimit("admin-login", LIMITS.login)) || !(await rateLimit(`login-account:${hash(account)}`, 10, LIMITS.login.seconds)))
      return throttled(LIMITS.login.seconds);
    release = acquire("password-check", 2);
    if (!release) return throttled(10);

    if (account !== "superadmin") {
      const { rows } = await query<{ id: string; username: string; totp_secret: string; password_hash: string }>(
        "SELECT id,username,totp_secret,password_hash FROM jamatnama.staff WHERE username=$1 AND active",
        [account],
      );
      const row = rows[0];
      const passwordMatches = await passwordValid(password, row?.password_hash || DECOY_HASH);
      if (!row || !passwordMatches) return json({ error: "লগইন করা যায়নি।" }, 401);
      
      if (typeof code !== "string" || !(await consumeTotp(openSecret(row.totp_secret), code, Date.now(), row.id))) {
        return json({ error: "অথেনটিকেটর কোড সঠিক নয়।" }, 401);
      }
      const token = random();
      const jar = await cookies();
      await revokeSession(jar.get("jamatnama_admin")?.value || "");
      await query("DELETE FROM jamatnama.staff_sessions WHERE expires<=$1", [Date.now()]);
      await query("INSERT INTO jamatnama.staff_sessions(token_hash,staff_id,expires) VALUES($1,$2,$3)", [hash(token), row.id, Date.now() + 3600000]);
      jar.set("jamatnama_admin", token, { ...cookieOptions, maxAge: 3600 });
      const actor = { id: row.id, username: row.username, role: "moderator" as const };
      await audit(actor, "login");
      return json({ ok: true, actor });
    }

    // Verify Superadmin password
    if (!(await passwordValid(password))) return json({ error: "পাসওয়ার্ড সঠিক নয়।" }, 401);

    const ownerSecret = process.env.ADMIN_TOTP_SECRET;
    if (ownerSecret && (typeof code !== "string" || !(await consumeTotp(ownerSecret, code)))) {
      return json({ error: "অথেনটিকেটর কোড সঠিক নয়।" }, 401);
    }

    // Login successful
    const jar = await cookies();
    await revokeSession(jar.get("jamatnama_admin")?.value || "");
    jar.set("jamatnama_admin", await session(), { ...cookieOptions, maxAge: 3600 });
    const actor = { id: "owner", username: "superadmin", role: "superadmin" as const };
    await audit(actor, "login");
    return json({ ok: true, actor });
  } catch (error) {
    return serverFailure("admin.login", error);
  } finally {
    release?.();
  }
}
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({}, 403);
  try {
    const actor=await currentActor();
    if(actor) await audit(actor,"logout");
    const jar = await cookies();
    await revokeSession(jar.get("jamatnama_admin")?.value || "");
    jar.delete("jamatnama_admin");
    return json({ ok: true });
  } catch (error) {
    return serverFailure("admin.logout", error);
  }
}
