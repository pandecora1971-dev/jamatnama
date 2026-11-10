import { query } from "@/lib/db";
import { hash, json, sameOrigin, serverFailure } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
import { limitedJson } from "@/lib/uploads";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "অনুমোদিত উৎস থেকে চেষ্টা করুন।" }, 403);
  try {
    if (!(await requestLimit("tracking", LIMITS.tracking))) return throttled();
    const body = await limitedJson(req, 1024).catch(() => null);
    const receipt = body?.receipt;
    if (typeof receipt !== "string" || !/^[a-f0-9]{48}$/.test(receipt))
      return json({ error: "সঠিক গোপন ট্র্যাকিং কোড দিন।" }, 400);
    const { rows } = await query<{ id: string; status: string; created_at: string; review_note: string }>(
      "SELECT id,status,created_at,review_note FROM jamatnama.reports WHERE receipt_hash=$1",
      [hash(receipt)],
    );
    const row = rows[0];
    if (!row) return json({ error: "এই কোডে কোনো রিপোর্ট পাওয়া যায়নি।" }, 404);
    return json({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      note: row.review_note,
    });
  } catch (error) {
    return serverFailure("track", error);
  }
}
