// End-to-end verification of the production build with synthetic data: two instances, real PostgreSQL,
// the R2 and clamd doubles, and real HTTP. It starts everything itself and touches nothing external.
// Usage: R2_ENDPOINT=http://127.0.0.1:54340 npm run build && npm run verify:e2e
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { startStack } from "../tests/support/stack.mjs";
import { PUBLIC_ORIGIN, appEnvironment, startServers } from "../tests/support/servers.mjs";
import { readFileSync } from "node:fs";

// The CSP is fixed at build time, so this port must match R2_ENDPOINT during `npm run build`.
const stack = await startStack({ publicOrigin: PUBLIC_ORIGIN, r2Port: 54340 });
const { env, ownerPassword } = appEnvironment(stack);
const app = await startServers(env, 2);
const [A, B] = app.servers.map((s) => s.base);
const passed = [];
const step = (name) => {
  passed.push(name);
  console.log(`ok - ${name}`);
};
class Client {
  cookies = new Map();
  constructor(base = A) {
    this.base = base;
  }
  async request(path, { method = "GET", body, headers = {}, origin = PUBLIC_ORIGIN, on, redirect = "manual" } = {}) {
    const response = await fetch((on || this.base) + path, {
      method,
      redirect,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(line)) this.cookies.delete(pair.slice(0, at));
      else this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }
  async json(path, options) {
    const response = await this.request(path, options);
    return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
  }
}
// Reads the newest one-time code the test mail sink captured for the Super Admin.
function latestOtp() {
  const lines = readFileSync(env.TEST_OTP_OUTBOX, "utf8").trim().split("\n");
  return JSON.parse(lines.at(-1)).subject.match(/(\d{6})/)[1];
}
const MOD_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const modPassword = `synthetic-${randomBytes(12).toString("hex")}`;
const ACCUSED = "সম্পূর্ণ-কাল্পনিক-অভিযুক্ত-" + randomUUID();
const report = (title = `সম্পূর্ণ কাল্পনিক শিরোনাম ${randomUUID()}`) => ({
  category: "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ",
  title,
  description: "এটি শুধু সফটওয়্যার যাচাইয়ের জন্য তৈরি কাল্পনিক বিবরণ। পরীক্ষার ইমেইল review-test@example.com।",
  division: "ঢাকা", district: "ঢাকা", upazila: "সাভার", ward: "০৫", wardArea: "সাভার পৌরসভা",
  incidentDate: "2026-10-20", declaration: "1",
  facts: { victim_count: "3" },
  accused: [{ name: ACCUSED, information: "শুধু পরীক্ষার ব্যক্তিগত তথ্য।" }],
  sourceLinks: ["https://example.com/news/test-evidence"],
});
const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(4000)]);
const video = (() => {
  const b = Buffer.concat([Buffer.alloc(32), randomBytes(33 * 1024 * 1024)]);
  b.writeUInt32BE(24, 0);
  b.write("ftypisom", 4);
  b.write("isom", 16);
  return b;
})();
const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#ff7873" } }).withExif({ IFD0: { Copyright: "PRIVATE-EXIF-MARKER" } }).jpeg().toBuffer();
async function challenge(client) {
  const { data } = await client.json("/api/challenge");
  await new Promise((r) => setTimeout(r, 1600));
  return data.challenge;
}
async function createIntent(client, files, r = report(), overrides = {}) {
  return client.json("/api/uploads/intent", { method: "POST", body: { challenge: await challenge(client), botToken: "ok:report", report: r, files, ...overrides } });
}
const scanWorker = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "worker/scan-worker.mts", "--once"], {
      env: { ...process.env, ...env, NODE_ENV: "production", DATABASE_URL: env.SCANNER_DATABASE_URL }, stdio: "pipe",
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("exit", (status) => (status === 0 ? resolve(log) : reject(Error(`worker exited ${status}: ${log}`))));
  });
