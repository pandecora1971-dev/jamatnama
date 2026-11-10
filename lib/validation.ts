import { z } from "zod";
import { categories, conditionalFields, normalizeWard, today } from "./shared";
import locations from "../public/data/locations.json";
export const accusedSchema = z
  .array(
    z
      .object({
        name: z
          .string()
          .trim()
          .max(120, "অভিযুক্তের নাম ১২০ অক্ষরের মধ্যে লিখুন।"),
        information: z
          .string()
          .trim()
          .max(2000, "অভিযুক্তের তথ্য ২০০০ অক্ষরের মধ্যে লিখুন।"),
      })
      .refine(
        (v) => Boolean(v.name || v.information),
        "অভিযুক্তের নাম বা প্রাসঙ্গিক তথ্য লিখুন।",
      ),
  )
  .max(10, "সর্বোচ্চ ১০ জন অভিযুক্তের তথ্য যোগ করা যাবে।");
export const sourceLinksSchema = z
  .array(
    z
      .string()
      .trim()
      .max(2000)
      .url("সঠিক সংবাদলিংক দিন।")
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "শুধু http বা https সংবাদলিংক দিন, লগইন তথ্য ছাড়া।"),
  )
  .max(5, "সর্বোচ্চ ৫টি সংবাদলিংক দিন।");
export const reportSchema = z
  .object({
    category: z
      .string()
      .min(1, "ক্যাটাগরি নির্বাচন করুন।")
      // Bangla ড়/ঢ়/য় can arrive precomposed or with a nukta; the catalog is stored in NFC.
      .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
      .refine((v) => categories.includes(v), "সঠিক ক্যাটাগরি নির্বাচন করুন।"),
    title: z
      .string()
      .trim()
      .max(180)
      .default("")
      .transform((v) => v || "অনির্ধারিত শিরোনাম"),
    description: z
      .string()
      .trim()
      .max(5000)
      .default("")
      .transform((v) => v || "বিস্তারিত বিবরণ দেওয়া হয়নি।"),
    division: z.string().min(1, "বিভাগ নির্বাচন করুন।"),
    district: z.string().min(1, "জেলা নির্বাচন করুন।"),
    upazila: z.string().default(""),
    ward: z.string().max(8).transform(normalizeWard)
      .refine((value) => value === "" || /^[1-9][0-9]{0,2}$/.test(value), "সঠিক ওয়ার্ড নম্বর দিন।").default(""),
    wardArea: z.string().trim().max(100)
      .refine((value) => !value || /^[\p{L}\p{M}\p{N} .()'-]+$/u.test(value), "শুধু ইউনিয়ন, পৌরসভা বা সিটি কর্পোরেশনের নাম লিখুন।").default(""),
    incidentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "ঘটনার তারিখ দিন।")
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v &&
          v <= today() &&
          v >= "1900-01-01",
        "সঠিক অতীত তারিখ দিন।",
      ),
    declaration: z.literal("1"),
    facts: z.record(z.string(), z.string().max(180)).default({}),
    accused: accusedSchema.default([]),
    sourceLinks: sourceLinksSchema.default([]),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.ward) !== Boolean(v.wardArea)) {
      ctx.addIssue({ code: "custom", path: ["ward"], message: "ওয়ার্ড নম্বর ও স্থানীয় প্রশাসনিক এলাকার নাম একসঙ্গে দিন।" });
    }
    const div = locations.divisions.find((d) => d.bn_name === v.division);
    if (!div) {
      ctx.addIssue({
        code: "custom",
        path: ["division"],
        message: "সঠিক বিভাগ নির্বাচন করুন।",
      });
    } else {
      const district = div.districts.find((d) => d.bn_name === v.district);
      if (!district) {
        ctx.addIssue({
          code: "custom",
          path: ["district"],
          message: "সঠিক জেলা নির্বাচন করুন।",
        });
      } else if (v.upazila && !district.upazilas.some((u) => u.bn_name === v.upazila)) {
        ctx.addIssue({
          code: "custom",
          path: ["upazila"],
          message: "সঠিক উপজেলা/থানা নির্বাচন করুন।",
        });
      }
    }
    const allowed = conditionalFields[v.category] || [];
    for (const [key, value] of Object.entries(v.facts)) {
      const f = allowed.find((f) => f.key === key);
      if (
        !f ||
        (f.type === "number" &&
          value !== "" &&
          (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 1e12))
      )
        ctx.addIssue({
          code: "custom",
          path: ["facts"],
          message: "অতিরিক্ত তথ্যের পরিমাণ সঠিকভাবে দিন।",
        });
    }
  });
