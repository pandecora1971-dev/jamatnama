import { test } from "node:test";
import assert from "node:assert/strict";
import { categories, conditionalFields, categoryAliases, normalizeCategory } from "../lib/shared";
import { reportSchema } from "../lib/validation";
const base = { title: "কাল্পনিক পরীক্ষার অভিযোগ", description: "শুধু সফটওয়্যার পরীক্ষার জন্য কাল্পনিক বিবরণ, কোনো বাস্তব ব্যক্তি বা ঘটনার অভিযোগ নয়।", division: "ঢাকা", district: "ঢাকা", upazila: "সাভার", incidentDate: "2026-10-01", declaration: "1" };
test("all catalog categories accept their form fields and reject unrelated facts", () => {
 assert.equal(categories.length, 16);
 assert.equal(new Set(categories).size, 16);
 for (const category of categories) {
  const fields = conditionalFields[category];
  assert.ok(Array.isArray(fields), category);
  const facts = Object.fromEntries(fields.map(f => [f.key, f.type === "number" ? "2" : "কাল্পনিক প্রতিষ্ঠান"]));
  assert.equal(reportSchema.safeParse({ ...base, category, facts }).success, true, category);
  assert.equal(reportSchema.safeParse({ ...base, category, facts: { unknown_fact: "2" } }).success, false);
 }
});
test("legacy categories merge without losing or changing stored report facts", () => {
 for (const [old, current] of Object.entries(categoryAliases)) {
  const facts = Object.freeze({ victim_count: "3", loss_amount: "500" });
  const result = normalizeCategory(old, facts);
  assert.equal(result.category, current);
  assert.deepEqual(result.facts, facts);
  assert.equal(normalizeCategory(result.category, result.facts).category, current);
 }
 assert.equal(normalizeCategory("সাইবার অপরাধ", {}).category, "সাইবার অপরাধ");
});
test("reportSchema requires category, division, district and incidentDate while other fields remain optional", () => {
 const mandatoryOnly = {
  category: "রাজনৈতিক মামলা",
  division: "ঢাকা",
  district: "ঢাকা",
  incidentDate: "2026-10-01",
  declaration: "1",
 };
 const result = reportSchema.safeParse(mandatoryOnly);
 assert.equal(result.success, true);
 if (result.success) {
  assert.equal(result.data.category, "রাজনৈতিক মামলা");
  assert.equal(result.data.division, "ঢাকা");
  assert.equal(result.data.district, "ঢাকা");
  assert.equal(result.data.upazila, "");
  assert.equal(result.data.title, "অনির্ধারিত শিরোনাম");
  assert.equal(result.data.description, "বিস্তারিত বিবরণ দেওয়া হয়নি।");
 }
 // Missing category fails
 assert.equal(reportSchema.safeParse({ ...mandatoryOnly, category: "" }).success, false);
 // Missing division fails
 assert.equal(reportSchema.safeParse({ ...mandatoryOnly, division: "" }).success, false);
 // Missing district fails
 assert.equal(reportSchema.safeParse({ ...mandatoryOnly, district: "" }).success, false);
 // Missing incidentDate fails
 assert.equal(reportSchema.safeParse({ ...mandatoryOnly, incidentDate: "" }).success, false);
});
