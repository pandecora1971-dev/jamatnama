"use client";
import { useState } from "react";
import { bn, date, displayDescription, displayTitle, placeLine, type Report } from "@/lib/shared";
export default function ReportCard({
  report: r,
  onOpen,
  detail = false,
}: {
  report: Report;
  onOpen: () => void;
  detail?: boolean;
}) {
  const [supported, setSupported] = useState(false),
    [count, setCount] = useState<number | null>(null),
    [error, setError] = useState("");
  const title = displayTitle(r),
    description = displayDescription(r);
  async function support() {
    if (r.demo) {
      setError("এটি নমুনা। বাস্তব প্রকাশিত রিপোর্টে সমর্থন দেওয়া যাবে।");
      return;
    }
    try {
      const res = await fetch(`/api/reports/${r.id}/support`, {
          method: "POST",
        }),
        d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setCount(d.supports);
      setSupported(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পরে চেষ্টা করুন।");
    }
  }
  return (
    <article className={`jwr-card ${detail ? "detail-card" : ""}`}>
      <div className="card-top">
        <span className="jwr-badge">{r.category}</span>
        <small>{r.demo ? "নমুনা" : "নাগরিক অভিযোগ"}</small>
      </div>
      <h3>
        <button className="jwr-card-title" onClick={onOpen}>
          {title}
        </button>
      </h3>
      {description && <p className={detail ? "full-description" : "jwr-card-excerpt"}>{description}</p>}
      {!detail && (
        <button className="jwr-read-more" onClick={onOpen}>
          বিস্তারিত পড়ুন →
        </button>
      )}
      <button
        className={`support-button ${supported ? "supported" : ""}`}
        onClick={support}
        disabled={supported}
        aria-label={`${title} রিপোর্টে সমর্থন দিন`}
      >
        {supported ? "✓ সমর্থন দিয়েছেন" : "△ এই রিপোর্টে সমর্থন দিন"}
        <b>{bn(count ?? r.supports)}</b>
      </button>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      <footer>
        <span>
          {[placeLine(r), r.division, date(r.incidentDate)].filter(Boolean).join(" · ")}
        </span>
        <span className="status-badge">{r.demo ? "নমুনা" : "প্রকাশিত"}</span>
      </footer>
    </article>
  );
}
