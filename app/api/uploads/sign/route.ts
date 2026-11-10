import { json, sameOrigin, serverFailure } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { limitedJson } from "@/lib/uploads";
import { productionReady } from "@/lib/production-config.mjs";
import { UploadError, signParts } from "@/lib/evidence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Issues part URLs in small batches, so a long upload never holds long-lived signatures.
export async function POST(req: Request) {
  if (!productionReady()) return json({ error: "সার্ভারের নিরাপত্তা সেটআপ অসম্পূর্ণ।" }, 503);
  if (!sameOrigin(req)) return json({ error: "অনুমোদিত উৎস থেকে চেষ্টা করুন।" }, 403);
  try {
    if (!(await requestLimit("upload-sign", LIMITS.uploadSign))) return throttled(LIMITS.uploadSign.seconds);
    const body = await limitedJson(req, 4096).catch(() => null);
    if (!body) return json({ error: "অনুরোধ সঠিক নয়।" }, 400);
    return json({ parts: await signParts(body.token, body.fileId, body.partNumbers) });
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message, code: error.code }, error.status);
    return serverFailure("uploads.sign", error);
  }
}
