import { currentActor, json, serverFailure } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { UploadError, evidenceLink } from "@/lib/evidence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bytes never pass through this function: an audited, two-minute signed link is issued per click.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await currentActor();
    if (!actor) return json({ error: "অনুমতি নেই।" }, 401);
    if (!(await requestLimit("evidence-access", LIMITS.evidenceAccess))) return throttled(LIMITS.evidenceAccess.seconds);
    const { id } = await params;
    const url = await evidenceLink(actor, id);
    return new Response(null, {
      status: 303,
      headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message, code: error.code }, error.status);
    return serverFailure("admin.evidence", error);
  }
}
