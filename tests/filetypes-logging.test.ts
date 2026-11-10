import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalMime, sniffMime, mp3AudioOffset } from "../lib/filetypes";
import { connectionConfig } from "../lib/pg-config.mjs";
import { logError, safeError } from "../lib/log";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ftyp = (brand: string, compat = "isom") => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4);
  b.write(brand.padEnd(4), 8);
  b.write(compat, 16);
  return b;
};
function wav(declared = 40, total = 48) {
  const b = Buffer.alloc(total);
  b.write("RIFF");
  b.writeUInt32LE(declared, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(4, 40);
  return b;
}
function mp3() {
  const b = Buffer.alloc(834);
  b.set([255, 251, 144, 0], 0);
  b.set([255, 251, 144, 0], 417);
  return b;
}
test("identifies each allowed format from its bytes", () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 4), "image/jpeg");
  assert.equal(sniffMime(png, 10), "image/png");
  assert.equal(sniffMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), 16), "image/webp");
  assert.equal(sniffMime(Buffer.from("%PDF-1.7"), 8), "application/pdf");
  assert.equal(sniffMime(wav(), 48), "audio/wav");
  assert.equal(sniffMime(mp3(), 834), "audio/mpeg");
  assert.equal(sniffMime(Buffer.from("OggS\0\0"), 6), "audio/ogg");
  assert.equal(sniffMime(ftyp("isom"), 64), "video/mp4");
  assert.equal(sniffMime(ftyp("qt"), 64), "video/quicktime");
  assert.equal(sniffMime(ftyp("M4A"), 64), "audio/mp4");
  assert.equal(sniffMime(ftyp("3gp4"), 64), "video/3gpp");
  assert.equal(sniffMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), 6), "video/webm");
});
test("rejects look-alikes, truncation and executable or markup content", () => {
  assert.equal(sniffMime(Buffer.from("<html>"), 6), null);
  assert.equal(sniffMime(Buffer.from("MZ\x90\0"), 4), null);
  assert.equal(sniffMime(Buffer.from("PK\x03\x04"), 4), null);
  assert.equal(sniffMime(Buffer.from("<svg xmlns='x'>"), 15), null);
  assert.equal(sniffMime(wav(), 500), null, "RIFF size must equal the object size");
  assert.equal(sniffMime(mp3().subarray(0, 600), 600), null);
  assert.equal(sniffMime(ftyp("evil", "evil"), 64), null, "unknown ISO brand");
  assert.equal(sniffMime(Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), 10), null, "tag with no audio");
});
test("reads past a large ID3 tag such as embedded cover art", () => {
  const head = Buffer.alloc(64 * 1024);
  head.write("ID3");
  head[3] = 3;
  head.set([0, 4, 0, 0], 6); // 65536 byte tag
  assert.equal(mp3AudioOffset(head), 65546);
  assert.equal(sniffMime(head, 100000), null, "cannot accept without seeing audio");
  assert.equal(sniffMime(head, 66380, mp3()), "audio/mpeg");
});
test("declared types normalize aliases and only fall back to the extension", () => {
  assert.equal(canonicalMime("image/jpg"), "image/jpeg");
  assert.equal(canonicalMime("audio/x-wav"), "audio/wav");
  assert.equal(canonicalMime("", "voice.M4A"), "audio/mp4");
  assert.equal(canonicalMime("application/octet-stream", "clip.mov"), "video/quicktime");
  assert.equal(canonicalMime("application/x-msdownload", "a.exe"), null);
  assert.equal(canonicalMime("text/html", "page.html"), null);
});
test("logs never contain messages, row values or signed URLs", () => {
  const secret = "SECRET-RECEIPT-abc https://bucket.example/o?X-Amz-Signature=deadbeef";
  const error = Object.assign(new Error(secret), { code: "23505", detail: `Key (receipt_hash)=(${secret})`, name: "error" });
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    logError("test.scope", error);
    logError("test.scope", { name: secret, code: secret });
    logError("test.scope", secret);
    logError("test.scope", null);
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.equal(line.includes("SECRET"), false);
    assert.equal(line.includes("Signature"), false);
  }
  assert.deepEqual(safeError(error), { name: "error", code: "23505" });
});
test("remote database connections verify TLS; a URL cannot weaken that", () => {
  const ca = Buffer.from("TEST CA").toString("base64");
  const config = connectionConfig("postgres://u:p@db.example:6543/postgres?sslmode=disable&pgbouncer=true", { DATABASE_CA_CERT: ca });
  assert.equal(config.connectionString.includes("sslmode"), false);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "TEST CA" });
  assert.throws(() => connectionConfig("postgres://u:p@db.example:6543/postgres", {}), /DATABASE_CA_CERT/);
  assert.equal(connectionConfig("postgres://u:p@127.0.0.1:5432/x", {}).ssl, false);
});
