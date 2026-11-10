import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import {
  session,
  sessionValid,
  revokeSession,
  sameOrigin,
  validSignature,
} from "../lib/security";
import { rateLimit, revision, bump } from "../lib/db";
import { totpCode, totpStep } from "../lib/totp";
import { consumeTotp } from "../lib/admin-auth";
import { productionErrors } from "../lib/production-config.mjs";
import { acquire, verifyBot } from "../lib/abuse";
import { limitedJson } from "../lib/uploads";
import { reviewFlags } from "../lib/moderation";
import { listPublished } from "../lib/reports";
import { admin, finish, resetData } from "./support/db";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH =
  "test:" + scryptSync("private-test-password", "test", 64).toString("hex");
before(resetData);
after(finish);
test("sessions are revocable, expire, and stop working after credential rotation", async () => {
  const token = await session();
  assert.equal(await sessionValid(token), true);
  await revokeSession(token);
  assert.equal(await sessionValid(token), false);
  const next = await session();
  const original = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH += "changed";
  assert.equal(await sessionValid(next), false);
  process.env.ADMIN_PASSWORD_HASH = original;
  const expired = await session();
  await admin.query("UPDATE jamatnama.admin_sessions SET expires=0");
  assert.equal(await sessionValid(expired), false);
  assert.equal(await sessionValid("forged"), false);
});
test("TOTP follows the RFC vector, bounds clock drift, and prevents replay", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 1), "287082");
  assert.equal(totpStep(secret, "287082", 59000), 1);
  assert.equal(totpStep(secret, "287082", 150000), null);
  assert.equal(await consumeTotp(secret, "287082", 59000), true);
  assert.equal(await consumeTotp(secret, "287082", 59000), false);
  assert.equal(await consumeTotp(secret, "nototp", 59000), false);
});
test("MFA replay protection holds under concurrent attempts", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const attempts = await Promise.all(Array.from({ length: 8 }, () => consumeTotp(secret, totpCode(secret, 5000), 5000 * 30000, "race-identity")));
  assert.equal(attempts.filter(Boolean).length, 1);
});
test("persistent rate windows and concurrency slots enforce their limits", async () => {
  assert.equal(await rateLimit("test", 2, 60), true);
  assert.equal(await rateLimit("test", 2, 60), true);
  assert.equal(await rateLimit("test", 2, 60), false);
  await admin.query("UPDATE jamatnama.rate_limits SET expires=0 WHERE bucket='test'");
  assert.equal(await rateLimit("test", 2, 60), true);
  const release = acquire("test", 1);
  assert.ok(release);
  assert.equal(acquire("test", 1), null);
  release();
  release();
  const second = acquire("test", 1);
  assert.ok(second);
  second();
});
test("shared rate limits stay exact under concurrent requests", async () => {
  const results = await Promise.all(Array.from({ length: 40 }, () => rateLimit("concurrent", 10, 60)));
  assert.equal(results.filter(Boolean).length, 10);
});
test("bounded JSON rejects unknown-length oversized bodies", async () => {
  await assert.rejects(
    limitedJson(
      new Request("http://localhost", {
        method: "POST",
        body: '{"value":"' + "x".repeat(200) + '"}',
      }),
      100,
    ),
  );
  assert.deepEqual(
    await limitedJson(
      new Request("http://localhost", { method: "POST", body: '{"ok":true}' }),
    ),
    { ok: true },
  );
});
test("production refuses incomplete security configuration and pins the origin", () => {
  assert.ok(productionErrors({}).length >= 6);
  const env = {
    SESSION_SECRET: "x".repeat(32),
    ADMIN_PASSWORD_HASH: "salt:" + "a".repeat(128),
    RESEND_API_KEY: "re_test",
    ADMIN_EMAIL: "owner@example.com",
    PUBLIC_ORIGIN: "https://example.com",
    COOKIE_SECURE: "true",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    DATABASE_URL: "postgres://example",
    MFA_ENCRYPTION_KEY: "a".repeat(64),
    CRON_SECRET: "c".repeat(32),
    R2_BUCKET: "bucket",
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
  };
  assert.deepEqual(productionErrors(env), []);
  for (const missing of ["DATABASE_URL", "MFA_ENCRYPTION_KEY", "CRON_SECRET", "R2_BUCKET", "RESEND_API_KEY", "ADMIN_EMAIL"] as const)
    assert.ok(productionErrors({ ...env, [missing]: "" }).some((error) => error.includes(missing)));
  process.env.PUBLIC_ORIGIN = env.PUBLIC_ORIGIN;
  assert.equal(
    sameOrigin(
      new Request("http://internal", {
        headers: { origin: "https://evil.example", host: "evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("http://internal", {
        headers: { origin: env.PUBLIC_ORIGIN },
      }),
    ),
    true,
  );
  delete process.env.PUBLIC_ORIGIN;
  assert.equal(validSignature("test", "é".repeat(64)), false);
});
test("bot verification fails closed on provider errors and checks hostname and action", async () => {
  const original = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "unit-only";
  process.env.PUBLIC_ORIGIN = "https://example.com";
  try {
    globalThis.fetch = async () =>
      Response.json({
        success: true,
        hostname: "evil.example",
        action: "report",
      });
    assert.equal(await verifyBot("token", "report"), false);
    globalThis.fetch = async () =>
      Response.json({
        success: true,
        hostname: "example.com",
        action: "admin-login",
      });
    assert.equal(await verifyBot("token", "report"), false);
    globalThis.fetch = async () =>
      Response.json({
        success: true,
        hostname: "example.com",
        action: "report",
      });
    assert.equal(await verifyBot("token", "report"), true);
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    assert.equal(await verifyBot("token", "report"), false);
  } finally {
    globalThis.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.PUBLIC_ORIGIN;
  }
});
test("review hints flag identity and spam without classifying political claims", async () => {
  assert.equal(
    reviewFlags("ঘটনার বিবরণ", "যোগাযোগ 01712345678 অথবা person@example.com")
      .length,
    1,
  );
  assert.equal(
    reviewFlags("ঘটনার বিবরণ", "একটি নির্দিষ্ট ঘটনার বিবরণ লিখেছি।").length,
    0,
  );
  assert.ok(reviewFlags("ঘটনার বিবরণ", "x".repeat(40)).length);
  assert.deepEqual((await listPublished({}, 6)).reports, []);
  const start = await revision();
  await bump();
  assert.equal(await revision(), start + 1);
  assert.deepEqual((await listPublished({}, 6)).reports, []);
});

test("JSON endpoints reject null, arrays and primitive payloads", async () => {
  for (const body of ["null", "[]", "42", '\"hello\"']) {
    await assert.rejects(limitedJson(new Request("http://localhost/api", {method:"POST",body})), /JSON object/);
  }
});

test("loading the database module again does not break timestamp parsing", async () => {
  // Next.js can evaluate a module once per route bundle within one process.
  await import(`../lib/db.ts?reload=${Date.now()}`);
  const { rows } = await admin.query("SELECT now() AS at");
  assert.equal(typeof rows[0].at, "string");
  assert.match(rows[0].at, /^\d{4}-\d{2}-\d{2}T/);
});
