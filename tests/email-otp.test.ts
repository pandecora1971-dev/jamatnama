import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createEmailOtp, hasPendingEmailOtp, verifyEmailOtp, MAX_LIVE_CODES } from "../lib/email-otp";
import { admin, finish, resetData } from "./support/db";

process.env.SESSION_SECRET = randomBytes(32).toString("hex");
beforeEach(resetData);
after(finish);

test("a late email still works: the newest few codes stay valid", async () => {
  const codes = [];
  for (let i = 0; i <= MAX_LIVE_CODES; i++) codes.push(await createEmailOtp("superadmin"));
  // The oldest code is retired once more than MAX_LIVE_CODES were sent.
  assert.equal(await verifyEmailOtp("superadmin", codes[0]), false);
  // An older-but-recent code works, as when the first email arrives after a resend.
  assert.equal(await verifyEmailOtp("superadmin", codes[1]), true);
});

test("signing in retires every other outstanding code", async () => {
  const first = await createEmailOtp("superadmin");
  const second = await createEmailOtp("superadmin");
  assert.equal(await verifyEmailOtp("superadmin", second), true);
  assert.equal(await verifyEmailOtp("superadmin", first), false);
  assert.equal(await verifyEmailOtp("superadmin", second), false);
  assert.equal(await hasPendingEmailOtp("superadmin"), false);
});

test("expired codes do not work and are cleaned up", async () => {
  const code = await createEmailOtp("superadmin");
  await admin.query("UPDATE jamatnama.rate_limits SET expires=$1 WHERE bucket LIKE 'email_otp:%'", [Date.now() - 1]);
  assert.equal(await verifyEmailOtp("superadmin", code), false);
  await createEmailOtp("superadmin");
  const { rows } = await admin.query("SELECT count(*)::int n FROM jamatnama.rate_limits WHERE bucket LIKE 'email_otp:%'");
  assert.equal(rows[0].n, 1);
});
