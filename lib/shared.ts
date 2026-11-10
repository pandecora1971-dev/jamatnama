import fields from "./categories.json";
export const categories = [
  "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ",
  "বলৎকার, ধর্ষণ, নারী ও শিশু নির্যাতন",
  "ধর্মীয় উগ্রতা ও জঙ্গিবাদী বক্তব্য",
  "মুক্তিযোদ্ধাদের হয়রানি ও অবমাননা",
  "মুক্তিযুদ্ধের স্মৃতি ও ভাস্কর্য ভাঙচুর",
  "রাজনৈতিক মামলা",
  "রাজনৈতিক সহিংসতা",
  "সংখ্যালঘু নির্যাতন",
  "কর্মক্ষেত্রে মব ও হয়রানি",
  "সাংবাদিক হত্যা, হয়রানি ও মতপ্রকাশে বাধা",
  "ধর্ষণ ও পরকীয়াসংক্রান্ত অভিযোগ",
  "মওদুদীবাদ ও ইসলাম বিকৃতির অভিযোগ",
  "প্রশাসনিক হয়রানি ও দুর্নীতিতে সংশ্লিষ্টতার অভিযোগ",
  "দলীয়করণ, লুটপাট, অনিয়ম ও স্বজনপ্রীতি",
  "জেলহত্যা ও নির্যাতন",
  "ডিপস্টেট ও আলবদর সংশ্লিষ্টতার অভিযোগ"
];
export const divisions = [
  "ঢাকা",
  "চট্টগ্রাম",
  "রাজশাহী",
  "খুলনা",
  "বরিশাল",
  "সিলেট",
  "রংপুর",
  "ময়মনসিংহ",
];
export const conditionalFields = fields as Record<
  string,
  Array<{
    key: string;
    label: string;
    type: string;
    settings: { unit: string };
  }>
>;
export type AccusedPerson = { name: string; information: string };
export type Report = {
  id: string;
  title: string;
  description: string;
  category: string;
  division: string;
  district: string;
  upazila: string;
  ward?: string;
  wardArea?: string;
  incidentDate: string;
  createdAt: string;
  status: "pending" | "published" | "rejected";
  facts: Record<string, string>;
  supports: number;
  demo?: boolean;
  evidenceCount?: number;
};
export type PublicStats = {
  total: number;
  today: number;
  categories: Record<string, number>;
  divisions: Record<string, number>;
  districts: Record<string, number>;
  metrics: Record<string, Record<string, number>>;
  latest: { category: string; division: string; incidentDate: string } | null;
};
/** Same shape as the server aggregates; used for the clearly labelled demo samples only. */
export function statsFromReports(reports: Report[]): PublicStats {
  const stats: PublicStats = { total: reports.length, today: 0, categories: {}, divisions: {}, districts: {}, metrics: {}, latest: null };
  for (const r of reports) {
    stats.categories[r.category] = (stats.categories[r.category] || 0) + 1;
    stats.divisions[r.division] = (stats.divisions[r.division] || 0) + 1;
    stats.districts[r.district] = (stats.districts[r.district] || 0) + 1;
    if (r.createdAt.slice(0, 10) === today()) stats.today++;
    const metrics = (stats.metrics[r.category] ||= {});
    for (const [key, value] of Object.entries(r.facts)) metrics[key] = (metrics[key] || 0) + (Number(value) || 0);
  }
  const top = reports[0];
  if (top) stats.latest = { category: top.category, division: top.division, incidentDate: top.incidentDate };
  return stats;
}
export const bn = (n: number) => new Intl.NumberFormat("bn-BD").format(n);
export const date = (s: string) =>
  new Date(s).toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const statusLabels = {
  pending: "পর্যালোচনাধীন",
  published: "প্রকাশিত অভিযোগ",
  rejected: "প্রকাশ করা হয়নি",
};

export function metricLabel(category: string, key: string) {
  const labels: Record<string, string> = {
    bribery_amount: "ঘুষ/দুর্নীতির অর্থ",
    extortion_amount: "দাবিকৃত অর্থ",
    theft_amount: "চুরির অর্থ",
    robbery_amount: "অর্থের পরিমাণ",
    loss_amount: "আর্থিক ক্ষতি",
    involved_count: "জড়িত ব্যক্তি",
    case_count: "মামলার সংখ্যা",
    killed_count: "নিহত",
    injured_count: "আহত",
    land_amount: "দখলকৃত জমি",
    load_shedding_hours: "দৈনিক লোডশেডিং",
  };
  if (key === "victim_count" && categories.includes(category)) return "ক্ষতিগ্রস্ত ব্যক্তি";
  if (key === "victim_count")
    return category === "খুন"
      ? "নিহত"
      : category === "গুম ও অপহরণ"
        ? "গুম/অপহৃত"
        : category === "ধর্ষণ"
          ? "ধর্ষণের শিকার"
          : category === "নারী ও শিশু নির্যাতন"
            ? "নির্যাতনের শিকার"
            : "হয়রানির শিকার";
  return labels[key] || "সংশ্লিষ্ট সংখ্যা";
}

