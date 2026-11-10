import { test } from "node:test";
import assert from "node:assert/strict";
import { reportSchema } from "../lib/validation";
import { limitedJson } from "../lib/uploads";
const valid = {
  category: "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ",
  title: "নমুনা ঘটনার অভিযোগ",
  description:
    "এটি পরীক্ষার জন্য তৈরি একটি কাল্পনিক ঘটনার বিবরণ। কোনো বাস্তব ঘটনা নয়।",
  division: "ঢাকা",
  district: "ঢাকা",
  upazila: "সাভার",
  incidentDate: "2026-10-01",
  declaration: "1",
  facts: {  },
};
test("accepts valid anonymous report and strips unrecognized identity fields", () => {
  const result = reportSchema.parse({
    ...valid,
    reporterName: "private",
    email: "test@example.com",
    ip: "127.0.0.1",
  });
  assert.equal("reporterName" in result, false);
  assert.equal("email" in result, false);
  assert.equal("ip" in result, false);
});
test("rejects mismatched district and upazila", () => {
  assert.equal(
    reportSchema.safeParse({ ...valid, district: "খুলনা" }).success,
    false,
  );
  assert.equal(
    reportSchema.safeParse({ ...valid, upazila: "not-a-location" }).success,
    false,
  );
});
test("rejects invalid dates, missing declaration and invalid category facts", () => {
  for (const patch of [
    { incidentDate: "2099-01-01" },
    { incidentDate: "2026-02-31" },
    { declaration: "0" },
    { facts: { victim_count: "-1" } },
    { facts: { reporter_name: "private" } },
  ])
    assert.equal(reportSchema.safeParse({ ...valid, ...patch }).success, false);
});
test("enforces body size when content length is absent", async () => {
  const r = new Request("http://localhost", {
    method: "POST",
    body: new Uint8Array(101),
  });
  await assert.rejects(limitedJson(r, 100));
});

test("accepts accused names or identifying context without reporter identity", () => {
  const accused = [
    { name: "  কাল্পনিক ব্যক্তি  ", information: "পরীক্ষার তথ্য" },
    { name: "", information: "নাম অজানা, পরীক্ষামূলক তথ্য" },
  ];
  const result = reportSchema.parse({ ...valid, accused });
  assert.equal(result.accused[0].name, "কাল্পনিক ব্যক্তি");
  assert.equal(result.accused.length, 2);
  assert.deepEqual(reportSchema.parse(valid).accused, []);
});
test("bounds accused information and rejects empty or excessive entries", () => {
  for (const accused of [
    [{ name: "  ", information: "" }],
    [{ name: "x".repeat(121), information: "" }],
    [{ name: "", information: "x".repeat(2001) }],
    Array.from({ length: 11 }, () => ({ name: "পরীক্ষা", information: "" })),
  ])
    assert.equal(reportSchema.safeParse({ ...valid, accused }).success, false);
});

test("ward accepts Bangla digits and requires a parent area", () => {
  assert.equal(reportSchema.parse(valid).ward, "");
  const wardArea = "সাভার পৌরসভা";
  assert.equal(reportSchema.parse({ ...valid, ward: "০৫", wardArea }).ward, "5");
  for (const ward of ["", "০", "-5", "abc"]) {
    assert.equal(reportSchema.safeParse({ ...valid, ward, wardArea }).success, false);
  }
  assert.equal(reportSchema.safeParse({ ...valid, ward: "5" }).success, false);
});
