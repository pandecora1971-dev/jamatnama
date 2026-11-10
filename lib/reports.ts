import { z } from "zod";
import { query, transaction, bump, type Queryable } from "./db";
import { reviewFlags } from "./moderation";
import { audit, type Actor, hash } from "./security";
import {
  normalizeCategory,
  normalizeWard,
  type AccusedPerson,
  type PublicStats,
  type Report,
} from "./shared";
import { reportSchema } from "./validation";

// Explicit allow-list: accused details, notes, hashes and evidence can never reach a public query.
const PUBLIC_COLUMNS =
  "id,title,description,display_category,display_facts,division,district,upazila,ward,ward_area,incident_date,created_at,status,supports_count";
type PublicRow = {
  id: string; title: string; description: string; display_category: string; display_facts: Record<string, string>;
  division: string; district: string; upazila: string; ward: string; ward_area: string;
  incident_date: string; created_at: string; status: Report["status"]; supports_count: number;
};
const toPublic = (r: PublicRow): Report => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.display_category,
  facts: r.display_facts,
  division: r.division,
  district: r.district,
  upazila: r.upazila,
  ...(r.ward && r.ward_area ? { ward: r.ward, wardArea: r.ward_area } : {}),
  incidentDate: r.incident_date,
  createdAt: r.created_at,
  status: r.status,
  supports: r.supports_count,
});
const text = (max: number) => z.string().trim().max(max).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
export const filterSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  category: text(200),
  division: text(60),
  district: text(60),
  upazila: text(80),
  ward: z.string().trim().max(8).transform(normalizeWard).optional(),
  wardArea: text(100),
  from: day,
  to: day,
});
export type ReportFilter = z.infer<typeof filterSchema>;
export function parseFilter(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of ["q", "category", "division", "district", "upazila", "ward", "wardArea", "from", "to"]) {
    const value = params.get(key);
    if (value && value.trim()) raw[key] = value;
  }
  return filterSchema.safeParse(raw);
}
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
function filterSql(filter: ReportFilter, params: unknown[]) {
  const where = ["status='published'"];
  const add = (sql: (slot: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (filter.category) add((s) => `display_category=${s}`, filter.category.normalize("NFC"));
  if (filter.division) add((s) => `division=${s}`, filter.division);
  if (filter.district) add((s) => `district=${s}`, filter.district);
  if (filter.upazila) add((s) => `upazila=${s}`, filter.upazila);
  if (filter.ward) add((s) => `ward=${s}`, filter.ward);
  if (filter.wardArea) {
    where.push("ward_area<>''");
    add((s) => `ward_area ILIKE ${s} ESCAPE '\\'`, `%${likeEscape(filter.wardArea)}%`);
  }
  if (filter.from) add((s) => `incident_date>=${s}::date`, filter.from);
  if (filter.to) add((s) => `incident_date<=${s}::date`, filter.to);
  if (filter.q) add((s) => `search_text ILIKE ${s} ESCAPE '\\'`, `%${likeEscape(filter.q)}%`);
  return where;
}
export const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
export function decodeCursor(cursor: string) {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt || "") || !/^[A-Za-z0-9_-]{1,100}$/.test(id || "")) return null;
  return { createdAt, id };
}
export const COUNT_CAP = 10000;
export const PAGE_SIZES = [6, 12, 18, 24, 30, 36, 42, 48];
export async function listPublished(filter: ReportFilter, limit: number, cursor?: { createdAt: string; id: string } | null) {
  const params: unknown[] = [];
  const where = filterSql(filter, params);
  const base = where.join(" AND ");
  let total: number | null = null;
  // The count only accompanies a first page, so paging further never repeats it.
  if (!cursor) {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*) AS n FROM (SELECT 1 FROM jamatnama.reports WHERE ${base} LIMIT ${COUNT_CAP + 1}) c`,
      params,
    );
    total = Number(rows[0].n);
  }
  const pageParams = [...params];
  const pageWhere = [...where];
  if (cursor) {
    pageParams.push(cursor.createdAt, cursor.id);
    pageWhere.push(`(created_at,id)<($${pageParams.length - 1}::timestamptz,$${pageParams.length})`);
  }
  pageParams.push(limit + 1);
  const { rows } = await query<PublicRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM jamatnama.reports WHERE ${pageWhere.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $${pageParams.length}`,
    pageParams,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    reports: page.map(toPublic),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    total: total === null ? null : Math.min(total, COUNT_CAP),
    totalCapped: total !== null && total > COUNT_CAP,
  };
}
export async function publishedReport(id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const { rows } = await query<PublicRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM jamatnama.reports WHERE id=$1 AND status='published'`,
    [id],
  );
  return rows[0] ? toPublic(rows[0]) : null;
}
export async function publicStats(filter: ReportFilter): Promise<PublicStats> {
  const params: unknown[] = [];
  const base = filterSql(filter, params).join(" AND ");
  const [groups, metrics, latest] = await Promise.all([
    query<{ display_category: string | null; division: string | null; district: string | null; n: string; today: string }>(
      `SELECT display_category,division,district,count(*) AS n,
         count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Dhaka')::date=(now() AT TIME ZONE 'Asia/Dhaka')::date) AS today
       FROM jamatnama.reports WHERE ${base}
       GROUP BY GROUPING SETS ((display_category),(division),(district),())`,
      params,
    ),
    query<{ display_category: string; key: string; total: string }>(
      `SELECT display_category,f.key,sum(CASE WHEN f.value ~ '^[0-9]+([.][0-9]+)?$' THEN f.value::numeric ELSE 0 END) AS total
       FROM jamatnama.reports, jsonb_each_text(display_facts) f WHERE ${base}
       GROUP BY display_category,f.key`,
      params,
    ),
    query<{ display_category: string; division: string; incident_date: string }>(
      `SELECT display_category,division,incident_date FROM jamatnama.reports WHERE ${base} ORDER BY created_at DESC,id DESC LIMIT 1`,
      params,
    ),
  ]);
  const stats: PublicStats = { total: 0, today: 0, categories: {}, divisions: {}, districts: {}, metrics: {}, latest: null };
  for (const row of groups.rows) {
    const n = Number(row.n);
    if (row.display_category !== null) stats.categories[row.display_category] = n;
    else if (row.division !== null) stats.divisions[row.division] = n;
    else if (row.district !== null) stats.districts[row.district] = n;
    else {
      stats.total = n;
      stats.today = Number(row.today);
    }
  }
  for (const row of metrics.rows) (stats.metrics[row.display_category] ||= {})[row.key] = Number(row.total);
  const top = latest.rows[0];
  if (top) stats.latest = { category: top.display_category, division: top.division, incidentDate: top.incident_date };
  return stats;
}

export type NewReport = z.infer<typeof reportSchema>;
export const reportFingerprint = (d: Pick<NewReport, "category" | "title" | "description" | "district" | "incidentDate">, id?: string) => {
  const isGeneric = !d.title || d.title === "অনির্ধারিত শিরোনাম" || !d.description || d.description === "বিস্তারিত বিবরণ দেওয়া হয়নি।";
  return hash([isGeneric ? (id || "") : "", d.category, d.title.trim().toLowerCase(), d.description.trim().toLowerCase(), d.district, d.incidentDate].join("|"));
};
export async function fingerprintExists(fingerprint: string) {
  const { rowCount } = await query("SELECT 1 FROM jamatnama.reports WHERE fingerprint=$1", [fingerprint]);
  return Boolean(rowCount);
}
export async function insertReport(client: Queryable, id: string, receiptHash: string, d: NewReport, now: string) {
  const display = normalizeCategory(d.category, d.facts);
  await client.query(
    `INSERT INTO jamatnama.reports(id,receipt_hash,title,description,category,facts,display_category,display_facts,division,district,upazila,ward,ward_area,incident_date,created_at,updated_at,fingerprint)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)`,
    [id, receiptHash, d.title, d.description, d.category, JSON.stringify(d.facts), display.category, JSON.stringify(display.facts), d.division, d.district, d.upazila, d.ward, d.wardArea, d.incidentDate, now, reportFingerprint(d, id)],
  );
  for (const [position, person] of d.accused.entries())
    await client.query("INSERT INTO jamatnama.accused(report_id,position,name,information) VALUES($1,$2,$3,$4)", [id, position, person.name, person.information]);
  for (const [position, url] of d.sourceLinks.entries())
    await client.query("INSERT INTO jamatnama.source_links(report_id,position,url) VALUES($1,$2,$3)", [id, position, url]);
}

type AdminRow = PublicRow & { review_note: string; updated_at: string };
export type EvidenceSummary = { id: string; report_id: string; mime: string; size_bytes: number; state: string };
export async function listForReview(status: Report["status"], limit: number, cursor?: { createdAt: string; id: string } | null, q?: string) {
  const params: unknown[] = [status];
  const where = ["status=$1"];
  if (q) {
    params.push(`%${likeEscape(q)}%`);
    where.push(`search_text ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    where.push(`(created_at,id)<($${params.length - 1}::timestamptz,$${params.length})`);
  }
  params.push(limit + 1);
  const [{ rows }, counts] = await Promise.all([
    query<AdminRow>(
      `SELECT ${PUBLIC_COLUMNS},review_note,updated_at FROM jamatnama.reports WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $${params.length}`,
      params,
    ),
    query<{ status: string; n: string }>("SELECT status,count(*) AS n FROM jamatnama.reports GROUP BY status"),
  ]);
  const page = rows.slice(0, limit), ids = page.map((r) => r.id);
  const [links, accused, evidence] = await Promise.all([
    query<{ report_id: string; url: string }>("SELECT report_id,url FROM jamatnama.source_links WHERE report_id=ANY($1) ORDER BY report_id,position", [ids]),
    query<AccusedPerson & { report_id: string }>("SELECT report_id,name,information FROM jamatnama.accused WHERE report_id=ANY($1) ORDER BY report_id,position", [ids]),
    query<EvidenceSummary>("SELECT id,report_id,mime,size_bytes::float8 AS size_bytes,state FROM jamatnama.evidence WHERE report_id=ANY($1) ORDER BY created_at,id", [ids]),
  ]);
  const last = page[page.length - 1];
  return {
    reports: page.map((r) => ({
      ...toPublic(r),
      updatedAt: r.updated_at,
      reviewFlags: reviewFlags(r.title, r.description),
      reviewNote: r.review_note,
      sourceLinks: links.rows.filter((l) => l.report_id === r.id).map((l) => l.url),
      accused: accused.rows.filter((a) => a.report_id === r.id).map(({ name, information }) => ({ name, information })),
      evidenceCount: evidence.rows.filter((e) => e.report_id === r.id).length,
    })),
    evidence: evidence.rows,
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.n)])) as Record<string, number>,
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
export class ReviewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
/**
 * The status change, public revision and audit entry commit together or not at all. Repeating a
 * request that already took effect is a no-op, so a retry after a lost response cannot double-log.
 */
