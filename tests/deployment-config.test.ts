import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => JSON.parse(readFileSync(name, "utf8"));
test("paid and Hobby Vercel configs run maintenance on the expected schedules", () => {
  const paid = read("vercel.json"), hobby = read("vercel.hobby.json");
  assert.equal(paid.crons[0].path, "/api/cron/maintenance");
  // vercel.json holds the paid 15-minute schedule, or the Hobby daily one copied from vercel.hobby.json.
  assert.ok(paid.crons[0].schedule === "*/15 * * * *" || paid.crons[0].schedule === hobby.crons[0].schedule);
  assert.equal(hobby.crons[0].path, paid.crons[0].path);
  assert.match(hobby.crons[0].schedule, /^\d+ \d+ \* \* \*$/, "Hobby schedule runs once a day");
  assert.deepEqual(hobby.regions, paid.regions);
});
test("the R2 CORS template allows only browser PUTs with the signed headers", () => {
  const [rule] = read("docs/r2-cors.json");
  assert.deepEqual(rule.AllowedMethods, ["PUT"]);
  assert.deepEqual(rule.AllowedHeaders.sort(), ["content-type", "if-none-match"]);
  assert.equal(rule.AllowedOrigins.includes("*"), false);
});
test(".env.example holds names only", () => {
  for (const line of readFileSync(".env.example", "utf8").split(/\r?\n/)) {
    if (line.startsWith("#") || !line.trim()) continue;
    const [name, value] = line.split("=");
    assert.ok(["COOKIE_SECURE", "DB_POOL_MAX"].includes(name) || value === "", `${name} must be empty`);
  }
});
