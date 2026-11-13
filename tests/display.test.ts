import { test } from "node:test";
import assert from "node:assert/strict";
import { categories, displayDescription, displayTitle, placeLine, UNTITLED, NO_DESCRIPTION } from "../lib/shared";
import { reportSchema } from "../lib/validation";

const place = { category: "কাল্পনিক ক্যাটাগরি", district: "বগুড়া", upazila: "", ward: undefined, wardArea: undefined };

test("blank title and description fall back to readable text", () => {
  assert.equal(displayTitle({ ...place, title: UNTITLED }), "কাল্পনিক ক্যাটাগরি · বগুড়া");
  assert.equal(displayTitle({ ...place, title: "  " + UNTITLED }), "কাল্পনিক ক্যাটাগরি · বগুড়া");
  assert.equal(displayTitle({ ...place, title: "নিজস্ব শিরোনাম" }), "নিজস্ব শিরোনাম");
  assert.equal(displayDescription({ description: NO_DESCRIPTION }), "");
  assert.equal(displayDescription({ description: "নিজস্ব বিবরণ" }), "নিজস্ব বিবরণ");
});

test("placeholders match whichever Bangla য় encoding was stored", () => {
  const decomposed = NO_DESCRIPTION.replace(/য়/g, "য়");
  assert.notEqual(decomposed, NO_DESCRIPTION);
  assert.equal(displayDescription({ description: decomposed }), "");
});

test("the form stores the same placeholders the display helpers hide", () => {
  const parsed = reportSchema.safeParse({ category: categories[0], division: "ঢাকা", district: "ঢাকা", incidentDate: "2026-10-01", declaration: "1" });
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues[0].message);
  assert.equal(parsed.data.title, UNTITLED);
  assert.equal(parsed.data.description, NO_DESCRIPTION);
  assert.equal(displayTitle({ ...parsed.data, title: parsed.data.title }), `${categories[0]} · ঢাকা`);
});

test("place line has no empty parts or stray commas", () => {
  assert.equal(placeLine(place), "বগুড়া");
  assert.equal(placeLine({ ...place, upazila: "শেরপুর" }), "শেরপুর, বগুড়া");
  const withWard = placeLine({ ...place, upazila: "শেরপুর", ward: "5", wardArea: "শেরপুর পৌরসভা" });
  assert.equal(withWard.normalize("NFC"), "শেরপুর পৌরসভা, ওয়ার্ড ৫, শেরপুর, বগুড়া".normalize("NFC"));
});
