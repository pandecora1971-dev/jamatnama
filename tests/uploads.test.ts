import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  UploadError,
  completeUpload,
  createIntent,
  evidenceLink,
  finalizeSubmission,
  receiptFor,
  runMaintenance,
  signParts,
} from "../lib/evidence";
import { MULTIPART_THRESHOLD } from "../lib/filetypes";
import { objectStore } from "../lib/r2";
import { hash } from "../lib/security";
import { admin, finish, resetData, samples, validReport } from "./support/db";

process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const code = (expected: string) => (error: unknown) => error instanceof UploadError && error.code === expected;
const store = () => objectStore();
const put = (plan: { url: string; headers: Record<string, string> }, body: Uint8Array, headers = plan.headers) =>
  fetch(plan.url, { method: "PUT", headers, body: new Uint8Array(body) });
const budget = async (period = "total") => Number((await admin.query("SELECT bytes FROM jamatnama.upload_budget WHERE period=$1", [period])).rows[0]?.bytes ?? 0);
type PutPlan = { id: string; url: string; headers: Record<string, string> };
const intentWith = async (mime: string, body: Buffer) => {
  const intent = await createIntent([{ mime, size: body.length }]);
  return { intent, plan: intent.files[0] as unknown as PutPlan };
};
beforeEach(async () => {
  await resetData();
  for (const name of ["UPLOAD_BUDGET_DAILY_GB", "UPLOAD_BUDGET_TOTAL_GB", "UPLOADS_ENABLED"]) delete process.env[name];
});
after(finish);

