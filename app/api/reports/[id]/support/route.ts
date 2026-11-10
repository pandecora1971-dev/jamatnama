import { cookies } from "next/headers";
import { transaction } from "@/lib/db";
import { random, hash, json, sameOrigin, cookieOptions, serverFailure } from "@/lib/security";
import { LIMITS, requestLimit, throttled } from "@/lib/abuse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req))
    return json({ error: "অনুমোদিত উৎস থেকে চেষ্টা করুন।" }, 403);
  try {
    if (!(await requestLimit("supports", LIMITS.supports))) return throttled();
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return json({ error: "রিপোর্ট পাওয়া যায়নি।" }, 404);
    const jar = await cookies();
    let token = jar.get("jamatnama_support")?.value;
    if (!token || !/^[a-f0-9]{48}$/.test(token)) {
      token = random();
      jar.set("jamatnama_support", token, {
        ...cookieOptions,
        maxAge: 365 * 86400,
      });
    }
    const key = hash(token);
    // Repeating a vote changes nothing. Votes do not bump the revision, so they never flush caches.
    const supports = await transaction(async (client) => {
      const { rows } = await client.query<{ supports_count: number }>(
        "SELECT supports_count FROM jamatnama.reports WHERE id=$1 AND status='published' FOR UPDATE",
        [id],
      );
      if (!rows[0]) return null;
      const inserted = await client.query(
        "INSERT INTO jamatnama.supports(report_id,token) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, key],
      );
      if (!inserted.rowCount) return rows[0].supports_count;
      const updated = await client.query<{ supports_count: number }>(
        "UPDATE jamatnama.reports SET supports_count=supports_count+1 WHERE id=$1 RETURNING supports_count",
        [id],
      );
      return updated.rows[0].supports_count;
    });
    if (supports === null) return json({ error: "রিপোর্ট পাওয়া যায়নি।" }, 404);
    return json({ supports });
  } catch (error) {
    return serverFailure("reports.support", error);
  }
}
