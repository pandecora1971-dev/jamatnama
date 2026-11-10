import { currentActor, json, serverFailure } from "@/lib/security";
import { decodeCursor, listForReview } from "@/lib/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    if (!(await currentActor())) return json({ error: "লগইন করুন।" }, 401);
    const params = new URL(req.url).searchParams;
    const status = params.get("status") || "pending";
    if (status !== "pending" && status !== "published" && status !== "rejected")
      return json({ error: "সঠিক অবস্থা দিন।" }, 400);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 25, 1), 100);
    const raw = params.get("cursor");
    const cursor = raw ? decodeCursor(raw) : null;
    if (raw && !cursor) return json({ error: "পাতার চিহ্ন সঠিক নয়।" }, 400);
    const q = (params.get("q") || "").trim().slice(0, 100);
    return json(await listForReview(status, limit, cursor, q || undefined));
  } catch (error) {
    return serverFailure("admin.reports", error);
  }
}
