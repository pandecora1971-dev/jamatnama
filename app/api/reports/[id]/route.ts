import { json, serverFailure } from "@/lib/security";
import { publishedReport } from "@/lib/reports";
import { MEMO_MS, currentRevision, dataResponse, memo, publicJson } from "@/lib/public-cache";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [current, report] = await Promise.all([currentRevision(), memo(`report:${id}`, MEMO_MS, () => publishedReport(id))]);
    if (!report) return publicJson({ error: "রিপোর্ট পাওয়া যায়নি।" }, 5, 0, 404);
    return dataResponse({ report, revision: current }, new URL(req.url).searchParams.get("rev"), current);
  } catch (error) {
    return serverFailure("reports.detail", error);
  }
}
export const DELETE = () => json({ error: "অনুমতি নেই।" }, 405);
