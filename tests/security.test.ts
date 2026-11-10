import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import {
  validSignature,
  sign,
  passwordValid,
  sameOrigin,
} from "../lib/security";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
test("rejects tampered signatures and wrong passwords", async () => {
  const value = "test";
  assert.equal(validSignature(value, sign(value)), true);
  assert.equal(validSignature("changed", sign(value)), false);
  const salt = "unit-test-only";
  process.env.ADMIN_PASSWORD_HASH = `${salt}:${scryptSync("test-pass", salt, 64).toString("hex")}`;
  assert.equal(await passwordValid("test-pass"), true);
  assert.equal(await passwordValid("wrong"), false);
});
test("rejects cross-origin mutation", () => {
  assert.equal(
    sameOrigin(
      new Request("http://localhost/api", {
        headers: { origin: "https://evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("http://localhost/api", {
        headers: { origin: "http://localhost" },
      }),
    ),
    true,
  );
});

test("accepts original browser host behind Next internal URL rewriting", () => {
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api", {
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      }),
    ),
    true,
  );
});

test("production mutations require an explicit trusted origin", () => {
  const previous = process.env.NODE_ENV;
  const origin = process.env.PUBLIC_ORIGIN;
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.PUBLIC_ORIGIN = "https://reports.example";
  try {
    assert.equal(sameOrigin(new Request("https://reports.example/api")), false);
    assert.equal(sameOrigin(new Request("https://reports.example/api", {headers:{origin:"null"}})), false);
    assert.equal(sameOrigin(new Request("https://reports.example/api", {headers:{origin:"https://reports.example"}})), true);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: previous });
    if (origin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = origin;
  }
});
