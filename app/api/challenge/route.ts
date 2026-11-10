import { random, sign, json } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { uploadLimits, uploadsEnabled } from "@/lib/evidence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!(await requestLimit("challenge", LIMITS.challenge))) return throttled();
    const value = `${Date.now()}:${random()}`;
    return json({
      challenge: `${value}.${sign(`report:${value}`)}`,
      siteKey: process.env.TURNSTILE_SITE_KEY || "",
      upload: { ...uploadLimits(), enabled: uploadsEnabled() },
    });
  } catch {
    return json(
      { error: "রিপোর্ট গ্রহণ চালু করতে অ্যাডমিন সেটআপ প্রয়োজন।" },
      503,
    );
  }
}
