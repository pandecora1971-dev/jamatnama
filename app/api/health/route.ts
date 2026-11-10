import { query } from "@/lib/db";
import { json, serverFailure } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// For an uptime monitor. Reports only whether the database answers.
export async function GET() {
  try {
    await query("SELECT 1");
    return json({ ok: true });
  } catch (error) {
    return serverFailure("health", error);
  }
}