const privateFields = ["receipt", "receipt_hash", "accused", "evidence", "evidenceCount", "sourceLinks", "reviewNote", "review_note", "reviewFlags", "fingerprint", "search_text", "ip", "email", "reporterName"];
let exitCode = 0;
try {
  // --- Anonymous access boundaries ---
  const visitor = new Client();
  const home = await visitor.request("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.equal(homeHtml.includes("report-test"), false);
  assert.match(home.headers.get("content-security-policy"), new RegExp(stack.r2.endpoint.replace(/[.:/]/g, "\\$&")));
  assert.equal((await visitor.json("/api/admin/reports")).status, 401);
  assert.equal((await visitor.json("/api/admin/team")).status, 403);
  assert.equal((await visitor.json("/api/admin/evidence/anything")).status, 401);
  assert.equal((await visitor.json("/api/cron/maintenance")).status, 401);
  assert.equal((await visitor.json("/api/events")).status, 404, "process-local events are gone");
  step("public clients cannot reach admin, audit, evidence or maintenance endpoints");

  // --- Super Admin and moderator accounts ---
  const owner = new Client(A);
  assert.equal((await owner.json("/api/admin/session", { method: "POST", body: { password: ownerPassword, username: "superadmin" } })).status, 400, "bot check required");
  let login = await owner.json("/api/admin/session", { method: "POST", origin: "https://evil.example", body: {} });
  assert.equal(login.status, 403, "origin check");
  login = await new Client().json("/api/admin/session", { method: "POST", body: { password: ownerPassword, botToken: "ok:report" } });
  assert.equal(login.status, 400, "bot token for another action is refused");
  assert.equal((await new Client().json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: "wrong-password", action: "verify_otp", code: "000000" } })).status, 400, "the code step skips the bot check only while a code is pending");
  login = await owner.json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: "wrong-password", botToken: "ok:admin-login" } });
  assert.equal(login.status, 401, "wrong password sends no code");
  login = await owner.json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: ownerPassword, botToken: "ok:admin-login" } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.otpRequired, true, "owner still needs the emailed code");
  assert.equal((await owner.json("/api/admin/reports")).status, 401, "no session before the code");
  const ownerOtp = latestOtp();
  login = await owner.json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: ownerPassword, action: "verify_otp", code: ownerOtp === "000000" ? "111111" : "000000" } });
  assert.equal(login.status, 401, "a wrong code is refused");
  login = await owner.json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: ownerPassword, action: "verify_otp", code: ownerOtp }, on: B });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.actor.role, "superadmin");
  assert.equal((await new Client().json("/api/admin/session", { method: "POST", body: { username: "superadmin", password: ownerPassword, action: "verify_otp", code: ownerOtp } })).status, 400, "a used code cannot be replayed");
  const created = await owner.json("/api/admin/team", { method: "POST", body: { action: "create", username: "synthetic-mod", password: modPassword } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal((await owner.json("/api/admin/team", { method: "POST", body: { action: "create", username: "synthetic-mod", password: modPassword } })).status, 409, "a retried create is refused, not duplicated");
  const team = await owner.json("/api/admin/team");
  const modAccount = team.data.staff.find((s) => s.username === "synthetic-mod");
  assert.ok(modAccount.active);
  assert.equal(JSON.stringify(team.data).includes(MOD_SECRET), false);
  const sealed = await owner.json("/api/admin/team");
  assert.equal("totp_secret" in sealed.data.staff[0], false);
  const moderator = new Client(B);
  assert.equal((await new Client().json("/api/admin/session", { method: "POST", body: { username: "synthetic-mod", password: "wrong-password-123", botToken: "ok:admin-login" } })).status, 401, "wrong moderator password");
  login = await moderator.json("/api/admin/session", { method: "POST", body: { username: "synthetic-mod", password: modPassword, botToken: "ok:admin-login" } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.actor.role, "moderator");
  step("Super Admin needs password plus a single-use emailed code; moderators sign in with username and password");

  assert.equal((await moderator.json("/api/admin/team")).status, 403);
  assert.equal((await moderator.json("/api/admin/team", { method: "POST", body: { action: "disable", id: modAccount.id } })).status, 403);
  assert.equal((await moderator.json("/api/admin/team", { method: "POST", body: { action: "create", username: "another", password: modPassword, secret: MOD_SECRET, code: "000000" } })).status, 403);
  assert.equal((await moderator.json("/api/admin/team?page=1", { on: A })).status, 403);
  step("moderators cannot manage accounts or read the audit log, on any instance");

  // --- Anonymous submission with direct upload ---
  const r = report();
  const refused = new Client();
  assert.equal((await createIntent(refused, [], r, { botToken: "bad:report" })).status, 400, "bot check");
  assert.equal((await createIntent(refused, [], r, { website: "spam" })).status, 400, "honeypot");
  assert.equal((await createIntent(refused, [], { ...r, district: "" })).status, 400, "invalid report rejected before upload");
  let c = await challenge(visitor);
  assert.equal((await visitor.json("/api/uploads/intent", { method: "POST", origin: "https://evil.example", body: { challenge: c, botToken: "ok:report", report: r, files: [] } })).status, 403);
  assert.equal((await createIntent(refused, [{ mime: "video/mp4", size: 3 * 1024 ** 3 }], r)).status, 413, "oversized");
  assert.equal((await createIntent(refused, [{ mime: "application/x-msdownload", size: 100 }], r)).status, 415, "file type");
  step("intent requires origin, bot check, valid report and policy-compliant files");
  const files = [{ mime: "application/pdf", size: pdf.length }, { mime: "image/jpeg", size: image.length }, { mime: "video/mp4", size: video.length }];
  c = await challenge(visitor);
  const intentResponse = await visitor.json("/api/uploads/intent", { method: "POST", body: { challenge: c, botToken: "ok:report", report: r, files } });
  assert.equal(intentResponse.status, 201, JSON.stringify(intentResponse.data));
  assert.equal((await visitor.json("/api/uploads/intent", { method: "POST", body: { challenge: c, botToken: "ok:report", report: r, files } })).status, 400, "challenge is single use");
  const intent = intentResponse.data;
  const [pdfPlan, imagePlan, videoPlan] = intent.files;
  assert.ok(pdfPlan.url.startsWith(stack.r2.endpoint), "uploads go straight to storage");
  assert.equal(videoPlan.mode, "multipart");
  // What a browser does first: the preflight, from the app origin and from an attacker's.
  const preflight = (origin) => fetch(pdfPlan.url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,if-none-match" } });
  assert.equal((await preflight(PUBLIC_ORIGIN)).status, 204);
  assert.equal((await preflight("https://evil.example")).status, 403);
  const storageRequestsBefore = stack.r2.stats.presignedPuts;
  assert.equal((await fetch(pdfPlan.url, { method: "PUT", headers: pdfPlan.headers, body: pdf })).status, 200);
  assert.equal((await fetch(imagePlan.url, { method: "PUT", headers: imagePlan.headers, body: image })).status, 200);
  const signed = await visitor.json("/api/uploads/sign", { method: "POST", body: { token: intent.token, fileId: videoPlan.id, partNumbers: Array.from({ length: videoPlan.partCount }, (_, i) => i + 1) } });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  for (const part of signed.data.parts) {
    const chunk = video.subarray((part.partNumber - 1) * videoPlan.partSize, part.partNumber * videoPlan.partSize);
    assert.equal((await fetch(part.url, { method: "PUT", body: chunk })).status, 200);
  }
  assert.equal(stack.r2.stats.presignedPuts - storageRequestsBefore, 2 + videoPlan.partCount);
  const completed = await visitor.json("/api/uploads/complete", { method: "POST", body: { token: intent.token, fileId: videoPlan.id } });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  step("browser-style direct upload including multipart bypasses the application servers");
  const fileIds = intent.files.map((f) => f.id);
  const finalize = (on) => visitor.json("/api/reports", { method: "POST", on, body: { token: intent.token, report: r, fileIds } });
  const first = await finalize(A);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const retry = await finalize(B);
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.data, first.data, "retry on another instance returns the same report and receipt");
  const { id, receipt } = first.data;
  assert.match(receipt, /^[a-f0-9]{48}$/);
  step("finalize is retry-safe across instances and needs no login");
  assert.equal((await visitor.json("/api/uploads/sign", { method: "POST", body: { token: intent.token, fileId: videoPlan.id, partNumbers: [1] } })).status, 409, "consumed intent");
  assert.equal((await fetch(pdfPlan.url, { method: "PUT", headers: pdfPlan.headers, body: pdf })).status, 412, "replayed upload");
  // A different mismatch at the API layer: bytes that are not what was declared.
  const fake = Buffer.from("<html>not a pdf</html>".padEnd(3000));
  const mismatch = (await createIntent(new Client(), [{ mime: "application/pdf", size: fake.length }])).data;
  await fetch(mismatch.files[0].url, { method: "PUT", headers: mismatch.files[0].headers, body: fake });
  const rejected = await new Client().json("/api/reports", { method: "POST", body: { token: mismatch.token, report: report(), fileIds: [mismatch.files[0].id] } });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.code, "format_mismatch");
  assert.equal(rejected.data.fileId, mismatch.files[0].id);
  const wrongSize = (await createIntent(new Client(), [{ mime: "application/pdf", size: pdf.length }])).data;
  assert.equal((await fetch(wrongSize.files[0].url, { method: "PUT", headers: wrongSize.files[0].headers, body: Buffer.concat([pdf, pdf]) })).status, 403, "oversized body");
  step("replayed, mismatched and oversized uploads fail");

  const tracked = await visitor.json("/api/track", { method: "POST", body: { receipt } });
  assert.equal(tracked.status, 200);
  assert.equal(tracked.data.status, "pending");
  assert.equal((await visitor.json("/api/track", { method: "POST", body: { receipt: "f".repeat(48) } })).status, 404);
  assert.equal((await visitor.json("/api/track", { method: "POST", body: { receipt: "short" } })).status, 400);
  let list = await visitor.json("/api/reports");
  assert.equal(list.data.reports.some((x) => x.id === id), false, "pending reports stay private");
  assert.equal((await visitor.json(`/api/reports/${id}`)).status, 404);
  step("tracking works and a pending report is not public");

  // --- Quarantine, scanning and reviewer access ---
  const pending = await moderator.json("/api/admin/reports?status=pending");
  assert.equal(pending.status, 200);
  const privateReport = pending.data.reports.find((x) => x.id === id);
  assert.ok(privateReport.reviewFlags.length > 0);
  assert.equal(privateReport.accused[0].name, ACCUSED);
  assert.deepEqual(privateReport.sourceLinks, r.sourceLinks);
  const evidence = pending.data.evidence.filter((e) => e.report_id === id);
  assert.equal(evidence.length, 3);
  assert.ok(evidence.every((e) => e.state === "pending_scan"));
  assert.equal(pending.data.counts.pending, 1);
  const quarantined = await moderator.request(`/api/admin/evidence/${evidence[0].id}`);
  assert.equal(quarantined.status, 409, "quarantined evidence cannot be opened");
  await scanWorker();
  const scanned = await moderator.json("/api/admin/reports?status=pending");
  const after = scanned.data.evidence.filter((e) => e.report_id === id);
  assert.ok(after.every((e) => e.state === "clean"), JSON.stringify(after));
  const cleanedImage = after.find((e) => e.mime === "image/webp");
  assert.ok(cleanedImage, "image was rewritten");
  step("uploads stay quarantined until the scan worker clears them");
  const link = await moderator.request(`/api/admin/evidence/${cleanedImage.id}`);
  assert.equal(link.status, 303);
  assert.equal(link.headers.get("cache-control"), "private, no-store");
  const signedUrl = link.headers.get("location");
  assert.match(signedUrl, /X-Amz-Expires=120/);
  const download = await fetch(signedUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(Buffer.from(await download.arrayBuffer()).includes("PRIVATE-EXIF-MARKER"), false);
  assert.equal((await fetch(signedUrl.split("?")[0])).status, 403, "raw object URL is private");
  assert.equal((await new Client().request(`/api/admin/evidence/${cleanedImage.id}`)).status, 401);
  step("reviewers get expiring attachment links; raw objects stay private; EXIF is removed");

  // --- Publication and withdrawal, across instances ---
  const reviewBody = { status: "published", reviewed: true, description: "এটি সফটওয়্যার যাচাইয়ের সম্পূর্ণ কাল্পনিক বিবরণ। প্রকাশের আগে যোগাযোগের ঠিকানাটি সরানো হয়েছে।" };
  const revision = async (on) => (await visitor.json("/api/revision", { on })).data.revision;
  const revBefore = await revision(B);
  assert.equal((await moderator.json(`/api/admin/reports/${id}`, { method: "PATCH", body: { status: "published" } })).status, 400, "explicit review required");
  assert.equal((await moderator.json(`/api/admin/reports/${id}`, { method: "PATCH", body: reviewBody })).status, 200);
  const replay = await moderator.json(`/api/admin/reports/${id}`, { method: "PATCH", body: reviewBody });
  assert.equal(replay.data.unchanged, true, "retried publish is a no-op");
  const waitFor = async (check, label) => {
    const start = Date.now();
    for (;;) {
      if (await check()) return Date.now() - start;
      if (Date.now() - start > 5000) throw Error(`Timed out: ${label}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const seenAfter = await waitFor(async () => (await revision(A)) > revBefore && (await revision(B)) > revBefore, "revision on both instances");
  const rev = await revision(B);
  for (const on of [A, B]) {
    await waitFor(async () => (await visitor.json(`/api/reports?rev=${rev}`, { on })).data.reports.some((x) => x.id === id), "published in list");
    const response = await visitor.json(`/api/reports?rev=${rev}`, { on });
    assert.match(response.headers.get("vercel-cdn-cache-control"), /max-age=30/);
    assert.equal(response.headers.get("set-cookie"), null);
    const pub = response.data.reports.find((x) => x.id === id);
    assert.equal(pub.ward, "5");
    for (const key of privateFields) assert.equal(key in pub, false, key);
    assert.equal(JSON.stringify(response.data).includes(ACCUSED), false);
  }
  const stats = await visitor.json(`/api/stats?rev=${rev}`);
  assert.equal(stats.data.stats.total, 1);
  assert.equal(stats.data.stats.metrics[r.category.normalize("NFC")].victim_count, 3);
  const filtered = await visitor.json("/api/reports?q=" + encodeURIComponent("সফটওয়্যার"));
  assert.equal(filtered.data.total, 1);
  const detail = await visitor.json(`/api/reports/${id}?rev=${rev}`);
  assert.equal(detail.status, 200);
  step(`publication reached both instances in ${seenAfter} ms with public data only`);

  const voter = new Client(A);
  const vote = await voter.json(`/api/reports/${id}/support`, { method: "POST" });
  assert.equal(vote.data.supports, 1);
  assert.equal((await voter.json(`/api/reports/${id}/support`, { method: "POST", on: B })).data.supports, 1, "same browser, other instance");
  assert.equal((await new Client(B).json(`/api/reports/${id}/support`, { method: "POST" })).data.supports, 2);
  assert.equal(await revision(B), rev, "votes do not flush the public cache");
  step("votes are deduplicated across instances and do not invalidate caches");

  const withdrawn = await moderator.json(`/api/admin/reports/${id}`, { method: "PATCH", body: { status: "rejected", note: "কাল্পনিক পরীক্ষার কারণ; প্রকাশযোগ্য নয়।" } });
  assert.equal(withdrawn.status, 200);
  const goneAfter = await waitFor(async () => {
    const [a, b, d] = await Promise.all([visitor.json("/api/reports", { on: A }), visitor.json("/api/reports", { on: B }), visitor.json(`/api/reports/${id}`, { on: B })]);
    return !a.data.reports.some((x) => x.id === id) && !b.data.reports.some((x) => x.id === id) && d.status === 404;
  }, "withdrawal");
  assert.ok(goneAfter <= 3500, `origin must drop a withdrawn report within its 2s memo window, took ${goneAfter}`);
  const oldUrl = await visitor.json(`/api/reports?rev=${rev}`, { on: A });
  assert.equal(oldUrl.headers.get("cache-control"), "no-store", "an old revision URL can no longer be stored");
  assert.equal((await new Client().json(`/api/reports/${id}/support`, { method: "POST" })).status, 404, "withdrawn reports refuse votes");
  const tracking = await visitor.json("/api/track", { method: "POST", body: { receipt } });
  assert.equal(tracking.data.status, "rejected");
  assert.match(tracking.data.note, /কাল্পনিক/);
  step(`withdrawal left the origin on both instances in ${goneAfter} ms`);

  // --- Audit attribution ---
  const audit = await owner.json("/api/admin/team");
  const logs = audit.data.logs;
  const entry = (action, actor) => logs.find((l) => l.action === action && l.actor_name === actor);
  assert.ok(entry("report.submitted", "anonymous"));
  assert.ok(entry("login", "synthetic-mod"));
  assert.ok(entry("login", "superadmin"));
  assert.ok(entry("moderator.created", "superadmin"));
  assert.ok(entry("evidence.access", "synthetic-mod"));
  assert.ok(entry("evidence.scan.clean", "malware-scanner"));
  const reviews = logs.filter((l) => l.action === "report.review" && l.target === id);
  assert.equal(reviews.length, 2, "publish retry added no entry");
  assert.ok(reviews.every((l) => l.actor_name === "synthetic-mod"));
  assert.equal(JSON.stringify(logs).includes(modPassword), false);
  assert.equal(JSON.stringify(logs).includes(receipt), false);
  step("audit log attributes every action to the right account, without private content");

  // --- Disabling an account ---
  assert.equal((await moderator.json("/api/admin/reports")).status, 200);
  assert.equal((await owner.json("/api/admin/team", { method: "POST", body: { action: "disable", id: modAccount.id } })).status, 200);
  assert.equal((await moderator.json("/api/admin/reports", { on: B })).status, 401, "revoked on the other instance immediately");
  assert.equal((await moderator.json("/api/admin/reports", { on: A })).status, 401);
  assert.equal((await moderator.request(`/api/admin/evidence/${cleanedImage.id}`)).status, 401);
  const blocked = await new Client().json("/api/admin/session", { method: "POST", body: { username: "synthetic-mod", password: modPassword, botToken: "ok:admin-login" } });
  assert.equal(blocked.status, 401);
  assert.equal((await owner.json("/api/admin/team", { method: "POST", body: { action: "enable", id: modAccount.id } })).status, 200);
  assert.equal((await moderator.json("/api/admin/reports", { on: B })).status, 401, "reactivation does not restore old sessions");
  const back = new Client(B);
  const relogin = await back.json("/api/admin/session", { method: "POST", body: { username: "synthetic-mod", password: modPassword, botToken: "ok:admin-login" } });
  assert.equal(relogin.status, 200, JSON.stringify(relogin.data));
  assert.equal((await back.json("/api/admin/session", { method: "DELETE" })).status, 200);
  assert.equal((await back.json("/api/admin/reports")).status, 401, "logout revokes on the server");
  step("disabling revokes sessions at once on every instance; reactivation needs a new login");

  // --- Shared rate limits ---
  const limited = new Client();
  await limited.json("/api/track", { method: "POST", body: { receipt: "short" } });
  let statuses = [];
  for (let i = 0; i < 16; i++) statuses.push((await limited.json("/api/track", { method: "POST", body: { receipt: "short" }, on: i % 2 ? A : B })).status);
  assert.ok(statuses.includes(429), `tracking limit: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 400).length, 14, "15 per minute across both instances");
  const brute = new Client();
  statuses = [];
  let retryAfter = null;
  for (let i = 0; i < 6; i++) {
    const attempt = await brute.json("/api/admin/session", { method: "POST", on: i % 2 ? A : B, body: { username: "synthetic-mod", password: "deliberately-wrong", botToken: "ok:admin-login", code: "000000" } });
    statuses.push(attempt.status);
    retryAfter = attempt.headers.get("retry-after");
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.equal(retryAfter, "900");
  const votes = new Client();
  statuses = [];
  for (let i = 0; i < 32; i++) statuses.push((await votes.json(`/api/reports/${"x".repeat(48)}/support`, { method: "POST", on: i % 2 ? A : B })).status);
  assert.ok(statuses.includes(429), "vote limit");
  step("login, tracking and vote limits are enforced across instances with Retry-After");

  // --- Maintenance ---
  const cron = await visitor.json("/api/cron/maintenance", { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  assert.equal(cron.status, 200, JSON.stringify(cron.data));
  assert.equal((await visitor.json("/api/cron/maintenance", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  step("scheduled maintenance requires its secret and runs");

  // --- Logs ---
  const logText = app.output.join("");
  for (const secret of [receipt, intent.token, modPassword, ownerPassword, ACCUSED, MOD_SECRET, env.CRON_SECRET, "X-Amz-Signature", "PRIVATE-EXIF-MARKER", "review-test@example.com"])
    assert.equal(logText.includes(secret), false, `logs leaked ${secret.slice(0, 12)}…`);
  step("server logs hold no receipts, tokens, credentials, signed URLs or report data");
  console.log(`\nPASS: ${passed.length} end-to-end checks on the production build (2 instances, real PostgreSQL, R2 and clamd doubles).`);
} catch (error) {
  exitCode = 1;
  console.error(`\nFAIL after ${passed.length} checks:`, error);
  console.error(app.output.join("").slice(-1500));
} finally {
  await app.stop();
  await stack.stop();
}
process.exitCode = exitCode;
setTimeout(() => process.exit(exitCode), 2000).unref();