// Read-time aliases leave stored reports and evidence untouched.
export const categoryAliases: Record<string, string> = {
  "মব সৃষ্টি ও গণপিটুনি": "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ",
  "খুন": "খুন, অপহরণ, গুম ও হত্যাচেষ্টা",
  "গুম ও অপহরণ": "খুন, অপহরণ, গুম ও হত্যাচেষ্টা",
  "হত্যাচেষ্টা": "খুন, অপহরণ, গুম ও হত্যাচেষ্টা",
  "চাঁদাবাজি": "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল",
  "টেন্ডারবাজি": "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল",
  "জমি দখল": "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল",
  "গণহত্যা ও নির্যাতন": "হত্যা ও নির্যাতন",
  "সংখ্যালঘুদের ওপর নির্যাতন": "সংখ্যালঘু নির্যাতন",
  "ধর্ষণ": "ধর্ষণ, নারী ও শিশু নির্যাতন",
  "নারী ও শিশু নির্যাতন": "ধর্ষণ, নারী ও শিশু নির্যাতন",
  "ইভ টিজিং ও যৌন হয়রানি": "ধর্ষণ, নারী ও শিশু নির্যাতন",
  "লোডশেডিং": "লোডশেডিং, তেল, গ্যাস ও সার সংকট",
  "লোডশেডিং, তেল ও গ্যাস সংকট": "লোডশেডিং, তেল, গ্যাস ও সার সংকট",
  "কর্মক্ষেত্রে হয়রানি": "কর্মক্ষেত্রে মব ও হয়রানি",
  "প্রতারণা ও জালিয়াতি": "প্রতারণা, জালিয়াতি, নিয়োগ বাণিজ্য ও প্রশ্নফাঁস",
  "নিয়োগ বাণিজ্য ও প্রশ্নফাঁস": "প্রতারণা, জালিয়াতি, নিয়োগ বাণিজ্য ও প্রশ্নফাঁস",
  "সরকারি সেবায় অনিয়ম": "সরকারি সেবায় অনিয়ম ও বরাদ্দ লুটপাট",
  "সরকারি বরাদ্দ ও ত্রাণ লুটপাট": "সরকারি সেবায় অনিয়ম ও বরাদ্দ লুটপাট",
  "সাংবাদিক হয়রানি ও মতপ্রকাশে বাধা": "সাংবাদিক হত্যাকাণ্ড, হয়রানি ও মতপ্রকাশে বাধা",
  "মতপ্রকাশে বাধা ও সাংবাদিক হয়রানি": "সাংবাদিক হত্যাকাণ্ড, হয়রানি ও মতপ্রকাশে বাধা",
  "দেশবিরোধী চুক্তির অভিযোগ": "দেশবিরোধী চুক্তি ও সংশ্লিষ্টতা",
  "ঘুষ ও দুর্নীতি": "প্রশাসনিক হয়রানি ও মিথ্যা মামলা",
  "প্রশাসনিক দুর্নীতি, বাণিজ্য ও প্রশাসনিক হয়রানি": "প্রশাসনিক হয়রানি ও মিথ্যা মামলা",
  "হাম শিশু মৃত্যু": "হাম ও শিশু মৃত্যু",
  "'জয় বাংলা' স্লোগানের জন্য মারধর ও নির্যাতন": "জয় বাংলা' স্লোগানের জন্য মারধর ও নির্যাতন",
  "‘জয় বাংলা’ স্লোগানের জন্য মারধর ও নির্যাতন": "জয় বাংলা' স্লোগানের জন্য মারধর ও নির্যাতন",
  "জয় বাংলা স্লোগানের জন্য মারধর ও নির্যাতন": "জয় বাংলা' স্লোগানের জন্য মারধর ও নির্যাতন"
};
export function normalizeCategory(category: string, facts: Record<string, string>) {
  if (category === "চুরি" || category === "ডাকাতি ও ছিনতাই") {
    const { theft_amount, robbery_amount, ...rest } = facts;
    return { category: "চুরি, ডাকাতি ও ছিনতাই", facts: {
      ...rest, ...(theft_amount || robbery_amount ? { loss_amount: theft_amount || robbery_amount } : {}),
    }};
  }
  return { category: categoryAliases[category] || category, facts };
}

export function normalizeWard(value: string) {
  return value.trim().replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit))).replace(/^0+(?=[0-9])/, "");
}
