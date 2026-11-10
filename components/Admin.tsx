"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import TeamPanel from "./TeamPanel";
import BotCheck from "./BotCheck";
import type { AccusedPerson, Report } from "@/lib/shared";
import { bn, conditionalFields, date, statusLabels } from "@/lib/shared";
type PrivateReport = Report & {
  updatedAt: string;
  reviewNote: string;
  accused: AccusedPerson[];
  sourceLinks: string[];
  reviewFlags: string[];
};
type Evidence = { id: string; report_id: string; mime: string; size_bytes: number; state: string };
const evidenceStates: Record<string, string> = {
  pending_scan: "নিরাপত্তা পরীক্ষা চলছে; এখনও খোলা যাবে না",
  infected: "ক্ষতিকর উপাদান পাওয়া গেছে; ফাইলটি সরানো হয়েছে",
  rejected: "যাচাইয়ে বাতিল",
  scan_error: "নিরাপত্তা পরীক্ষা সম্পন্ন হয়নি; খোলা যাবে না",
};
const evidenceLabel = (mime: string) =>
  mime === "application/pdf" ? "PDF" : mime.startsWith("audio/") ? "অডিও" : mime.startsWith("video/") ? "ভিডিও" : "ছবি";
const PAGE_SIZE = 25;
function Review({
  report: r,
  evidence,
  onSaved,
}: {
  report: PrivateReport;
  evidence: Evidence[];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(r.title),
    [description, setDescription] = useState(r.description),
    [ward, setWard] = useState(r.ward || ""),
    [wardArea, setWardArea] = useState(r.wardArea || ""),
    [note, setNote] = useState(r.reviewNote || ""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(status: Report["status"]) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/reports/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, title, description, note, reviewed, ward, wardArea, expectedUpdatedAt: r.updatedAt }),
        }),
        d = await res.json();
      if (!res.ok) throw Error(d.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="admin-report">
      <header>
        <span>{statusLabels[r.status]}</span>
        <b>{r.category}</b>
        <small>
          {r.ward && <>{r.wardArea}, ওয়ার্ড {bn(Number(r.ward))} · </>}{r.upazila}, {r.district} · {date(r.incidentDate)}
        </small>
        <small>জমা: {date(r.createdAt)}</small>
      </header>
      <label>
        প্রকাশযোগ্য শিরোনাম
        <input
          value={title}
          maxLength={180}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        প্রকাশযোগ্য বিবরণ
        <textarea
          rows={5}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label>ওয়ার্ডের প্রশাসনিক এলাকা<input value={wardArea} maxLength={100} onChange={(e) => setWardArea(e.target.value)} /></label>
      <label>ওয়ার্ড নম্বর<input value={ward} inputMode="numeric" maxLength={3} onChange={(e) => setWard(e.target.value)} /></label>
      {r.accused.length > 0 && (
        <section className="admin-accused">
          <h3>অভিযুক্ত ব্যক্তি বা ব্যক্তিবর্গের তথ্য</h3>
          <p className="muted">
            শুধু পর্যালোচকের জন্য; এই আলাদা তথ্য জনসাধারণের তালিকায় প্রকাশিত হয়
            না।
          </p>
          {r.accused.map((person, i) => (
            <div key={i}>
              <strong>
                {bn(i + 1)}. {person.name || "নাম জানা নেই"}
              </strong>
              {person.information && <p>{person.information}</p>}
            </div>
          ))}
        </section>
      )}
      {r.reviewFlags?.length > 0 && (
        <section className="admin-accused">
          <h3>স্বয়ংক্রিয় পর্যালোচনার সংকেত</h3>
          <p>এগুলো সম্ভাব্য সমস্যার সংকেত; সত্যতা বা অপরাধের সিদ্ধান্ত নয়।</p>
          <ul>
            {r.reviewFlags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="admin-facts">
        {(conditionalFields[r.category] || [])
          .filter((f) => r.facts[f.key])
          .map((f) => (
            <p key={f.key}>
              <span>{f.label}</span>
              <b>
                {r.facts[f.key]} {f.settings.unit}
              </b>
            </p>
          ))}
      </div>
      <p className="muted">
        প্রমাণ: {bn(evidence.length)}টি ফাইল · শুধু পর্যালোচকের জন্য
      </p>
      {evidence.map((f, i) =>
        f.state === "clean" ? (
          <a
            key={f.id}
            className="evidence-link"
            href={`/api/admin/evidence/${f.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            প্রমাণ {bn(i + 1)} খুলুন ↗ ({evidenceLabel(f.mime)})
          </a>
        ) : (
          <p key={f.id} className="muted">
            প্রমাণ {bn(i + 1)} ({evidenceLabel(f.mime)}): {evidenceStates[f.state] || f.state}
          </p>
        ),
      )}
      {r.sourceLinks?.length > 0 && (
        <section className="admin-accused">
          <h3>সংবাদসূত্র · শুধু পর্যালোচকের জন্য</h3>
          {r.sourceLinks.map((url, i) => (
            <p key={i}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                style={{ overflowWrap: "anywhere" }}
              >
                {url} ↗
              </a>
            </p>
          ))}
        </section>
      )}
      <label>
        রিপোর্টকারীর জন্য পর্যালোচনার মন্তব্য
        <textarea
          value={note}
          rows={2}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="এই মন্তব্য গোপন ট্র্যাকিং কোড দিয়ে দেখা যাবে"
        />
      </label>
      <label className="admin-review-check">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        আমি ঘটনার তথ্য ও প্রমাণ পর্যালোচনা করেছি, এবং প্রকাশযোগ্য লেখা থেকে
        রিপোর্টকারী ও ভুক্তভোগীর অপ্রয়োজনীয় ব্যক্তিগত পরিচয় সরিয়েছি।
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        <button
          className="jwr-button"
          disabled={busy || !reviewed}
          onClick={() => void save("published")}
        >
          {busy ? "সংরক্ষণ হচ্ছে…" : "অনুমোদন ও প্রকাশ →"}
        </button>
        <button
          className="reject"
          disabled={busy}
          onClick={() => void save("rejected")}
        >
          প্রকাশ করবেন না
        </button>
        {r.status !== "pending" && (
          <button
            className="jwr-outline-button"
            disabled={busy}
            onClick={() => void save("pending")}
          >
            আবার পর্যালোচনায় নিন
          </button>
        )}
      </div>
    </article>
  );
}
export default function Admin() {
  const [username,setUsername]=useState("superadmin");
  const [role,setRole]=useState("");
  const [siteKey, setSiteKey] = useState(""),
    [botToken, setBotToken] = useState(""),
    [botReset, setBotReset] = useState(0),
    [code, setCode] = useState(""),
    [twoFactor, setTwoFactor] = useState(false);
  const [auth, setAuth] = useState<boolean | null>(null),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<PrivateReport[]>([]),
    [evidence, setEvidence] = useState<Evidence[]>([]),
    [tab, setTab] = useState<Report["status"]>("pending"),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [nextCursor, setNextCursor] = useState<string | null>(null);
  const loaded = useRef(PAGE_SIZE);
  // Refreshes keep every loaded row current without discarding a reviewer's unsaved edits.
  const load = useCallback(async (status: Report["status"]) => {
    try {
      const res = await fetch(`/api/admin/reports?status=${status}&limit=${Math.min(100, loaded.current)}`, { cache: "no-store" });
      if (res.status === 401) {
        setAuth(false);
        return;
      }
      const d = await res.json();
      if (!res.ok) throw Error(d.error);
      setError("");
      setRows(d.reports);
      setEvidence(d.evidence);
      setCounts(d.counts);
      setNextCursor(d.nextCursor);
    } catch {
      setError("রিপোর্ট তালিকা লোড করা যায়নি।");
    }
  }, []);
  async function loadMore() {
    if (!nextCursor) return;
    try {
      const res = await fetch(`/api/admin/reports?status=${tab}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw Error(d.error);
      setRows((current) => [...current, ...d.reports.filter((x: PrivateReport) => !current.some((row) => row.id === x.id))]);
      setEvidence((current) => [...current, ...d.evidence.filter((x: Evidence) => !current.some((row) => row.id === x.id))]);
      setNextCursor(d.nextCursor);
      loaded.current += PAGE_SIZE;
    } catch {
      setError("রিপোর্ট তালিকা লোড করা যায়নি।");
    }
  }
  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAuth(d.authenticated);
        setRole(d.actor?.role || "");
        setConfigured(d.configured);
        setSiteKey(d.siteKey || "");
        setTwoFactor(d.twoFactor === true);
      })
      .catch(() => {
        setAuth(false);
        setError("সংযোগ পাওয়া যায়নি।");
      });
  }, []);
  useEffect(() => {
    if (!auth) return;
    loaded.current = PAGE_SIZE;
    void load(tab);
    const timer = setInterval(() => void load(tab), 15000);
    return () => clearInterval(timer);
  }, [auth, load, tab]);
  async function login(e: React.SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code, botToken, username }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setPassword("");
      setCode("");
      setAuth(true);
      setRole(d.actor?.role || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লগইন করা যায়নি।");
      setBotToken("");
      setBotReset((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-page">
      <header className="admin-header">
        <a href="/" className="jwr-brand">
          জামাতনামা<i>′</i>
        </a>
        <span>অভিযোগ পর্যালোচনা</span>
        {auth && (
          <button
            className="jwr-outline-button"
            onClick={async () => {
              await fetch("/api/admin/session", { method: "DELETE" });
              setAuth(false);
              setRows([]);
              setEvidence([]);
            }}
          >
            লগআউট
          </button>
        )}
      </header>
      <div className="admin-shell">
        {auth && role === "superadmin" && <TeamPanel/>}
        {auth === null ? (
          <p>লোড হচ্ছে…</p>
        ) : !auth ? (
          <form onSubmit={login} className="admin-login">
            <h1>পর্যালোচক লগইন</h1>
                <label>
                  Username
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <p className="muted">শুধু অনুমোদিত পর্যালোচকদের জন্য।</p>
                <label>
                  পাসওয়ার্ড
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                {(twoFactor || username.trim().toLowerCase() !== "superadmin") && (
                  <label>
                    অথেনটিকেটর কোড
                    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
                  </label>
                )}
                <BotCheck siteKey={siteKey} action="admin-login" resetKey={botReset} onToken={setBotToken} />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="jwr-button"
                  disabled={busy}
                >
                  {busy ? "যাচাই হচ্ছে…" : "লগইন করুন →"}
                </button>
          </form>
        ) : (
          <>
            <div className="admin-note">
              অভিযোগ প্রকাশের আগে তথ্য ও প্রমাণ যাচাই করুন। ব্যক্তিগত পরিচয়
              সরান। প্রকাশ কোনো ব্যক্তির অপরাধ প্রমাণ করে না। প্রমাণের ফাইল
              জনসাধারণের জন্য প্রকাশ করা হয় না।
            </div>
            <div className="admin-tabs">
              {(["pending", "published", "rejected"] as const).map((s) => (
                <button
                  key={s}
                  className={tab === s ? "active" : ""}
                  onClick={() => setTab(s)}
                >
                  {statusLabels[s]} ·{" "}
                  {bn(counts[s] || 0)}
                </button>
              ))}
              <button onClick={() => void load(tab)}>তালিকা আপডেট ↻</button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {rows.length ? (
              <>
                {rows.map((r) => (
                  <Review
                    key={`${r.id}-${r.status}`}
                    report={r}
                    evidence={evidence.filter((f) => f.report_id === r.id)}
                    onSaved={() => void load(tab)}
                  />
                ))}
                {nextCursor && (
                  <button className="jwr-outline-button" onClick={() => void loadMore()}>
                    আরও রিপোর্ট দেখুন ↓
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state">
                <h2>এই তালিকায় কোনো রিপোর্ট নেই।</h2>
                <p>নতুন রিপোর্ট জমা হলে এখানে দেখা যাবে।</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
