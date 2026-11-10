import { test } from "node:test";
import assert from "node:assert/strict";
import { audioMime } from "../lib/audio";
import { sourceLinksSchema } from "../lib/validation";
import { normalizeCategory, categories } from "../lib/shared";

test("accepts bounded web source links but rejects unsafe protocols and credentials", () => {
  assert.deepEqual(
    sourceLinksSchema.parse([" https://example.com/news?a=1 "]),
    ["https://example.com/news?a=1"],
  );
  for (const links of [
    ["javascript:alert(1)"],
    ["file:///etc/passwd"],
    ["https://user:pass@example.com"],
    ["not a url"],
    Array(6).fill("https://example.com"),
  ])
    assert.equal(sourceLinksSchema.safeParse(links).success, false);
});
test("unifies legacy theft and robbery metrics without modifying originals", () => {
  const facts = { theft_amount: "500", victim_count: "2" };
  assert.deepEqual(normalizeCategory("চুরি", facts), {
    category: "চুরি, ডাকাতি ও ছিনতাই",
    facts: { loss_amount: "500", victim_count: "2" },
  });
  assert.equal(facts.theft_amount, "500");
  assert.equal(
    normalizeCategory("ডাকাতি ও ছিনতাই", { robbery_amount: "700" }).facts
      .loss_amount,
    "700",
  );
  assert.equal(categories.includes("চুরি"), false);
});
test("validates WAV chunks and rejects mislabeled, truncated and tag-only files", () => {
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  assert.equal(audioMime(wav), "audio/wav");
  assert.equal(audioMime(wav.subarray(0, 46)), null);
  assert.equal(audioMime(Buffer.from("<html>fake audio</html>")), null);
  assert.equal(audioMime(Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0])), null);
  const mp3 = Buffer.alloc(834);
  mp3.set([255, 251, 144, 0], 0);
  mp3.set([255, 251, 144, 0], 417);
  assert.equal(audioMime(mp3), "audio/mpeg");
  assert.equal(audioMime(mp3.subarray(0, 600)), null);
});
