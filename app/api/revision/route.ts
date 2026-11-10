import { serverFailure } from "@/lib/security";
import { REVISION_CDN_SECONDS, REVISION_STALE_SECONDS, currentRevision, publicJson } from "@/lib/public-cache";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The polling target that replaces process-local events. Most polls end at the CDN, not here.
export async function GET() {
  try {
    return publicJson({ revision: await currentRevision() }, REVISION_CDN_SECONDS, REVISION_STALE_SECONDS);
  } catch (error) {
    return serverFailure("revision", error);
  }
}
