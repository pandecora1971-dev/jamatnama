import { currentActor, json, sameOrigin, serverFailure } from "@/lib/security";
import { limitedJson } from "@/lib/uploads";
import { ReviewError, reviewReport } from "@/lib/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = sameOrigin(req) ? await currentActor() : null;
    if (!actor) return json({ error: "লগইন করুন।" }, 401);
    const { id } = await params;
    const body = await limitedJson(req, 32768).catch(() => null);
    if (!body) return json({ error: "সংরক্ষণ করা যায়নি।" }, 400);
    const result = await reviewReport(actor, id, body);
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ReviewError) return json({ error: error.message }, error.status);
    return serverFailure("admin.review", error);
  }
}
