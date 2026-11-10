"use client";
import { useEffect, useState } from "react";
import { bn, statsFromReports, type PublicStats, type Report } from "@/lib/shared";
import LocationFields from "./LocationFields";
import { categories } from "@/lib/shared";
type Shape = { name: string; division: string; path: string };
const normalized = (s: string) =>
  s.normalize("NFC").replace(/য়/g, "য়").replace(/ড়/g, "ড়").replace(/ু/g, "ু");
export default function ReportMap({
  demo,
  revision,
  overall,
}: {
  demo: Report[] | null;
  revision: number | null;
  overall: PublicStats | null;
}) {
  const [shapes, setShapes] = useState<Shape[]>([]),
    [error, setError] = useState(false),
    [zoom, setZoom] = useState(1),
    [selection, setSelection] = useState("");
  const [loc, setLoc] = useState({ division: "", district: "", upazila: "" }),
    [category, setCategory] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  useEffect(() => {
    fetch("/data/map-paths.json")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setShapes)
      .catch(() => setError(true));
  }, []);
  const [remote, setRemote] = useState<PublicStats | null>(null);
  const filtering = Boolean(loc.division || loc.district || loc.upazila || category || from || to);
  // Aggregates come from the server; the unfiltered map reuses the page's existing statistics.
  useEffect(() => {
    if (demo || !filtering || revision === null) {
      setRemote(null);
      return;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...loc, category, from, to })) if (value) params.set(key, value);
    params.set("rev", String(revision));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/stats?${params}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setRemote(d.stats))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [demo, filtering, revision, loc, category, from, to]);
  const demoRows = demo?.filter(
    (r) =>
      (!loc.division || r.division === loc.division) &&
      (!loc.district || r.district === loc.district) &&
      (!loc.upazila || r.upazila === loc.upazila) &&
      (!category || r.category === category) &&
      (!from || r.incidentDate >= from) &&
      (!to || r.incidentDate <= to),
  );
  const current = demoRows ? statsFromReports(demoRows) : filtering ? remote : overall;
  const counts: Record<string, number> = {};
  for (const [district, n] of Object.entries(current?.districts || {})) {
    const k = normalized(district);
    counts[k] = (counts[k] || 0) + n;
  }
  const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    max = Math.max(1, ...Object.values(counts));
  function pick(s: Shape) {
    setSelection(s.name);
    setLoc({ division: s.division, district: s.name, upazila: "" });
  }
  return (
    <div className="jwr-map">
      <div className="jwr-map-canvas">
        <div className="map-controls">
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
            aria-label="মানচিত্র বড় করুন"
          >
            +
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
            aria-label="মানচিত্র ছোট করুন"
          >
            −
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setSelection("");
              setLoc({ division: "", district: "", upazila: "" });
            }}
            aria-label="মানচিত্র রিসেট করুন"
          >
            ↺
          </button>
        </div>
        {error ? (
          <p>মানচিত্র লোড করা যায়নি। পাশের এলাকা নির্বাচন ব্যবহার করুন।</p>
        ) : (
          <svg
            className="bangladesh-map"
            viewBox="0 0 470 625"
            role="group"
            aria-label="বাংলাদেশের জেলা-ভিত্তিক রিপোর্ট মানচিত্র"
          >
            <g
              transform={`translate(${235 * (1 - zoom)},${312 * (1 - zoom)}) scale(${zoom})`}
            >
              {shapes.map((s, i) => {
                const n = counts[normalized(s.name)] || 0;
                return (
                  <path
                    key={`${s.name}-${i}`}
                    d={s.path}
                    fill={
                      n
                        ? `rgba(213,87,82,${0.3 + (0.65 * n) / max})`
                        : "#f0dfd9"
                    }
                    stroke={selection === s.name ? "#11110e" : "#c8a49a"}
                    strokeWidth={selection === s.name ? 2 : 0.5}
                    role="button"
                    tabIndex={0}
                    aria-label={`${s.name}, ${bn(n)}টি রিপোর্ট`}
                    onClick={() => pick(s)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pick(s);
                      }
                    }}
                  >
                    <title>
                      {s.name} · {bn(n)}টি রিপোর্ট
                    </title>
                  </path>
                );
              })}
            </g>
          </svg>
        )}
        <div className="map-caption">
          {selection
            ? `${selection} · ${bn(counts[normalized(selection)] || 0)}টি রিপোর্ট`
            : "জেলায় ক্লিক করে রিপোর্টের সংখ্যা দেখুন"}
        </div>
        <div className="jwr-map-legend">
          <span>রিপোর্ট সংখ্যা (কম–বেশি)</span>
          <i />
        </div>
        <small className="map-attribution">
          বাংলাদেশ · সীমানা নির্দেশক · ODbL
        </small>
      </div>
      <aside>
        <form
          className="jwr-map-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setSelection(loc.district);
          }}
        >
          <LocationFields value={loc} onChange={setLoc} prefix="মানচিত্রের " />
          <select
            aria-label="মানচিত্রের ক্যাটাগরি"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">সব ক্যাটাগরি</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="date-pair">
            <label>
              তারিখ থেকে
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              তারিখ পর্যন্ত
              <input
                type="date"
                min={from}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button className="jwr-button">মানচিত্রে দেখুন →</button>
        </form>
        <h3>সর্বাধিক রিপোর্টকৃত এলাকা</h3>
        {ranked.length ? (
          ranked.map(([name, n]) => (
            <div className="map-rank" key={name}>
              <span>{name}</span>
              <i style={{ width: `${(100 * n) / max}px` }} />
              <b>{bn(n)}</b>
            </div>
          ))
        ) : (
          <p className="muted">এই এলাকায় কোনো প্রকাশিত রিপোর্ট নেই।</p>
        )}
        <p className="muted">
          মোট {bn(current?.total ?? 0)}টি{" "}
          {demo ? "নমুনা" : "প্রকাশিত"} রিপোর্ট
        </p>
      </aside>
    </div>
  );
}
