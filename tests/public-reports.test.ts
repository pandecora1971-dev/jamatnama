import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GET as getReports } from "../app/api/reports/route";
import { GET as getDetail } from "../app/api/reports/[id]/route";
import { GET as getStats } from "../app/api/stats/route";
import { GET as getRevision } from "../app/api/revision/route";
import { clearMemo, memo } from "../lib/public-cache";
import { decodeCursor, encodeCursor, listPublished, parseFilter, publicStats, reviewReport } from "../lib/reports";
import { statsFromReports, type Report } from "../lib/shared";
import { admin, finish, resetData, seedReport } from "./support/db";
import { randomBytes } from "node:crypto";

process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const actor = { id: "owner", username: "superadmin", role: "superadmin" as const };
const url = (path: string) => new Request(`http://localhost${path}`);
const at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();
beforeEach(resetData);
after(finish);
test("keyset pagination returns every published report once, in order, across pages", async () => {
  const created = [];
  // Identical timestamps must not break paging, so ties are included.
  for (let i = 0; i < 20; i++) created.push(await seedReport({ created_at: at(i - (i % 3)) }));
  await seedReport({ status: "pending" });
  await seedReport({ status: "rejected" });
  const seen: string[] = [];
  let cursor = null;
  let first = true;
  for (;;) {
    const page: Awaited<ReturnType<typeof listPublished>> = await listPublished({}, 6, cursor);
    if (first) assert.equal(page.total, 20);
    first = false;
    seen.push(...page.reports.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = decodeCursor(page.nextCursor);
  }
  assert.equal(seen.length, 20);
  assert.equal(new Set(seen).size, 20);
  assert.deepEqual(new Set(seen), new Set(created));
});
test("public responses never contain private fields, unpublished reports or accused details", async () => {
  const id = await seedReport({ receipt_hash: "a".repeat(64), review_note: "গোপন-নোট-পরীক্ষা" });
  await admin.query("INSERT INTO jamatnama.accused(report_id,position,name,information) VALUES($1,0,'গোপন-অভিযুক্ত','গোপন-তথ্য')", [id]);
  await admin.query("INSERT INTO jamatnama.source_links(report_id,position,url) VALUES($1,0,'https://news.example/x')", [id]);
  const hidden = await seedReport({ status: "pending", title: "প্রকাশ-না-হওয়া-শিরোনাম-পরীক্ষা" });
  await admin.query("INSERT INTO jamatnama.source_links(report_id,position,url) VALUES($1,0,'https://pending.example/x')", [hidden]);
  const [list, detail, stats] = await Promise.all([
    getReports(url("/api/reports")),
    getDetail(url(`/api/reports/${id}`), { params: Promise.resolve({ id }) }),
    getStats(url("/api/stats")),
  ]);
  const texts = { list: await list.text(), detail: await detail.text(), stats: await stats.text() };
  for (const [name, text] of Object.entries(texts))
    for (const secret of ["গোপন", "aaaaaaaa", "receipt", "fingerprint", "review", "accused", "pending.example", "প্রকাশ-না-হওয়া", "search_text"])
      assert.equal(text.includes(secret), false, `${name}: ${secret}`);
  // News links are public on a published report's own page, and only there.
  assert.deepEqual(JSON.parse(texts.detail).report.sourceLinks, ["https://news.example/x"]);
  assert.equal(texts.list.includes("news.example"), false);
  assert.equal(texts.stats.includes("news.example"), false);
  const pending = await getDetail(url(`/api/reports/${hidden}`), { params: Promise.resolve({ id: hidden }) });
  assert.equal(pending.status, 404);
  assert.equal((await pending.text()).includes("pending.example"), false);
});
test("filters and search run on the server, treat wildcards literally, and map legacy categories", async () => {
  await seedReport({ category: "খুন", title: "প্রথম কাল্পনিক ঘটনার শিরোনাম", district: "রাজশাহী", division: "রাজশাহী", upazila: "বাঘা", incident_date: "2026-01-05" });
  await seedReport({ category: "রাজনৈতিক মামলা", title: "দ্বিতীয় 100% কাল্পনিক শিরোনাম", ward: "5", ward_area: "সাভার পৌরসভা", incident_date: "2026-06-05" });
  const count = async (query: string) => {
    const filter = parseFilter(new URLSearchParams(query));
    assert.ok(filter.success, query);
    return (await listPublished(filter.data!, 6)).total;
  };
  assert.equal(await count("category=" + encodeURIComponent("খুন, অপহরণ, গুম ও হত্যাচেষ্টা")), 1, "legacy alias");
  assert.equal(await count("district=" + encodeURIComponent("রাজশাহী")), 1);
  assert.equal(await count("q=" + encodeURIComponent("দ্বিতীয়")), 1);
  assert.equal(await count("q=" + encodeURIComponent("100%")), 1);
  assert.equal(await count("q=" + encodeURIComponent("%%")), 0, "wildcards are literal");
  assert.equal(await count("q=" + encodeURIComponent("__")), 0, "wildcards are literal");
  assert.equal(await count("from=2026-03-01"), 1);
  assert.equal(await count("to=2026-03-01"), 1);
  assert.equal(await count("ward=" + encodeURIComponent("০৫")), 1, "Bangla digits normalize");
  assert.equal(await count("wardArea=" + encodeURIComponent("পৌরসভা")), 1);
  assert.equal(parseFilter(new URLSearchParams("from=not-a-date")).success, false);
  const response = await getReports(url("/api/reports?q=" + encodeURIComponent("' OR 1=1 --")));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 0);
  assert.equal((await getReports(url("/api/reports?limit=100000"))).status, 400, "page size is bounded");
  assert.equal((await getReports(url("/api/reports?cursor=garbage"))).status, 400);
});
test("server aggregates match the original client-side calculation", async () => {
  const rows = [
    { category: "চুরি", facts: { theft_amount: "500" }, district: "ঢাকা", division: "ঢাকা" },
    { category: "ডাকাতি ও ছিনতাই", facts: { robbery_amount: "700.50" }, district: "খুলনা", division: "খুলনা", upazila: "ডুমুরিয়া" },
    { category: "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল", facts: { extortion_amount: "1000" }, district: "ঢাকা", division: "ঢাকা" },
  ];
  for (const row of rows) await seedReport(row);
  await seedReport({ status: "pending", category: "চুরি", facts: { theft_amount: "999999" } });
  const stats = await publicStats({});
  const all: Report[] = [];
  let cursor = null;
  for (;;) {
    const page: Awaited<ReturnType<typeof listPublished>> = await listPublished({}, 6, cursor);
    all.push(...page.reports);
    if (!page.nextCursor) break;
    cursor = decodeCursor(page.nextCursor);
  }
  const expected = statsFromReports(all);
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.categories, expected.categories);
  assert.deepEqual(stats.divisions, expected.divisions);
  assert.deepEqual(stats.districts, expected.districts);
  assert.deepEqual(stats.metrics, expected.metrics);
  assert.equal(stats.metrics["চুরি, ডাকাতি ও ছিনতাই"].loss_amount, 1200.5);
  assert.ok(stats.latest);
});
test("cache headers: only the current revision may be stored, never in browsers", async () => {
  await seedReport();
  const rev = (await (await getRevision()).json()).revision;
  const revisionResponse = await getRevision();
  assert.match(revisionResponse.headers.get("vercel-cdn-cache-control")!, /max-age=5, stale-while-revalidate=5/);
  assert.match(revisionResponse.headers.get("cache-control")!, /max-age=0/);
  const current = await getReports(url(`/api/reports?rev=${rev}`));
  assert.equal(current.headers.get("vercel-cdn-cache-control"), "max-age=30");
  assert.equal(current.headers.get("set-cookie"), null, "a cookie would make the response uncacheable");
  const stale = await getReports(url(`/api/reports?rev=${rev + 7}`));
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.equal(stale.headers.get("vercel-cdn-cache-control"), null);
});
test("publication and withdrawal change the revision atomically and remove the report", async () => {
  const id = await seedReport({ status: "pending" });
  const start = (await listPublished({}, 6)).total;
  const { rows } = await admin.query("SELECT value FROM jamatnama.meta WHERE key='revision'");
  const r0 = Number(rows[0].value);
  await reviewReport(actor, id, { status: "published", reviewed: true });
  clearMemo();
  assert.equal((await listPublished({}, 6)).total, start! + 1);
  const r1 = Number((await admin.query("SELECT value FROM jamatnama.meta WHERE key='revision'")).rows[0].value);
  assert.equal(r1, r0 + 1);
  await reviewReport(actor, id, { status: "rejected", note: "কাল্পনিক পরীক্ষার কারণ" });
  clearMemo();
  assert.equal((await listPublished({}, 6)).total, start);
  const detail = await getDetail(url(`/api/reports/${id}`), { params: Promise.resolve({ id }) });
  assert.equal(detail.status, 404);
  const r2 = Number((await admin.query("SELECT value FROM jamatnama.meta WHERE key='revision'")).rows[0].value);
  assert.equal(r2, r1 + 1);
});
test("a failed moderation change rolls back its audit entry and revision", async () => {
  const id = await seedReport({ status: "pending" });
  const audits = async () => Number((await admin.query("SELECT count(*) AS n FROM jamatnama.audit_log")).rows[0].n);
  const before = await audits();
  // A constraint makes the update fail after the transaction has begun.
  await admin.query("ALTER TABLE jamatnama.reports ADD CONSTRAINT test_block CHECK (review_note <> 'force-failure') NOT VALID");
  try {
    await assert.rejects(reviewReport(actor, id, { status: "rejected", note: "force-failure" }));
  } finally {
    await admin.query("ALTER TABLE jamatnama.reports DROP CONSTRAINT test_block");
  }
  assert.equal(await audits(), before);
  const { rows } = await admin.query("SELECT status FROM jamatnama.reports WHERE id=$1", [id]);
  assert.equal(rows[0].status, "pending");
});
test("retrying a moderation change writes one audit entry; stale edits are refused", async () => {
  const id = await seedReport({ status: "pending" });
  const body = { status: "rejected", note: "কাল্পনিক পরীক্ষার কারণ" };
  const first = await reviewReport(actor, id, body);
  const second = await reviewReport(actor, id, body);
  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, true);
  const { rows } = await admin.query("SELECT count(*) AS n FROM jamatnama.audit_log WHERE target=$1", [id]);
  assert.equal(Number(rows[0].n), 1);
  await assert.rejects(
    reviewReport(actor, id, { status: "pending", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    (error: Error & { status?: number }) => error.status === 409,
  );
});
test("concurrent moderators serialize without losing an audit entry", async () => {
  const id = await seedReport({ status: "pending" });
  await Promise.all([
    reviewReport(actor, id, { status: "published", reviewed: true }),
    reviewReport({ id: "m1", username: "m1", role: "moderator" }, id, { status: "rejected", note: "কারণ" }),
  ]);
  const { rows } = await admin.query("SELECT actor_id FROM jamatnama.audit_log WHERE target=$1", [id]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.actor_id).sort(), ["m1", "owner"]);
});
test("memo shares one in-flight load and bounds its size", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return calls;
  };
  const values = await Promise.all(Array.from({ length: 20 }, () => memo("shared", 1000, load)));
  assert.equal(calls, 1);
  assert.deepEqual(new Set(values), new Set([1]));
  for (let i = 0; i < 2000; i++) void memo(`key-${i}`, 1000, async () => i);
});
test("cursors reject tampering", () => {
  const good = encodeCursor("2026-10-01T00:00:00.000Z", "abc");
  assert.deepEqual(decodeCursor(good), { createdAt: "2026-10-01T00:00:00.000Z", id: "abc" });
  assert.equal(decodeCursor(Buffer.from("x|'; DROP TABLE reports; --").toString("base64url")), null);
});
