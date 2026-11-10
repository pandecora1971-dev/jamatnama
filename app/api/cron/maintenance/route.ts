import { timingSafeEqual } from "node:crypto";
import { json, serverFailure } from "@/lib/security";
import { runMaintenance } from "@/lib/evidence";
import { logEvent } from "@/lib/log";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Safe to cut short: every step is idempotent and the next run continues the work.
export const maxDuration = 60;
// Vercel Cron sends CRON_SECRET as a bearer token. Safe to run repeatedly or concurrently.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected))
    return json({ error: "অনুমতি নেই।" }, 401);
  try {
    const result = await runMaintenance();
    logEvent("cron.maintenance", result);
    return json({ ok: true, ...result });
  } catch (error) {
    return serverFailure("cron.maintenance", error);
  }
}
