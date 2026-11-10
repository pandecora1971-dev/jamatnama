import { z } from "zod";
import { json, sameOrigin, serverFailure } from "@/lib/security";
import { reportSchema } from "@/lib/validation";
import { limitedJson } from "@/lib/uploads";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { productionReady } from "@/lib/production-config.mjs";
import { UploadError, finalizeSubmission } from "@/lib/evidence";
import { PAGE_SIZES, decodeCursor, listPublished, parseFilter } from "@/lib/reports";
import { MEMO_MS, currentRevision, dataResponse, memo } from "@/lib/public-cache";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const filesSchema = z.array(z.string().regex(/^[a-f0-9]{48}$/)).max(50);
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const filter = parseFilter(params);
  if (!filter.success) return json({ error: "ফিল্টার সঠিক নয়।" }, 400);
  const limit = Number(params.get("limit") || 6);
  if (!PAGE_SIZES.includes(limit)) return json({ error: "পাতার আকার সঠিক নয়।" }, 400);
  const rawCursor = params.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return json({ error: "পাতার চিহ্ন সঠিক নয়।" }, 400);
  try {
    const current = await currentRevision();
    const body = await memo(
      `list:${JSON.stringify(filter.data)}:${limit}:${rawCursor || ""}`,
      MEMO_MS,
      () => listPublished(filter.data, limit, cursor),
    );
    return dataResponse({ ...body, revision: current }, params.get("rev"), current);
  } catch (error) {
    return serverFailure("reports.list", error);
  }
}
// Final step of a submission: binds the validated uploads and report under one transaction.
export async function POST(req: Request) {
  if (!productionReady())
    return json({ error: "সার্ভারের নিরাপত্তা সেটআপ অসম্পূর্ণ।" }, 503);
  if (!sameOrigin(req))
    return json({ error: "অনুমোদিত উৎস থেকে জমা দিন।" }, 403);
  try {
    if (!(await requestLimit("finalize", LIMITS.finalize))) return throttled(LIMITS.finalize.seconds);
    const body = await limitedJson(req, 256 * 1024).catch(() => null);
    if (!body) return json({ error: "রিপোর্ট জমা দেওয়া যায়নি। তথ্য যাচাই করে আবার চেষ্টা করুন।" }, 400);
    const parsed = reportSchema.safeParse(body.report);
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    const files = filesSchema.safeParse(body.fileIds ?? []);
    if (!files.success) return json({ error: "ফাইলের তালিকা সঠিক নয়।" }, 400);
    return json(await finalizeSubmission(String(body.token), parsed.data, files.data), 201);
  } catch (error) {
    if (error instanceof UploadError)
      return json({ error: error.message, code: error.code, fileId: error.fileId }, error.status);
    return serverFailure("reports.finalize", error);
  }
}