export async function reviewReport(actor: Actor, id: string, b: Record<string, unknown>) {
  if (!["pending", "published", "rejected"].includes(String(b.status))) throw new ReviewError(400, "সঠিক অবস্থা দিন।");
  return transaction(async (client) => {
    const { rows } = await client.query<Record<string, string> & { facts: Record<string, string> }>(
      "SELECT id,status,category,facts,title,description,division,district,upazila,ward,ward_area,incident_date,review_note,updated_at FROM jamatnama.reports WHERE id=$1 FOR UPDATE",
      [id],
    );
    const row = rows[0];
    if (!row) throw new ReviewError(404, "পাওয়া যায়নি।");
    const parsed = reportSchema.safeParse({
      ...normalizeCategory(row.category, row.facts),
      title: b.title ?? row.title,
      description: b.description ?? row.description,
      division: row.division,
      district: row.district,
      upazila: row.upazila,
      ward: b.ward ?? row.ward,
      wardArea: b.wardArea ?? row.ward_area,
      incidentDate: row.incident_date,
      declaration: "1",
    });
    if (!parsed.success) throw new ReviewError(400, parsed.error.issues[0].message);
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
    if (b.status === "rejected" && !note) throw new ReviewError(400, "প্রকাশ না করার কারণ লিখুন।");
    if (b.status === "published" && b.reviewed !== true) throw new ReviewError(400, "প্রকাশের আগে তথ্য ও ব্যক্তিগত পরিচয় পরীক্ষা করুন।");
    const d = parsed.data;
    const changed = {
      from: row.status,
      to: String(b.status),
      wardChanged: row.ward !== d.ward || row.ward_area !== d.wardArea,
      titleChanged: row.title !== d.title,
      descriptionChanged: row.description !== d.description,
    };
    if (row.status === b.status && row.review_note === note && !changed.wardChanged && !changed.titleChanged && !changed.descriptionChanged)
      return { unchanged: true, updatedAt: row.updated_at };
    if (typeof b.expectedUpdatedAt === "string" && b.expectedUpdatedAt !== row.updated_at)
      throw new ReviewError(409, "অন্য একজন পর্যালোচক এই রিপোর্ট পরিবর্তন করেছেন। তালিকা আপডেট করে আবার দেখুন।");
    const updatedAt = new Date().toISOString();
    await client.query(
      "UPDATE jamatnama.reports SET status=$1,title=$2,description=$3,review_note=$4,ward=$5,ward_area=$6,updated_at=$7 WHERE id=$8",
      [b.status, d.title, d.description, note, d.ward, d.wardArea, updatedAt, id],
    );
    await audit(actor, "report.review", id, JSON.stringify(changed), client);
    // Note-only edits on unpublished reports change nothing public, so caches stay valid.
    if (row.status === "published" || b.status === "published") await bump(client);
    return { unchanged: false, updatedAt };
  });
}