test("direct upload, finalize, and quarantine: object bound to intent, size and format verified", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  assert.match(plan.url, /X-Amz-Expires=900/);
  assert.equal((await put(plan, body)).status, 200);
  const result = await finalizeSubmission(intent.token, validReport(), [plan.id]);
  assert.match(result.receipt, /^[a-f0-9]{48}$/);
  const { rows } = await admin.query("SELECT state,object_key,size_bytes,origin FROM jamatnama.evidence WHERE report_id=$1", [result.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "pending_scan");
  assert.equal(rows[0].object_key, `quarantine/${plan.id}`);
  assert.equal(Number(rows[0].size_bytes), body.length);
  const report = await admin.query("SELECT receipt_hash,status FROM jamatnama.reports WHERE id=$1", [result.id]);
  assert.equal(report.rows[0].receipt_hash, hash(result.receipt));
  assert.equal(report.rows[0].status, "pending");
});
test("finalize is retry-safe, including when retries race", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  await put(plan, body);
  const report = validReport();
  const results = await Promise.all(Array.from({ length: 5 }, () => finalizeSubmission(intent.token, report, [plan.id])));
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(new Set(results.map((r) => r.receipt)).size, 1);
  assert.equal(results[0].receipt, receiptFor(intent.token));
  const reports = await admin.query("SELECT count(*) AS n FROM jamatnama.reports");
  assert.equal(Number(reports.rows[0].n), 1);
  const audit = await admin.query("SELECT count(*) AS n FROM jamatnama.audit_log WHERE action='report.submitted'");
  assert.equal(Number(audit.rows[0].n), 1, "one audit entry despite retries");
  const again = await finalizeSubmission(intent.token, validReport("সম্পূর্ণ আলাদা কাল্পনিক শিরোনাম"), []);
  assert.equal(again.id, results[0].id, "a consumed intent cannot create a second report");
  assert.equal(Number((await admin.query("SELECT count(*) AS n FROM jamatnama.reports")).rows[0].n), 1);
});
test("an expired upload URL is refused by storage", async () => {
  const body = samples.pdf();
  const signed = await store().presignPut("incoming/test/expired", "application/pdf", body.length, 1);
  await new Promise((r) => setTimeout(r, 2200));
  const response = await put(signed, body);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /ExpiredRequest/);
  assert.equal(await store().head("incoming/test/expired"), null);
});
test("an expired intent cannot sign, complete or finalize", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  await put(plan, body);
  await admin.query("UPDATE jamatnama.submission_intents SET expires_at=now()-interval '1 minute'");
  await assert.rejects(finalizeSubmission(intent.token, validReport(), [plan.id]), code("intent_expired"));
  await assert.rejects(signParts(intent.token, plan.id, [1]), code("intent_expired"));
  await assert.rejects(completeUpload(intent.token, plan.id), code("intent_expired"));
});
test("oversized and disallowed files are refused before any URL exists", async () => {
  await assert.rejects(createIntent([{ mime: "image/jpeg", size: 26 * 1024 * 1024 }]), code("file_too_large"));
  await assert.rejects(createIntent([{ mime: "video/mp4", size: 3 * 1024 * 1024 * 1024 }]), code("file_too_large"));
  await assert.rejects(createIntent([{ mime: "application/x-msdownload", size: 100 }]), code("unsupported_type"));
  await assert.rejects(createIntent([{ mime: "text/html", size: 100 }]), code("unsupported_type"));
  await assert.rejects(createIntent(Array.from({ length: 6 }, () => ({ mime: "application/pdf", size: 100 }))), code("too_many_files"));
  await assert.rejects(createIntent([{ mime: "application/pdf", size: -1 }]), code("bad_size"));
  await assert.rejects(createIntent(Array.from({ length: 2 }, () => ({ mime: "video/mp4", size: 2 * 1024 * 1024 * 1024 }))), code("total_too_large"));
  assert.equal(await budget(), 0);
});
test("a body larger or smaller than the signed length is refused by the signature", async () => {
  const body = samples.pdf();
  const { plan } = await intentWith("application/pdf", body);
  for (const wrong of [Buffer.concat([body, Buffer.alloc(100)]), body.subarray(0, 100)]) {
    const response = await put(plan, wrong);
    assert.equal(response.status, 403);
    assert.match(await response.text(), /SignatureDoesNotMatch/);
  }
});
test("a different content type than signed is refused", async () => {
  const body = samples.pdf();
  const { plan } = await intentWith("application/pdf", body);
  const response = await put(plan, body, { ...plan.headers, "Content-Type": "text/html" });
  assert.equal(response.status, 403);
});
test("oversized content placed under the incoming key is rejected at finalize", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  const { rows } = await admin.query("SELECT incoming_key FROM jamatnama.upload_files WHERE id=$1", [plan.id]);
  await store().put(rows[0].incoming_key, new Uint8Array(samples.pdf(9000)), "application/pdf");
  await assert.rejects(finalizeSubmission(intent.token, validReport(), [plan.id]), code("size_mismatch"));
  assert.equal(await store().head(rows[0].incoming_key), null, "rejected object is removed");
  await assert.rejects(finalizeSubmission(intent.token, validReport(), [plan.id]), code("file_rejected"));
});
test("bytes that do not match the declared format are rejected at finalize", async () => {
  for (const [mime, body] of [
    ["image/jpeg", samples.html()],
    ["application/pdf", samples.mp4(2000)],
    ["video/mp4", samples.pdf()],
    ["audio/mpeg", samples.pdf()],
  ] as const) {
    const { intent, plan } = await intentWith(mime, body);
    assert.equal((await put(plan, body)).status, 200, mime);
    await assert.rejects(finalizeSubmission(intent.token, validReport(), [plan.id]), code("format_mismatch"), mime);
    assert.equal(await store().head(`quarantine/${plan.id}`), null);
  }
  assert.equal(Number((await admin.query("SELECT count(*) AS n FROM jamatnama.reports")).rows[0].n), 0);
});
test("a replayed PUT cannot change a validated file, before or after finalize", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  assert.equal((await put(plan, body)).status, 200);
  const evil = Buffer.concat([Buffer.from("%PDF-1.7\nEVIL"), Buffer.alloc(body.length - 13)]);
  assert.equal((await put(plan, evil)).status, 412, "same URL cannot overwrite before finalize");
  await finalizeSubmission(intent.token, validReport(), [plan.id]);
  assert.equal((await put(plan, evil)).status, 412, "same URL cannot overwrite after finalize");
  const stored = Buffer.from(await store().readRange(`quarantine/${plan.id}`, 0, body.length));
  assert.deepEqual(stored, body);
});
test("files belong to their intent: another intent's file cannot be attached", async () => {
  const first = await intentWith("application/pdf", samples.pdf());
  const second = await intentWith("application/pdf", samples.pdf());
  await put(first.plan, samples.pdf());
  await assert.rejects(finalizeSubmission(second.intent.token, validReport(), [first.plan.id]), code("foreign_file"));
  await assert.rejects(signParts(second.intent.token, first.plan.id, [1]), code("foreign_file"));
  await assert.rejects(finalizeSubmission("f".repeat(48), validReport(), []), code("unknown_intent"));
  await assert.rejects(finalizeSubmission("bad-token", validReport(), []), code("bad_token"));
});
test("finalize refuses a file that was never uploaded, and that intent can still retry", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  await assert.rejects(finalizeSubmission(intent.token, validReport(), [plan.id]), code("upload_incomplete"));
  await put(plan, body);
  assert.ok((await finalizeSubmission(intent.token, validReport(), [plan.id])).id);
});
test("duplicate reports return 409 and do not consume the intent's report slot", async () => {
  const report = validReport();
  const a = await createIntent([]), b = await createIntent([]);
  await finalizeSubmission(a.token, report, []);
  await assert.rejects(finalizeSubmission(b.token, report, []), code("duplicate_report"));
  const { rows } = await admin.query("SELECT count(*) AS n FROM jamatnama.submission_intents WHERE report_id IS NULL");
  assert.equal(Number(rows[0].n), 1);
});
test("multipart upload uses server-verified parts and is idempotent", async () => {
  const size = MULTIPART_THRESHOLD + 123;
  const body = Buffer.concat([samples.mp4(4096), randomBytes(size - 4096)]);
  const intent = await createIntent([{ mime: "video/mp4", size }]);
  const plan = intent.files[0] as { id: string; mode: string; partSize: number; partCount: number };
  assert.equal(plan.mode, "multipart");
  assert.equal(plan.partCount, 3);
  await assert.rejects(completeUpload(intent.token, plan.id), code("upload_incomplete"));
  const signed = await signParts(intent.token, plan.id, [1, 2, 3]);
  await assert.rejects(signParts(intent.token, plan.id, [4]), code("bad_parts"));
  await assert.rejects(signParts(intent.token, plan.id, Array.from({ length: 17 }, (_, i) => i + 1)), code("bad_parts"));
  // A part whose length differs from what was signed is refused by storage.
  const wrong = await fetch(signed[0].url, { method: "PUT", body: body.subarray(0, 100) });
  assert.equal(wrong.status, 403);
  for (const part of signed) {
    const chunk = body.subarray((part.partNumber - 1) * plan.partSize, part.partNumber * plan.partSize);
    assert.equal((await fetch(part.url, { method: "PUT", body: chunk })).status, 200);
  }
  assert.deepEqual(await completeUpload(intent.token, plan.id), { ok: true });
  assert.deepEqual(await completeUpload(intent.token, plan.id), { ok: true }, "retry is safe");
  const replay = await fetch(signed[0].url, { method: "PUT", body: body.subarray(0, plan.partSize) });
  assert.equal(replay.status, 404, "parts cannot be replayed after completion");
  const result = await finalizeSubmission(intent.token, validReport(), [plan.id]);
  const head = await store().head(`quarantine/${plan.id}`);
  assert.equal(head?.size, size);
  assert.ok(result.id);
});
test("abandoned uploads are cleaned, multipart aborted and budget released; attached ones are not", async () => {
  const keep = samples.pdf();
  const kept = await intentWith("application/pdf", keep);
  await put(kept.plan, keep);
  await finalizeSubmission(kept.intent.token, validReport(), [kept.plan.id]);
  const dropped = await intentWith("application/pdf", samples.pdf());
  await put(dropped.plan, samples.pdf());
  const size = MULTIPART_THRESHOLD + 10;
  const big = await createIntent([{ mime: "video/mp4", size }]);
  const bigId = big.files[0].id;
  const multipart = (await admin.query("SELECT incoming_key,multipart_upload_id FROM jamatnama.upload_files WHERE id=$1", [bigId])).rows[0];
  assert.equal(await budget(), keep.length + samples.pdf().length + size);
  const incomingKey = (await admin.query("SELECT incoming_key FROM jamatnama.upload_files WHERE id=$1", [dropped.plan.id])).rows[0].incoming_key;
  // Still within its life: nothing is removed.
  let swept = await runMaintenance();
  assert.equal(swept.expiredIntents, 0);
  assert.ok(await store().head(incomingKey));
  await admin.query("UPDATE jamatnama.submission_intents SET expires_at=now()-interval '1 hour' WHERE report_id IS NULL");
  swept = await runMaintenance();
  assert.equal(swept.expiredIntents, 2);
  assert.equal(await store().head(incomingKey), null);
  assert.equal(await store().listParts(multipart.incoming_key, multipart.multipart_upload_id), null, "multipart aborted");
  assert.equal(await budget(), keep.length, "only attached bytes stay charged");
  assert.ok(await store().head(`quarantine/${kept.plan.id}`), "attached evidence is untouched");
  // Attached incoming copies go only after every signed URL has expired.
  const keptIncoming = (await admin.query("SELECT incoming_key FROM jamatnama.upload_files WHERE id=$1", [kept.plan.id])).rows[0].incoming_key;
  assert.ok(await store().head(keptIncoming));
  await admin.query("UPDATE jamatnama.upload_files SET created_at=now()-interval '1 hour'");
  await runMaintenance();
  assert.equal(await store().head(keptIncoming), null);
  assert.ok(await store().head(`quarantine/${kept.plan.id}`));
  const repeat = await runMaintenance();
  assert.equal(repeat.expiredIntents, 0, "maintenance is safe to repeat");
});
test("upload budgets are enforced atomically under concurrent intents", async () => {
  process.env.UPLOAD_BUDGET_DAILY_GB = String((10 * 1024 * 1024) / (1024 * 1024 * 1024));
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => createIntent([{ mime: "application/pdf", size: 4 * 1024 * 1024 }])));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  for (const result of results) if (result.status === "rejected") assert.ok(code("budget_exhausted")(result.reason));
  assert.equal(await budget(), 8 * 1024 * 1024, "failed reservations roll back");
});
test("the kill switch stops uploads while reports without files still work", async () => {
  process.env.UPLOADS_ENABLED = "false";
  await assert.rejects(createIntent([{ mime: "application/pdf", size: 100 }]), code("uploads_disabled"));
  const intent = await createIntent([]);
  assert.ok((await finalizeSubmission(intent.token, validReport(), [])).id);
});
test("evidence links: quarantined files are refused, clean ones are expiring attachments, access is audited", async () => {
  const body = samples.pdf();
  const { intent, plan } = await intentWith("application/pdf", body);
  await put(plan, body);
  await finalizeSubmission(intent.token, validReport(), [plan.id]);
  const actor = { id: "m1", username: "moderator-one", role: "moderator" as const };
  await assert.rejects(evidenceLink(actor, plan.id), code("pending_scan"));
  await assert.rejects(evidenceLink(actor, "missing"), code("not_found"));
  assert.equal(Number((await admin.query("SELECT count(*) AS n FROM jamatnama.audit_log WHERE action='evidence.access'")).rows[0].n), 0);
  await store().copy(`quarantine/${plan.id}`, `evidence/${plan.id}`);
  await admin.query("UPDATE jamatnama.evidence SET state='clean',object_key=$1 WHERE id=$2", [`evidence/${plan.id}`, plan.id]);
  const url = await evidenceLink(actor, plan.id);
  assert.match(url, /X-Amz-Expires=120/);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /^attachment; filename="evidence\.pdf"/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const unsigned = await fetch(url.split("?")[0]);
  assert.equal(unsigned.status, 403, "the permanent object URL is not public");
  const { rows } = await admin.query("SELECT actor_id,actor_name,target FROM jamatnama.audit_log WHERE action='evidence.access'");
  assert.deepEqual(rows, [{ actor_id: "m1", actor_name: "moderator-one", target: plan.id }]);
});
test("image bytes keep EXIF only in quarantine: nothing is served until the scanner rewrites them", async () => {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff7873" } }).withExif({ IFD0: { Copyright: "private-location" } }).jpeg().toBuffer();
  const { intent, plan } = await intentWith("image/jpeg", image);
  await put(plan, image);
  await finalizeSubmission(intent.token, validReport(), [plan.id]);
  const { rows } = await admin.query("SELECT state FROM jamatnama.evidence WHERE id=$1", [plan.id]);
  assert.equal(rows[0].state, "pending_scan");
});
