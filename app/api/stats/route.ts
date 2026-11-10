import { json, serverFailure } from "@/lib/security";
import { parseFilter, publicStats } from "@/lib/reports";
import { MEMO_MS, currentRevision, dataResponse, memo } from "@/lib/public-cache";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const filter = parseFilter(params);
  if (!filter.success) return json({ error: "ফিল্টার সঠিক নয়।" }, 400);
  try {
    const current = await currentRevision();
    const stats = await memo(`stats:${JSON.stringify(filter.data)}`, MEMO_MS, () => publicStats(filter.data));
    return dataResponse({ stats, revision: current }, params.get("rev"), current);
  } catch (error) {
    return serverFailure("stats", error);
  }
}
