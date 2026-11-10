import { json, sameOrigin, serverFailure } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { limitedJson } from "@/lib/uploads";
import { productionReady } from "@/lib/production-config.mjs";
import { UploadError, completeUpload } from "@/lib/evidence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  if (!productionReady()) return json({ error: "সার্ভারের নিরাপত্তা সেটআপ অসম্পূর্ণ।" }, 503);
  if (!sameOrigin(req)) return json({ error: "অনুমোদিত উৎস থেকে চেষ্টা করুন।" }, 403);
  try {
    if (!(await requestLimit("upload-complete", LIMITS.finalize))) return throttled(LIMITS.finalize.seconds);
    const body = await limitedJson(req, 1024).catch(() => null);
    if (!body) return json({ error: "অনুরোধ সঠিক নয়।" }, 400);
    return json(await completeUpload(body.token, body.fileId));
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message, code: error.code, fileId: error.fileId }, error.status);
    return serverFailure("uploads.complete", error);
  }
}
