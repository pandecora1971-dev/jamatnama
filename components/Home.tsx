"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  Link2,
  ShieldAlert,
  Hand,
  Fingerprint,
  Skull,
  HeartPulse,
  LandPlot,
  Coins,
  Files,
  Monitor,
  FlaskConical,
  KeyRound,
  Swords,
  Flag,
  Briefcase,
  Building2,
  Zap,
  Scale,
  Trees,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  bn,
  categories,
  conditionalFields,
  date,
  divisions,
  statusLabels,
  metricLabel,
  normalizeWard,
  statsFromReports,
  type PublicStats,
  type Report,
} from "@/lib/shared";
import Modal from "./Modal";
import ReportForm from "./ReportForm";
import LocationFields from "./LocationFields";
import ReportCard from "./ReportCard";
import MotionEnhancements from "./MotionEnhancements";
import EditorialHero from "./EditorialHero";
import {
  HowItHelps,
  ReportGuide,
  ReportJourney,
  PrivacyExplainer,
  PublicExpectations,
} from "./ExplainerSections";
const ReportMap = dynamic(() => import("./ReportMap"), {
  loading: () => <div className="map-loading">মানচিত্র প্রস্তুত হচ্ছে…</div>,
});
const icons: Record<string, typeof ShieldAlert> = {
  "বিএনপির দুঃশাসন": Building2,
  "পুলিশ হত্যা সম্পর্কিত তথ্য": ShieldAlert,
  "জুলাই জঙ্গি ও সন্ত্রাসী": Flag,
  "নাশকতা ও অগ্নিসন্ত্রাস": Swords,
  "প্রশাসনিক হয়রানি ও মিথ্যা মামলা": Flag,
  "হাম ও শিশু মৃত্যু": HeartPulse,
  "জয় বাংলা' স্লোগানের জন্য মারধর ও নির্যাতন": ShieldAlert,
  "ইতিহাস বিকৃতি ও মিথ্যাচার": Flag,
  "শিক্ষা প্রতিষ্ঠানে বহিষ্কার ও মব": Briefcase,
  "মব সৃষ্টি, গণপিটুনি, বাড়িঘর লুটপাট ও অগ্নিসংযোগ": Swords,
  "খুন, অপহরণ, গুম ও হত্যাচেষ্টা": Skull,
  "চাঁদাবাজি, টেন্ডারবাজি ও জমি দখল": Coins,
  "মুক্তিযুদ্ধের স্মৃতি ও ভাস্কর্য ভাঙচুর": LandPlot,
  "মুক্তিযোদ্ধাদের হয়রানি ও অবমাননা": ShieldAlert,
  "রাজনৈতিক মামলা": Scale,
  "রাজনৈতিক সহিংসতা": Flag,
  "হত্যা ও নির্যাতন": ShieldAlert,
  "সংখ্যালঘু নির্যাতন": Hand,
  "ধর্ষণ, নারী ও শিশু নির্যাতন": ShieldAlert,
  "লোডশেডিং, তেল, গ্যাস ও সার সংকট": Zap,
  "দলীয়করণ, লুটপাট, অনিয়ম ও স্বজনপ্রীতি": Building2,
  "কর্মক্ষেত্রে মব ও হয়রানি": Briefcase,
  "প্রতারণা, জালিয়াতি, নিয়োগ বাণিজ্য ও প্রশ্নফাঁস": Files,
  "সরকারি সেবায় অনিয়ম ও বরাদ্দ লুটপাট": Banknote,
  "সাংবাদিক হত্যাকাণ্ড, হয়রানি ও মতপ্রকাশে বাধা": Monitor,
  "দেশবিরোধী চুক্তি ও সংশ্লিষ্টতা": Link2,
  "ধর্মীয় উগ্রতা ও জঙ্গিবাদী বক্তব্য": Flag,
  "মাদকসংক্রান্ত অপরাধ": FlaskConical,
  "সংখ্যালঘুদের উপর হামলা ও উপাসনালয় ভাঙচুর": Hand,
  "বিএনপি সম্পর্কে সাধারণ মানুষের প্রতিক্রিয়া": Monitor,
  "অন্যান্য বিষয়াদি": Files,
};
const emptyLoc = { division: "", district: "", upazila: "" };
type Filters = {
  q: string;
  category: string;
  division: string;
  district: string;
  upazila: string;
  ward?: string;
  wardArea?: string;
  from: string;
  to: string;
};
const emptyFilters = { q: "", category: "", ...emptyLoc, from: "", to: "" };
const faqs = [
  [
    "রিপোর্ট জমা দিতে কি অ্যাকাউন্ট লাগবে?",
    "না। নাম, ইমেইল, ফোন নম্বর বা অ্যাকাউন্ট ছাড়াই রিপোর্ট জমা দেওয়া যায়। রিপোর্টের অবস্থা জানতে গোপন ট্র্যাকিং কোডটি সংরক্ষণ করুন।",
  ],
  [
    "রিপোর্ট কখন ওয়েবসাইটে দেখা যাবে?",
    "জমা দেওয়া রিপোর্ট প্রথমে পর্যালোচনাধীন থাকে। তথ্য, প্রমাণ ও ব্যক্তিগত পরিচয় পরীক্ষা করে প্রকাশের অনুমোদন দেওয়া হলে লাইভ তালিকা, মানচিত্র ও পরিসংখ্যান স্বয়ংক্রিয়ভাবে আপডেট হয়।",
  ],
  [
    "প্রমাণ হিসেবে কী সংযুক্ত করা যাবে?",
    "ছবি (JPG, PNG, WebP), PDF, অডিও (MP3, WAV, M4A, OGG), ভিডিও (MP4, MOV, WebM, 3GP) এবং সর্বোচ্চ ৫টি সংবাদলিংক সংযুক্ত করতে পারবেন। ফাইলের সংখ্যা ও প্রতিটি ধরনের সর্বোচ্চ আকার রিপোর্ট ফর্মের প্রমাণ অংশে দেখানো হয়। প্রমাণ শুধু অনুমোদিত পর্যালোচক দেখতে পারবেন; সবার সামনে প্রকাশ করা হয় না।",
  ],
  [
    "ব্যক্তিগত তথ্য কি প্রকাশিত হবে?",
    "আমরা রিপোর্টকারীর নাম, ফোন, ইমেইল বা IP ঠিকানা অ্যাপের ডেটাবেসে সংরক্ষণ করি না। তবে আপনার লেখা ও ফাইলে পরিচয় থাকতে পারে—জমা দেওয়ার আগে সরিয়ে নিন। হোস্টিং প্রতিষ্ঠানের লগ আলাদাভাবে নিয়ন্ত্রণ করতে হবে।",
  ],
  [
    "রিপোর্টে সমর্থন দেওয়ার অর্থ কী?",
    "সমর্থন হলো পাঠকের প্রতিক্রিয়া। এটি স্বাধীন তথ্য যাচাই, অপরাধের প্রমাণ বা আদালতের রায় নয়। একই ব্রাউজার থেকে একটি রিপোর্টে একবার সমর্থন গণনা হয়।",
  ],
];
function Title({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="jwr-section-title">
      <h2>
        {children}
        <span>।</span>
      </h2>
      {note && <p>{note}</p>}
    </div>
  );
}
function Ranking({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="jwr-ranking">
      <h3>{title}</h3>
      {rows.length ? (
        rows.slice(0, 10).map(([label, n], i) => (
          <div className="rank-row" key={label}>
            <small>{bn(i + 1).padStart(2, "০")}</small>
            <span>{label}</span>
            <i>
              <b style={{ width: `${(n * 100) / max}%` }} />
            </i>
            <strong>{bn(n)}</strong>
          </div>
        ))
      ) : (
        <p className="muted">প্রকাশিত রিপোর্ট পাওয়া যায়নি।</p>
      )}
    </div>
  );
}
const PAGE = 6;
const MAX_REFRESH = 48;
const POLL_MS = 30_000;
const FULL_REFRESH_MS = 5 * 60_000;
function filterQuery(filter: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter))
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  return params;
}
export default function Home() {
  const [list, setList] = useState<Report[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [total, setTotal] = useState(0),
    [totalCapped, setTotalCapped] = useState(false),
    [stats, setStats] = useState<PublicStats | null>(null),
    [revision, setRevision] = useState<number | null>(null),
    [listError, setListError] = useState(""),
    [loadingMore, setLoadingMore] = useState(false),
    [live, setLive] = useState(false);
  const [modal, setModal] = useState<"report" | "privacy" | "track" | null>(
    null,
  ),
    [detail, setDetail] = useState<Report | null>(null),
    [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState<Filters>(emptyFilters),
    [filter, setFilter] = useState<Filters>(emptyFilters),
    [limit, setLimit] = useState(PAGE);
  const [trackCode, setTrackCode] = useState(""),
    [trackResult, setTrackResult] = useState<{
      status: keyof typeof statusLabels;
      note: string;
    } | null>(null),
    [trackError, setTrackError] = useState(""),
    [tracking, setTracking] = useState(false),
    [share, setShare] = useState(false);
  // The revision is part of every data URL, so a publish or withdrawal moves all clients to new cache entries.
  const loadStats = useCallback(async (rev: number) => {
    const r = await fetch(`/api/stats?rev=${rev}`);
    if (!r.ok) throw Error();
    const d = await r.json();
    setStats(d.stats);
    return d.stats as PublicStats;
  }, []);
  const loadList = useCallback(async (rev: number, active: Filters, size: number) => {
    const params = filterQuery(active);
    params.set("limit", String(Math.min(MAX_REFRESH, Math.ceil(size / PAGE) * PAGE)));
    params.set("rev", String(rev));
    const r = await fetch(`/api/reports?${params}`);
    const d = await r.json();
    if (!r.ok) {
      setListError(d.error || "রিপোর্ট লোড করা যায়নি।");
      return;
    }
    setListError("");
    setList(d.reports);
    setNextCursor(d.nextCursor);
    setTotal(d.total ?? 0);
    setTotalCapped(Boolean(d.totalCapped));
  }, []);
  const view = useRef({ filter: emptyFilters as Filters, limit: PAGE });
  view.current = { filter, limit };
  const openDetail = useRef<string | null>(null);
  openDetail.current = detail ? detail.id : null;
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, failures = 0, current: number | null = null, lastFull = 0;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/revision");
        if (!r.ok) throw Error();
        const { revision: next } = await r.json();
        if (stopped) return;
        // Supports do not bump the revision, so counts also refresh on a slow timer.
        const due = Date.now() - lastFull > FULL_REFRESH_MS;
        if (next !== current || due) {
          current = next;
          lastFull = Date.now();
          setRevision(next);
          await loadStats(next);
          await loadList(next, view.current.filter, view.current.limit);
          const open = openDetail.current;
          if (open) {
            const response = await fetch(`/api/reports/${open}?rev=${next}`);
            if (response.status === 404) setDetail(null);
          }
        }
        failures = 0;
        setLive(true);
      } catch {
        failures++;
        setLive(false);
      }
    };
    const schedule = () => {
      const backoff = Math.min(FULL_REFRESH_MS, POLL_MS * 2 ** failures);
      // Jitter spreads simultaneous visitors so that a spike does not poll in lockstep.
      timer = setTimeout(async () => {
        await poll();
        if (!stopped) schedule();
      }, backoff + Math.random() * 10_000);
    };
    const visible = () => {
      if (!document.hidden && !stopped) void poll();
    };
    void poll().then(() => {
      if (!stopped) schedule();
    });
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadList, loadStats]);
  useEffect(() => {
    if (revision !== null) void loadList(revision, filter, PAGE).catch(() => setLive(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("report");
    if (!id) return;
    fetch(`/api/reports/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.report) setDetail(d.report);
      })
      .catch(() => { });
  }, []);
  async function loadMore() {
    if (!nextCursor || revision === null) return;
    setLoadingMore(true);
    try {
      const params = filterQuery(filter);
      params.set("limit", String(PAGE));
      params.set("cursor", nextCursor);
      params.set("rev", String(revision));
      const r = await fetch(`/api/reports?${params}`);
      if (!r.ok) throw Error();
      const d = await r.json();
      setList((rows) => [...rows, ...d.reports.filter((x: Report) => !rows.some((row) => row.id === x.id))]);
      setNextCursor(d.nextCursor);
      setLimit((l) => l + PAGE);
    } catch {
      setListError("আরও রিপোর্ট লোড করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setLoadingMore(false);
    }
  }
  const summary = stats;
  const totalReports = summary?.total ?? 0;
  const latest = summary?.latest;
  const shown = list;
  const shownTotal = total;
  const hasMore = Boolean(nextCursor);
  const categoryRows = categories
    .map((c) => [c, summary?.categories[c] || 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const divisionRows = divisions
    .map((d) => [d, summary?.divisions[d] || 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const districtRows = Object.entries(summary?.districts || {}).sort((a, b) => b[1] - a[1]);
  function categoryFilter(c: string) {
    setDraft({ ...emptyFilters, category: c });
    setFilter({ ...emptyFilters, category: c });
    setLimit(PAGE);
    document.getElementById("reports")?.scrollIntoView({ behavior: "smooth" });
  }
  async function track(e: React.SubmitEvent) {
    e.preventDefault();
    setTracking(true);
    setTrackError("");
    setTrackResult(null);
    try {
      const r = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: trackCode.trim() }),
      }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setTrackResult(d);
    } catch (e) {
      setTrackError(e instanceof Error ? e.message : "পরে চেষ্টা করুন।");
    } finally {
      setTracking(false);
    }
  }
  return (
    <div className="jwr-homepage jm-editorial">
      <MotionEnhancements />
      <a href="#content" className="skip-link">
        মূল বিষয়বস্তুতে যান
      </a>
      <header className="jwr-site-header">
        <div className="jwr-shell">
          <div className="brand-wrap">
            <button
              className="brand-menu jwr-brand"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              <span className="jm-brand-symbol" aria-hidden="true">✳</span>
              <span>
                জামাতনামা<i>′</i>
              </span>
              <small>⌄</small>
            </button>
            {menu && (
              <div className="brand-dropdown">
                <strong>JAMATNAMA</strong>
                <a href="#content" onClick={() => setMenu(false)}>
                  হোম
                </a>
                <a href="#reports" onClick={() => setMenu(false)}>
                  লাইভ রিপোর্ট
                </a>
                <button
                  onClick={() => {
                    setModal("track");
                    setMenu(false);
                  }}
                >
                  রিপোর্টের অবস্থা
                </button>
                <button
                  onClick={() => {
                    setModal("privacy");
                    setMenu(false);
                  }}
                >
                  নিরাপত্তা ও গোপনীয়তা
                </button>
                <a href="/admin">পর্যালোচনা প্যানেল ↗</a>
              </div>
            )}
          </div>
          <nav aria-label="প্রধান নেভিগেশন">
            <a href="#content">হোম</a>
            <a href="#reports">রিপোর্ট</a>
            <a href="#categories">ক্যাটাগরি</a>
            <a href="#statistics">ডাটা ও পরিসংখ্যান</a>
            <a href="#process">কীভাবে কাজ করে</a>
            <a href="#faq">সাহায্য</a>
            <button onClick={() => setModal("track")}>রিপোর্টের অবস্থা</button>
          </nav>
          <button className="jwr-header-cta" onClick={() => setModal("report")}>
            নতুন রিপোর্ট +
          </button>
        </div>
      </header>
      <main id="content">
        <section className="jwr-home-hero jm-hero-section">
          <div className="jwr-shell">
            <div className="jwr-hero jm-hero-layout">
              <div className="jwr-hero-copy">
                <div className="jm-eyebrow"><span/>বিশ্বাসের মর্যাদা · সবার সমান অধিকার</div>
                <h1 className="jm-headline"><span>ধর্মের দোহাইয়ে</span><em>অন্যায় নয়।</em></h1>
                <p className="jm-hero-description">ধর্মের ভুল ব্যাখ্যা বা দোহাই দিয়ে কাউকে ভয় দেখানো, চুপ করানো কিংবা অধিকার থেকে বঞ্চিত করার অভিযোগ জানান। নিজের পরিচয় না দিয়েও ঘটনার বিবরণ ও প্রমাণ জমা দিতে পারবেন।</p>
                <div className="jwr-hero-actions">
                  <button className="jwr-button" onClick={() => setModal("report")}>একটি ঘটনা জানান ↗</button>
                  <a className="jm-quiet-link" href="#reports">নথিগুলো দেখুন <span>↓</span></a>
                </div>
                <div className="jm-hero-promises"><span>◈ পরিচয়বিহীন</span><span>▤ প্রমাণসহ রিপোর্ট</span><span>◎ মানুষের পর্যালোচনা</span></div>
                <button className="jm-tracking-link" onClick={() => setModal("track")}>আগে রিপোর্ট করেছেন? অগ্রগতি দেখুন ↗</button>
              </div>
              <EditorialHero />
            </div>
            <div className="jm-chapter-rail"><a href="#reports"><small>০১ / অনুসন্ধান</small><strong>ঘটনার নথি পড়ুন <span>↗</span></strong></a><a href="#map"><small>০২ / এলাকার চিত্র</small><strong>মানচিত্রে খুঁজুন <span>↗</span></strong></a><a href="#process"><small>০৩ / জানুন</small><strong>কীভাবে কাজ করে <span>↗</span></strong></a></div>
          </div>
        </section>
        <div className="jwr-shell">
          <div className="jwr-live-summary">
            <div>
              <small>সর্বশেষ প্রকাশিত রিপোর্ট</small>
              <strong>
                {latest?.category || "প্রথম রিপোর্টের অপেক্ষায়"}
              </strong>
              <span className="jwr-summary-meta">
                {latest
                  ? `${latest.division} · ${date(latest.incidentDate)}`
                  : "আপনার কণ্ঠ থেকেই পরিবর্তনের শুরু"}
              </span>
            </div>
            <div>
              <small>মোট রিপোর্ট</small>
              <strong className="summary-number">{bn(totalReports)}</strong>
              <span className="jwr-summary-meta">
                সর্বমোট প্রকাশিত অভিযোগ
              </span>
            </div>
            <div>
              <small>সর্বাধিক রিপোর্টকৃত ক্যাটাগরি</small>
              <div className="jwr-summary-bars">
                {categoryRows.slice(0, 3).map(([c, n]) => (
                  <div className="summary-bar" key={c}>
                    <span>{c}</span>
                    <i>
                      <b
                        style={{
                          width: `${(n * 100) / Math.max(categoryRows[0][1], 1)}%`,
                        }}
                      />
                    </i>
                    <strong>{bn(n)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="jwr-home-notice jwr-safety-notice">
            <span>
              আপনার পরিচয় সুরক্ষিত রাখতে অপ্রয়োজনীয় ব্যক্তিগত তথ্য প্রকাশ করবেন
              না।
            </span>
            <button onClick={() => setModal("privacy")}>
              নিরাপত্তা সম্পর্কে জানুন →
            </button>
          </div>
        </div>
        <HowItHelps />
        <section className="jwr-home-live" id="reports">
          <div className="jwr-shell">
            <Title
              note={
                <span className="live-indicator">
                  <i className={live ? "online" : ""} />
                  {live ? "সরাসরি আপডেট" : "পুনঃসংযোগ হচ্ছে"}
                </span>
              }
            >
              লাইভ রিপোর্ট
            </Title>
            <div className="jwr-home-report-layout">
              <div className="jwr-live">
                <form
                  className="jwr-filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setFilter(draft);
                    setLimit(PAGE);
                  }}
                >
                  <input
                    type="search"
                    aria-label="রিপোর্ট খুঁজুন"
                    placeholder="ঘটনা, স্থান বা কীওয়ার্ড খুঁজুন"
                    value={draft.q}
                    onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                  />
                  <select
                    aria-label="রিপোর্টের ক্যাটাগরি"
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({ ...draft, category: e.target.value })
                    }
                  >
                    <option value="">সব ক্যাটাগরি</option>
                    {[...new Set([...categories, ...Object.keys(summary?.categories || {})])].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <LocationFields
                    value={draft}
                    onChange={(loc) => setDraft({ ...draft, ...loc })}
                    prefix="ফিল্টারের "
                  />
                  <input aria-label="ওয়ার্ডের প্রশাসনিক এলাকা" placeholder="ইউনিয়ন / পৌরসভা / সিটি কর্পোরেশন" value={draft.wardArea ?? ""} onChange={(e) => setDraft({ ...draft, wardArea: e.target.value })} />
                  <input aria-label="ওয়ার্ড নম্বর" placeholder="ওয়ার্ড নম্বর" inputMode="numeric" pattern="[০-৯0-9]{1,3}" value={draft.ward ?? ""} onChange={(e) => setDraft({ ...draft, ward: e.target.value })} />
                  <label className="filter-date">
                    তারিখ থেকে
                    <input
                      aria-label="রিপোর্টের তারিখ থেকে"
                      type="date"
                      value={draft.from}
                      onChange={(e) =>
                        setDraft({ ...draft, from: e.target.value })
                      }
                    />
                  </label>
                  <label className="filter-date">
                    তারিখ পর্যন্ত
                    <input
                      aria-label="রিপোর্টের তারিখ পর্যন্ত"
                      type="date"
                      value={draft.to}
                      min={draft.from}
                      onChange={(e) =>
                        setDraft({ ...draft, to: e.target.value })
                      }
                    />
                  </label>
                  <button type="submit">খুঁজুন</button>
                </form>
                {Object.values(filter).some(Boolean) && (
                  <div className="filter-summary">
                    <span>
                      {bn(shownTotal)}{totalCapped ? "+" : ""}টি রিপোর্ট পাওয়া গেছে{" "}
                      {filter.category && `· ${filter.category}`}
                    </span>
                    <button
                      onClick={() => {
                        setFilter(emptyFilters);
                        setDraft(emptyFilters);
                      }}
                    >
                      ফিল্টার মুছুন ×
                    </button>
                  </div>
                )}
                <div className="jwr-report-grid">
                  {shown.map((r) => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      onOpen={() => {
                        setDetail(r);
                        setShare(false);
                      }}
                    />
                  ))}
                </div>
                {listError && (
                  <p className="error" role="alert">
                    {listError}
                  </p>
                )}
                {!shown.length && (summary !== null) && !listError && (
                  <div className="empty-state">
                    <ShieldAlert size={36} />
                    <h3>কোনো রিপোর্ট পাওয়া যায়নি।</h3>
                    <p>
                      ভিন্ন ক্যাটাগরি বা এলাকা দিয়ে খুঁজুন, অথবা আপনার জানা ঘটনা
                      জানান।
                    </p>
                    <button
                      className="jwr-button"
                      onClick={() => setModal("report")}
                    >
                      ঘটনা রিপোর্ট করুন →
                    </button>
                  </div>
                )}
                {hasMore && (
                  <button
                    className="jwr-load-more"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    আরও রিপোর্ট দেখুন ↓
                  </button>
                )}
              </div>
              <aside className="jwr-division-sidebar">
                <h3>বিভাগভিত্তিক রিপোর্ট</h3>
                {divisionRows.map(([d, n], i) => (
                  <button
                    className="jwr-side-row side-button"
                    key={d}
                    onClick={() => {
                      const f = { ...emptyFilters, division: d };
                      setFilter(f);
                      setDraft(f);
                      setLimit(PAGE);
                    }}
                  >
                    <span>{bn(i + 1).padStart(2, "০")}</span>
                    <span>{d}</span>
                    <b>{bn(n)}</b>
                  </button>
                ))}
                <div className="jwr-sidebar-total">
                  <small>মোট রিপোর্ট</small>
                  <strong>{bn(totalReports)}</strong>
                </div>
              </aside>
            </div>
          </div>
        </section>
        <section className="jwr-home-categories" id="categories">
          <div className="jwr-shell">
            <Title>রিপোর্ট ক্যাটাগরি</Title>
            <div className="jwr-category-grid">
              {categories.map((c, i) => {
                const Icon = icons[c] || ShieldAlert,
                  count = summary?.categories[c] || 0,
                  metrics = summary?.metrics[c] || {},
                  fields = conditionalFields[c] || [];
                return (
                  <button
                    key={c}
                    className={filter.category === c ? "is-active" : ""}
                    onClick={() => categoryFilter(c)}
                  >
                    <Icon className="jwr-cat-icon" strokeWidth={1.4} />
                    <strong>{c}</strong>
                    <span className="jwr-cat-metrics">
                      <span>
                        <em>রিপোর্ট সংখ্যা</em>
                        <b>{bn(count)}</b>
                      </span>
                      {fields
                        .filter((f) => f.type === "number")
                        .slice(0, 2)
                        .map((f) => (
                          <span key={f.key}>
                            <em>{metricLabel(c, f.key)}</em>
                            <b>
                              {bn(metrics[f.key] || 0)}
                            </b>
                          </span>
                        ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        <section className="jwr-home-map" id="map">
          <div className="jwr-shell">
            <Title>মানচিত্রে রিপোর্ট খুঁজুন</Title>
            <ReportMap demo={null} revision={revision} overall={summary} />
          </div>
        </section>
        <section className="jwr-home-data" id="statistics">
          <div className="jwr-shell">
            <Title note="শুধু প্রকাশিত অভিযোগের হিসাব">
              অভিযোগের চিত্র
            </Title>
            <div className="jwr-stats">
              {[
                ["মোট রিপোর্ট", totalReports],
                [
                  "আজকের রিপোর্ট",
                  summary?.today ?? 0,
                ],
                [
                  "রিপোর্ট ক্যাটাগরি",
                  categoryRows.filter((r) => r[1] > 0).length,
                ],
                [
                  "অন্তর্ভুক্ত বিভাগ",
                  divisionRows.filter((r) => r[1] > 0).length,
                ],
              ].map(([label, n]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{bn(Number(n))}</strong>
                </div>
              ))}
            </div>
            <div className="jwr-ranking-pair">
              <Ranking
                title="ক্যাটাগরি অনুযায়ী রিপোর্ট"
                rows={categoryRows.filter((r) => r[1] > 0)}
              />
              <Ranking title="জেলা অনুযায়ী রিপোর্ট" rows={districtRows} />
            </div>
            <div className="jwr-trust">
              <div>
                <strong>পরিচয়বিহীন</strong>
                <span>নাম ছাড়াই রিপোর্ট জমা</span>
              </div>
              <div>
                <strong>{bn(districtRows.length)}</strong>
                <span>অন্তর্ভুক্ত জেলা</span>
              </div>
              <div>
                <strong>২৪/৭</strong>
                <span>রিপোর্ট গ্রহণ</span>
              </div>
            </div>
          </div>
        </section>
        <ReportGuide onReport={() => setModal("report")} />
        <ReportJourney onTrack={() => setModal("track")} />
        <PrivacyExplainer onPrivacy={() => setModal("privacy")} />
        <PublicExpectations onReport={() => setModal("report")} />
        <section className="jwr-home-faq" id="faq">
          <div className="jwr-shell">
            <Title>প্রশ্ন</Title>
            <div className="jwr-faq">
              {faqs.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="jwr-final-cta">
          <h2>
            অন্যায়ের বিরুদ্ধে আপনার
            <br />
            প্রতিবেদনই পরিবর্তনের শুরু।
          </h2>
          <p>
            প্রকাশিত প্রতিবেদনগুলো জনসাধারণের জমা দেওয়া অভিযোগ। এগুলো অপরাধের
            চূড়ান্ত প্রমাণ নয়।
          </p>
          <button className="jwr-button" onClick={() => setModal("report")}>
            ঘটনা রিপোর্ট করুন →
          </button>
        </section>
      </main>
      <footer className="jwr-site-footer">
        <div className="jwr-shell">
          <a className="jwr-brand" href="#content">
            জামাতনামা<i>′</i>
          </a>
          <p>জনস্বার্থমূলক পরিচয়বিহীন রিপোর্টিং প্ল্যাটফর্ম।</p>
          <nav>
            <a href="#reports">রিপোর্ট</a>
            <a href="#categories">ক্যাটাগরি</a>
            <a href="#why">কীভাবে সাহায্য করে</a>
            <a href="#prepare">রিপোর্টের প্রস্তুতি</a>
            <a href="#process">কীভাবে কাজ করে</a>
            <a href="#privacy">গোপনীয়তা</a>
            <a href="#faq">সাহায্য</a>
          </nav>
          <span>© ২০২৬ JAMATNAMA · Map data ODbL</span>
        </div>
      </footer>
      {modal === "report" && (
        <Modal title="ঘটনা রিপোর্ট করুন" onClose={() => setModal(null)} wide>
          <ReportForm />
        </Modal>
      )}
      {modal === "privacy" && (
        <Modal
          title="আপনার নিরাপত্তা ও গোপনীয়তা"
          onClose={() => setModal(null)}
        >
          <div className="prose">
            <p>
              রিপোর্ট জমা দিতে আপনার নাম, ইমেইল, ফোন বা অ্যাকাউন্টের প্রয়োজন
              নেই। অ্যাপের ডেটাবেসে রিপোর্টকারীর IP ঠিকানাও রাখা হয় না।
            </p>
            <p>
              ঘটনার বর্ণনা, শিরোনাম, ছবি, PDF বা অডিওতে নিজের বা ভুক্তভোগীর নাম,
              ঠিকানা, মুখ, নম্বর ও পরিচয় শনাক্তকারী তথ্য রাখবেন না। ছবি পুনরায়
              প্রক্রিয়াজাত করে মেটাডেটা সরানো হয়। অডিওর কণ্ঠ, PDF ও অডিওর
              মেটাডেটা নিজে পরীক্ষা করুন।
            </p>
            <p>
              প্রমাণগুলো শুধু অনুমোদিত পর্যালোচক ডাউনলোড করতে পারেন। সবার সামনে
              এগুলো দেখানো হয় না। প্রকাশের আগে অভিযোগের লেখা থেকে অপ্রয়োজনীয়
              ব্যক্তিগত তথ্য সরানো হয়।
            </p>
            <p>
              সমর্থন বোতাম একই ব্রাউজারকে চিনতে একটি নামবিহীন কুকি ব্যবহার করে।
              কোনো বিজ্ঞাপন বা অ্যানালিটিক্স ট্র্যাকার নেই। হোস্টিং প্রদানকারীর
              নেটওয়ার্ক লগ অ্যাপের নিয়ন্ত্রণের বাইরে থাকতে পারে।
            </p>
            <p>
              তাৎক্ষণিক বিপদে এই সাইটের পর্যালোচনার অপেক্ষা না করে স্থানীয় জরুরি
              সহায়তা নিন।
            </p>
          </div>
        </Modal>
      )}
      {modal === "track" && (
        <Modal title="আপনার রিপোর্টের অবস্থা" onClose={() => setModal(null)}>
          <form className="track-form" onSubmit={track}>
            <p>রিপোর্ট জমা দেওয়ার সময় পাওয়া গোপন কোডটি লিখুন।</p>
            <label>
              গোপন ট্র্যাকিং কোড
              <input
                value={trackCode}
                onChange={(e) => setTrackCode(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <button className="jwr-button" disabled={tracking}>
              {tracking ? "খোঁজা হচ্ছে…" : "অবস্থা দেখুন →"}
            </button>
            {trackError && (
              <p className="error" role="alert">
                {trackError}
              </p>
            )}
            {trackResult && (
              <div className="track-result" role="status">
                <h3>{statusLabels[trackResult.status]}</h3>
                <p>
                  {trackResult.note ||
                    "রিপোর্টের তথ্য পর্যালোচনায় রয়েছে। প্রকাশিত হলে লাইভ তালিকায় দেখা যাবে।"}
                </p>
              </div>
            )}
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title="রিপোর্টের বিস্তারিত" onClose={() => setDetail(null)}>
          <ReportCard report={detail} onOpen={() => { }} detail />
          <div className="report-facts">
            {(conditionalFields[detail.category] || [])
              .filter((f) => detail.facts[f.key])
              .map((f) => (
                <p key={f.key}>
                  <span>{f.label}</span>
                  <strong>
                    {f.type === "number"
                      ? bn(Number(detail.facts[f.key]))
                      : detail.facts[f.key]}{" "}
                    {f.settings.unit}
                  </strong>
                </p>
              ))}
          </div>
          <p className="detail-disclaimer">
            এটি জনসাধারণের জমা দেওয়া অভিযোগ। প্রকাশ অপরাধ প্রমাণ করে না। সংযুক্ত প্রমাণ সর্বসাধারণের জন্য উন্মুক্ত নয়।
          </p>
          <button
            className="jwr-outline-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/?report=${detail.id}`,
                );
                setShare(true);
              } catch {
                setShare(false);
              }
            }}
          >
            {share ? "লিংক কপি হয়েছে ✓" : "রিপোর্টের লিংক কপি করুন ↗"}
          </button>
        </Modal>
      )}
    </div>
  );
}
