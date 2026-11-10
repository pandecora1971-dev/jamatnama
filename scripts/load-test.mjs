// Load test of the production build against real PostgreSQL. Local or authorized staging only: it refuses
// any other target. Results describe THIS machine with NO CDN unless --cdn-sim is passed, and are not a
// statement about Vercel or Supabase capacity. Staging must repeat this before any capacity claim.
//   npm run build && npm run load:test -- --out results.json [--instances 4] [--stages 100,250,500,1000] [--spike 1500] [--seconds 60]
import { writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { startStack } from "../tests/support/stack.mjs";
import { PUBLIC_ORIGIN, appEnvironment, startServers } from "../tests/support/servers.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const INSTANCES = Number(opt("instances", 4));
const STAGES = opt("stages", "100,250,500,1000,2000").split(",").map(Number);
const SPIKE = Number(opt("spike", 1500));
const SECONDS = Number(opt("seconds", 60));
const REPORTS = Number(opt("reports", 50000));
const POOL_MAX = opt("pool", "5");
const CDN_SIM = args.includes("--cdn-sim");

const stack = await startStack({ publicOrigin: PUBLIC_ORIGIN, maxConnections: 300 });
const seed = new pg.Client({ connectionString: stack.env.DATABASE_ADMIN_URL });
await seed.connect();
const categories = ["রাজনৈতিক মামলা", "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল", "রাজনৈতিক সহিংসতা", "সংখ্যালঘু নির্যাতন"];
const seedStart = Date.now();
await seed.query(`INSERT INTO jamatnama.reports(id,receipt_hash,title,description,category,facts,display_category,display_facts,division,district,upazila,incident_date,created_at,updated_at,status,fingerprint)
  SELECT md5('id'||g), encode(sha256(('r'||g)::bytea),'hex'), 'কাল্পনিক পরীক্ষার শিরোনাম '||g, 'সম্পূর্ণ কাল্পনিক লোড-পরীক্ষার বিবরণ নম্বর '||g||' '||repeat('কাল্পনিক ঘটনা ',30),
    c, '{"extortion_amount":"1000"}', c, '{"extortion_amount":"1000"}',
    d, d, 'সাভার', '2026-01-01'::date+(g%300), now()-make_interval(secs=>g*60), now(),
    CASE WHEN g%10<8 THEN 'published' WHEN g%10=8 THEN 'pending' ELSE 'rejected' END, md5('f'||g)
  FROM generate_series(1,${REPORTS}) g,
    LATERAL (SELECT ($1::text[])[1+g%4] AS c, ($2::text[])[1+g%8] AS d) x`, [categories, ["ঢাকা", "চট্টগ্রাম", "রাজশাহী", "খুলনা", "বরিশাল", "সিলেট", "রংপুর", "ময়মনসিংহ"]]);
await seed.query("ANALYZE jamatnama.reports");
const ids = (await seed.query("SELECT id FROM jamatnama.reports WHERE status='published' ORDER BY random() LIMIT 2000")).rows.map((r) => r.id);
const receipts = Array.from({ length: 500 }, (_, i) => randomBytes(24).toString("hex"));
console.log(`Seeded ${REPORTS} synthetic reports in ${Date.now() - seedStart} ms.`);

const { env } = appEnvironment(stack);
const app = await startServers(env, INSTANCES, { DB_POOL_MAX: POOL_MAX });
const bases = app.servers.map((s) => s.base);
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const round = (n) => Math.round(n * 10) / 10;
// Optional simulation of the CDN: honours the headers the app sends so the origin load can be compared.
const cdn = new Map();
let cdnHits = 0, originHits = 0;
function cacheTtl(response) {
  const match = (response.headers.get("vercel-cdn-cache-control") || "").match(/max-age=(\d+)(?:, stale-while-revalidate=(\d+))?/);
  return match ? Number(match[1]) * 1000 : 0;
}
class Metrics {
  constructor() { this.byName = new Map(); this.start = Date.now(); }
  add(name, ms, status) {
    let m = this.byName.get(name);
    if (!m) this.byName.set(name, (m = { times: [], ok: 0, throttled: 0, errors: 0, statuses: {} }));
    m.times.push(ms);
    if (status === 429) m.throttled++;
    else if (status === 0 || status >= 500) m.errors++;
    else m.ok++;
    m.statuses[status] = (m.statuses[status] || 0) + 1;
  }
  summary() {
    const seconds = (Date.now() - this.start) / 1000;
    const all = [], endpoints = {};
    let ok = 0, throttled = 0, errors = 0;
    for (const [name, m] of this.byName) {
      const sorted = m.times.sort((a, b) => a - b);
      all.push(...sorted);
      ok += m.ok; throttled += m.throttled; errors += m.errors;
      endpoints[name] = { requests: sorted.length, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted[sorted.length - 1] || 0), errors: m.errors, throttled: m.throttled, statuses: m.statuses };
    }
    all.sort((a, b) => a - b);
    return {
      seconds: round(seconds), requests: all.length, rps: round(all.length / seconds),
      p50: round(percentile(all, 50)), p95: round(percentile(all, 95)), p99: round(percentile(all, 99)), max: round(all[all.length - 1] || 0),
      errorRatePct: round((errors / Math.max(1, all.length)) * 1000) / 10 * 1, errors, throttled, ok, endpoints,
    };
  }
}
let lastRevision = 0;
async function hit(metrics, name, path, options = {}) {
  const base = bases[Math.floor(Math.random() * bases.length)];
  const started = performance.now();
  const key = options.method ? null : path;
  if (CDN_SIM && key) {
    const cached = cdn.get(key);
    if (cached && cached.expires > Date.now()) {
      cdnHits++;
      metrics.add(name, performance.now() - started, cached.status);
      return { status: cached.status, data: cached.data };
    }
  }
  try {
    originHits++;
    const response = await fetch(base + path, {
      method: options.method || "GET",
      headers: { Origin: PUBLIC_ORIGIN, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    metrics.add(name, performance.now() - started, response.status);
    let data = null;
    if (options.parse) try { data = JSON.parse(text); } catch {}
    if (CDN_SIM && key) {
      const ttl = cacheTtl(response);
      if (ttl) cdn.set(key, { expires: Date.now() + ttl, status: response.status, data });
    }
    return { status: response.status, data, cookies: response.headers.getSetCookie() };
  } catch {
    metrics.add(name, performance.now() - started, 0);
    return { status: 0 };
  }
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const reportBody = () => ({
  category: categories[1], title: `কাল্পনিক লোড পরীক্ষা ${randomUUID()}`, description: "এটি শুধু লোড পরীক্ষার জন্য তৈরি একটি সম্পূর্ণ কাল্পনিক বিবরণ, বাস্তব নয়।",
  division: "ঢাকা", district: "ঢাকা", upazila: "সাভার", ward: "", wardArea: "", incidentDate: "2026-10-20", declaration: "1", facts: {}, accused: [], sourceLinks: [],
});
const parse = { parse: true };
// One visitor: opens the page, polls the revision, and sometimes filters, reads, votes, tracks or submits.
async function visitor(metrics, until) {
  const jar = {};
  const cookieHeader = () => ({ Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") });
  const keep = (result) => { for (const line of result.cookies || []) { const [pair] = line.split(";"); const at = pair.indexOf("="); jar[pair.slice(0, at)] = pair.slice(at + 1); } return result; };
  await hit(metrics, "page", "/");
  const first = await hit(metrics, "revision", "/api/revision", parse);
  let rev = first.data?.revision ?? lastRevision;
  await hit(metrics, "stats", `/api/stats?rev=${rev}`);
  const list = await hit(metrics, "list", `/api/reports?limit=6&rev=${rev}`, parse);
  let cursor = list.data?.nextCursor;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 7000));
    if (Date.now() >= until) return;
    const roll = Math.random();
    if (roll < 0.55) {
      const r = await hit(metrics, "revision", "/api/revision", parse);
      if (r.data?.revision !== undefined) rev = r.data.revision;
    } else if (roll < 0.70 && cursor) {
      const r = await hit(metrics, "list-next-page", `/api/reports?limit=6&cursor=${encodeURIComponent(cursor)}&rev=${rev}`, parse);
      cursor = r.data?.nextCursor || list.data?.nextCursor;
    } else if (roll < 0.80) {
      await hit(metrics, "filter", `/api/reports?limit=6&district=${encodeURIComponent(pick(["ঢাকা", "খুলনা", "সিলেট"]))}&rev=${rev}`);
    } else if (roll < 0.85) {
      await hit(metrics, "search", `/api/reports?limit=6&q=${encodeURIComponent(`শিরোনাম ${Math.floor(Math.random() * 40000)}`)}&rev=${rev}`);
    } else if (roll < 0.91) {
      await hit(metrics, "detail", `/api/reports/${pick(ids)}?rev=${rev}`);
    } else if (roll < 0.95) {
      keep(await hit(metrics, "vote", `/api/reports/${pick(ids)}/support`, { method: "POST", headers: cookieHeader() }));
    } else if (roll < 0.98) {
      keep(await hit(metrics, "track", "/api/track", { method: "POST", body: { receipt: pick(receipts) }, headers: cookieHeader() }));
    } else {
      const challenge = keep(await hit(metrics, "challenge", "/api/challenge", { ...parse, headers: cookieHeader() }));
      if (!challenge.data?.challenge) continue;
      await new Promise((r) => setTimeout(r, 1600));
      const body = reportBody();
      const intent = keep(await hit(metrics, "submit-intent", "/api/uploads/intent", { method: "POST", ...parse, headers: cookieHeader(), body: { challenge: challenge.data.challenge, botToken: "ok:report", report: body, files: [] } }));
      if (intent.status === 201) keep(await hit(metrics, "submit-finalize", "/api/reports", { method: "POST", headers: cookieHeader(), body: { token: intent.data.token, report: body, fileIds: [] } }));
    }
  }
}
async function databaseSample() {
  const { rows } = await seed.query("SELECT count(*) FILTER (WHERE state='active') AS active, count(*) AS total, count(*) FILTER (WHERE wait_event_type='Lock') AS waiting FROM pg_stat_activity WHERE datname='jamatnama'");
  return { active: Number(rows[0].active), connections: Number(rows[0].total), waitingOnLocks: Number(rows[0].waiting) };
}
async function runStage(name, target, seconds, rampSeconds) {
  const metrics = new Metrics();
  const until = Date.now() + (seconds + rampSeconds) * 1000;
  const samples = [];
  const sampler = setInterval(() => { if (seed.activeQuery) return; void databaseSample().then((s) => samples.push(s)).catch(() => {}); }, 2000);
  const visitors = [];
  for (let i = 0; i < target; i++) {
    visitors.push(visitor(metrics, until));
    if (rampSeconds && i % Math.max(1, Math.floor(target / (rampSeconds * 10))) === 0) await new Promise((r) => setTimeout(r, 100));
  }
  await Promise.all(visitors);
  clearInterval(sampler);
  const summary = metrics.summary();
  const peak = samples.reduce((m, s) => ({ active: Math.max(m.active, s.active), connections: Math.max(m.connections, s.connections), waitingOnLocks: Math.max(m.waitingOnLocks, s.waitingOnLocks) }), { active: 0, connections: 0, waitingOnLocks: 0 });
  const line = { stage: name, concurrentVisitors: target, ...summary, peakDatabase: peak };
  console.log(`${name.padEnd(14)} visitors=${String(target).padEnd(5)} rps=${String(summary.rps).padEnd(7)} p50=${String(summary.p50).padEnd(7)} p95=${String(summary.p95).padEnd(8)} p99=${String(summary.p99).padEnd(8)} errors=${summary.errors} (${summary.errorRatePct}%) throttled=${summary.throttled} dbConns=${peak.connections}`);
  return line;
}
const results = { startedAt: new Date().toISOString(), environment: { instances: INSTANCES, poolMaxPerInstance: Number(POOL_MAX), reports: REPORTS, cdnSimulated: CDN_SIM, node: process.version, note: "Load generator, app instances and PostgreSQL share one machine. No network latency, TLS, Supavisor or real CDN." }, stages: [] };
try {
  for (const target of STAGES) {
    results.stages.push(await runStage(`steady-${target}`, target, SECONDS, Math.min(10, Math.ceil(target / 100))));
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (SPIKE) results.spike = await runStage(`spike-${SPIKE}`, SPIKE, Math.max(30, Math.floor(SECONDS / 2)), 5);
  if (CDN_SIM) results.cdnSimulation = { cdnHits, originHits, offloadPct: round((cdnHits / Math.max(1, cdnHits + originHits)) * 100) };
  const log = app.output.join("");
  results.serverErrorLines = (log.match(/"level":"error"/g) || []).length;
  results.serverErrorSummary = {};
  for (const [, scope, code] of log.matchAll(/"scope":"([^"]+)","name":"[^"]*"(?:,"code":"([^"]*)")?/g)) {
    const key = `${scope}:${code || "none"}`;
    results.serverErrorSummary[key] = (results.serverErrorSummary[key] || 0) + 1;
  }
} finally {
  await seed.end();
  await app.stop();
  await stack.stop();
}
const out = opt("out", "");
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
console.log("Server error summary:", JSON.stringify(results.serverErrorSummary));
setTimeout(() => process.exit(0), 1000).unref();
