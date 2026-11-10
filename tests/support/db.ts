import pg from "pg";
import { closePool } from "../../lib/db";
import { clearMemo } from "../../lib/public-cache";
import { hash, random } from "../../lib/security";
import { normalizeCategory } from "../../lib/shared";

export const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
export async function resetData() {
  const { rows } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='jamatnama'");
  await admin.query(`TRUNCATE ${rows.map((r) => `jamatnama.${r.tablename}`).join(",")} CASCADE`);
  await admin.query("INSERT INTO jamatnama.meta(key,value) VALUES('revision',0)");
  clearMemo();
}
export async function finish() {
  await admin.end();
  await closePool();
}
/** Inserts a synthetic report directly. All content is fictional test data. */
export async function seedReport(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id || random());
  const category = String(overrides.category || "রাজনৈতিক মামলা");
  const facts = (overrides.facts || {}) as Record<string, string>;
  const display = normalizeCategory(category, facts);
  const now = String(overrides.created_at || new Date().toISOString());
  await admin.query(
    `INSERT INTO jamatnama.reports(id,receipt_hash,title,description,category,facts,display_category,display_facts,division,district,upazila,ward,ward_area,incident_date,created_at,updated_at,status,fingerprint,review_note,supports_count)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19)`,
    [id, overrides.receipt_hash || hash(random()), overrides.title || "সম্পূর্ণ কাল্পনিক পরীক্ষার শিরোনাম", overrides.description || "এটি একটি সম্পূর্ণ কাল্পনিক পরীক্ষার বিবরণ, কোনো বাস্তব ঘটনা নয়।", category, JSON.stringify(facts), display.category, JSON.stringify(display.facts), overrides.division || "ঢাকা", overrides.district || "ঢাকা", overrides.upazila || "সাভার", overrides.ward || "", overrides.ward_area || "", overrides.incident_date || "2026-10-20", now, overrides.status || "published", random(), overrides.review_note || "", overrides.supports_count || 0],
  );
  return id;
}
/** Runs code as the jamatnama_scanner role so that tests exercise its real privileges. */
export async function asScanner<T>(work: () => Promise<T>) {
  const app = process.env.DATABASE_URL;
  await closePool();
  process.env.DATABASE_URL = process.env.SCANNER_DATABASE_URL;
  try {
    return await work();
  } finally {
    await closePool();
    process.env.DATABASE_URL = app;
  }
}
export const validReport = (title = `পরীক্ষার কাল্পনিক শিরোনাম ${random()}`) => ({
  category: "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ",
  title,
  description: "এটি সফটওয়্যার পরীক্ষার একটি সম্পূর্ণ কাল্পনিক বিবরণ। কোনো বাস্তব ব্যক্তি বা ঘটনার সঙ্গে সম্পর্ক নেই।",
  division: "ঢাকা",
  district: "ঢাকা",
  upazila: "সাভার",
  ward: "5",
  wardArea: "সাভার পৌরসভা",
  incidentDate: "2026-10-20",
  declaration: "1" as const,
  facts: {  },
  accused: [{ name: "কাল্পনিক অভিযুক্ত", information: "শুধু সফটওয়্যার পরীক্ষার তথ্য।" }],
  sourceLinks: ["https://example.com/news/test"],
});
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const samples = {
  pdf: (size = 2000) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(size - 9, 0x20)]),
  mp4: (size = 4096) => {
    const b = Buffer.alloc(size);
    b.writeUInt32BE(24, 0);
    b.write("ftypisom", 4);
    b.write("isom", 16);
    return b;
  },
  html: () => Buffer.from("<html><script>alert(1)</script></html>".padEnd(2000, " ")),
};
export { crcTable };
