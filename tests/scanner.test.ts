import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createIntent, finalizeSubmission } from "../lib/evidence";
import { objectStore } from "../lib/r2";
import { clamdEngine, claimJob, scanBatch, type ScanEngine } from "../lib/scanner";
import { admin, asScanner, finish, resetData, samples, validReport } from "./support/db";

process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
type Plan = { id: string; url: string; headers: Record<string, string> };
async function submit(mime: string, body: Buffer) {
  const intent = await createIntent([{ mime, size: body.length }]);
  const plan = intent.files[0] as unknown as Plan;
  assert.equal((await fetch(plan.url, { method: "PUT", headers: plan.headers, body: new Uint8Array(body) })).status, 200);
  await finalizeSubmission(intent.token, validReport(), [plan.id]);
  return plan.id;
}
const row = async (id: string) => (await admin.query("SELECT * FROM jamatnama.evidence WHERE id=$1", [id])).rows[0];
const scan = (...args: Parameters<typeof scanBatch>) => asScanner(() => scanBatch(...args));
const engine = () => clamdEngine(process.env.CLAMD_HOST, Number(process.env.CLAMD_PORT));
beforeEach(resetData);
after(finish);
test("the clamd protocol client gets a verdict for clean and infected streams", async () => {
  assert.equal(await engine().ping(), true);
  const stream = (text: string) => new Blob([text]).stream();
  assert.deepEqual(await engine().scan(stream("harmless"), () => {}), { clean: true });
  assert.deepEqual(await engine().scan(stream(EICAR), () => {}), { clean: false, signature: "Eicar-Test-Signature" });
});
test("a clean file moves to evidence/ with its checksum, and quarantine is removed", async () => {
  const body = samples.pdf();
  const id = await submit("application/pdf", body);
  assert.equal(await scan(engine()), 1);
  const after = await row(id);
  assert.equal(after.state, "clean");
  assert.equal(after.object_key, `evidence/${id}`);
  assert.match(after.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await objectStore().head(`quarantine/${id}`), null);
  assert.equal((await objectStore().head(`evidence/${id}`))?.size, body.length);
  const audit = await admin.query("SELECT actor_id,action FROM jamatnama.audit_log WHERE target=$1", [id]);
  assert.deepEqual(audit.rows, [{ actor_id: "scanner", action: "evidence.scan.clean" }]);
});
test("an infected file is destroyed, never reaches evidence/ and releases its budget", async () => {
  const body = Buffer.concat([samples.pdf(), Buffer.from(EICAR)]);
  const id = await submit("application/pdf", body);
  const before = Number((await admin.query("SELECT bytes FROM jamatnama.upload_budget WHERE period='total'")).rows[0].bytes);
  await scan(engine());
  const after = await row(id);
  assert.equal(after.state, "infected");
  assert.equal(after.scan_detail, "Eicar-Test-Signature");
  assert.equal(await objectStore().head(`quarantine/${id}`), null);
  assert.equal(await objectStore().head(`evidence/${id}`), null);
  const released = Number((await admin.query("SELECT bytes FROM jamatnama.upload_budget WHERE period='total'")).rows[0].bytes);
  assert.equal(released, before - body.length);
});
test("images are decoded and rewritten, removing EXIF metadata", async () => {
  const marker = "PRIVATE-GPS-LOCATION-MARKER";
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff7873" } }).withExif({ IFD0: { Copyright: marker } }).jpeg().toBuffer();
  assert.ok(image.includes(marker), "fixture carries metadata");
  const id = await submit("image/jpeg", image);
  await scan(engine());
  const after = await row(id);
  assert.equal(after.state, "clean");
  assert.equal(after.mime, "image/webp");
  const stored = Buffer.from(await objectStore().readRange(`evidence/${id}`, 0, 1024 * 1024));
  assert.equal(stored.includes(marker), false);
  assert.equal((await sharp(stored).metadata()).format, "webp");
});
test("a file that sniffs as an image but cannot be decoded is rejected", async () => {
  const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 7)]);
  const id = await submit("image/jpeg", fake);
  await scan(engine());
  assert.equal((await row(id)).state, "rejected");
  assert.equal(await objectStore().head(`quarantine/${id}`), null);
});
test("the scanner fails closed: an engine error or outage never marks a file clean", async () => {
  const id = await submit("application/pdf", samples.pdf());
  const down: ScanEngine = { name: "x", ping: async () => false, scan: async () => ({ clean: true }) };
  assert.equal(await scan(down), 0);
  assert.equal((await row(id)).state, "pending_scan");
  assert.equal((await row(id)).scan_attempts, 0, "an outage spends no attempts");
  const broken: ScanEngine = { name: "x", ping: async () => true, scan: async () => { throw Object.assign(Error("no verdict"), { code: "CLAMD_NO_VERDICT" }); } };
  await scan(broken, 1);
  const after = await row(id);
  assert.equal(after.state, "pending_scan");
  assert.equal(after.scan_attempts, 1);
  assert.ok(await objectStore().head(`quarantine/${id}`), "still in quarantine");
  await admin.query("UPDATE jamatnama.evidence SET scan_lease_until=NULL,scan_attempts=4 WHERE id=$1", [id]);
  await scan(broken, 1);
  assert.equal((await row(id)).state, "scan_error", "stops after repeated failures for manual review");
});
test("workers cannot claim the same file, and an expired lease is reclaimed", async () => {
  const id = await submit("application/pdf", samples.pdf());
  const claims = await asScanner(() => Promise.all(Array.from({ length: 5 }, () => claimJob())));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await asScanner(claimJob), null);
  await admin.query("UPDATE jamatnama.evidence SET scan_lease_until=now()-interval '1 second' WHERE id=$1", [id]);
  assert.equal((await asScanner(claimJob))?.id, id);
});
