"use client";
import { useEffect, useState, useRef } from "react";
import { bn, categories, conditionalFields, today } from "@/lib/shared";
import { ACCEPT_ATTRIBUTE, DEFAULT_LIMITS, MIME_TYPES, canonicalMime, type UploadLimits } from "@/lib/filetypes";
import { postJson, uploadEvidence } from "@/lib/upload-client";
import BotCheck from "./BotCheck";
import LocationFields from "./LocationFields";
import LocationPreview from "./LocationPreview";
const megabytes = (bytes: number) => bn(Math.round(bytes / (1024 * 1024)));
export default function ReportForm() {
  const [category, setCategory] = useState(""),
    [loc, setLoc] = useState({ division: "", district: "", upazila: "" });
  const [challenge, setChallenge] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [progress, setProgress] = useState<number | null>(null),
    [limits, setLimits] = useState<UploadLimits>(DEFAULT_LIMITS),
    [uploadsOpen, setUploadsOpen] = useState(true),
    [receipt, setReceipt] = useState(""),
    [copied, setCopied] = useState(false);
  const [siteKey, setSiteKey] = useState(""),
    [botToken, setBotToken] = useState(""),
    [botReset, setBotReset] = useState(0);
  const [accusedRows, setAccusedRows] = useState([0]);
  const nextAccusedId = useRef(1);
  useEffect(() => {
    let active = true;
    fetch("/api/challenge", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setChallenge(d.challenge || "");
          setSiteKey(d.siteKey || "");
          if (d.upload) {
            setLimits(d.upload);
            setUploadsOpen(d.upload.enabled !== false);
          }
          if (d.error) setError(d.error);
        }
      })
      .catch(() => {
        if (active) setError("সংযোগ পাওয়া যায়নি। আবার খুলুন।");
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget),
      facts: Record<string, string> = {};
    for (const field of conditionalFields[category] || []) {
      const v = String(form.get(`fact_${field.key}`) || "");
      if (v) facts[field.key] = v;
      form.delete(`fact_${field.key}`);
    }
    const accused = accusedRows
      .map((id) => {
        const name = String(form.get(`accused_name_${id}`) || "").trim();
        const information = String(
          form.get(`accused_information_${id}`) || "",
        ).trim();
        form.delete(`accused_name_${id}`);
        form.delete(`accused_information_${id}`);
        return { name, information };
      })
      .filter((person) => person.name || person.information);
    const report = {
      category: form.get("category"),
      title: form.get("title"),
      description: form.get("description"),
      division: form.get("division"),
      district: form.get("district"),
      upazila: form.get("upazila"),
      ward: form.get("ward") ?? "",
      wardArea: form.get("wardArea") ?? "",
      incidentDate: form.get("incidentDate"),
      declaration: form.get("declaration"),
      facts,
      accused,
      sourceLinks: String(form.get("sourceLinks") || "")
        .split(/\r?\n/)
        .map((link) => link.trim())
        .filter(Boolean),
    };
    const files = form
      .getAll("evidence")
      .filter((x): x is File => x instanceof File && x.size > 0);
    const leaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leaving);
    try {
      setStage("যাচাই করা হচ্ছে…");
      const res = await fetch("/api/uploads/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challenge,
            botToken,
            website: form.get("website"),
            report,
            files: files.map((file) => ({
              mime: canonicalMime(file.type, file.name) || file.type,
              size: file.size,
            })),
          }),
        }),
        intent = await res.json();
      if (!res.ok) throw new Error(intent.error);
      let fileIds: string[] = [];
      if (files.length) {
        setStage("প্রমাণ আপলোড হচ্ছে…");
        setProgress(0);
        fileIds = await uploadEvidence(intent.token, intent.files, files, setProgress);
      }
      setStage("রিপোর্ট জমা হচ্ছে…");
      setProgress(null);
      // Safe to repeat: the same intent always returns the same report and receipt.
      const d = await postJson("/api/reports", { token: intent.token, report, fileIds });
      setReceipt(d.receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "জমা দেওয়া যায়নি।");
      setBotToken("");
      setBotReset((value) => value + 1);
      setChallenge("");
      try {
        const response = await fetch("/api/challenge", { cache: "no-store" });
        const fresh = await response.json();
        setChallenge(fresh.challenge || "");
        setSiteKey(fresh.siteKey || "");
      } catch {}
    } finally {
      window.removeEventListener("beforeunload", leaving);
      setStage("");
      setProgress(null);
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <div className="submission-success" role="status">
        <span className="success-symbol">✓</span>
        <h3>আপনার রিপোর্ট জমা হয়েছে।</h3>
        <p>রিপোর্টটি পর্যালোচনাধীন। প্রকাশের পর লাইভ তালিকায় দেখা যাবে।</p>
        <label>
          আপনার গোপন ট্র্যাকিং কোড
          <input readOnly value={receipt} onFocus={(e) => e.target.select()} />
        </label>
        <button
          className="jwr-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(receipt);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "কপি হয়েছে ✓" : "কোড কপি করুন"}
        </button>
        <p className="muted">
          এই কোড সংরক্ষণ করুন। পরিচয় সংগ্রহ করা হয় না বলে কোড হারালে উদ্ধার করা
          সম্ভব নয়।
        </p>
      </div>
    );
  return (
    <form className="report-composer" onSubmit={submit} aria-busy={busy}>
      <div className="report-compose-layout">
        <div className="jwr-form">
          <div className="form-privacy">
            ◇ রিপোর্টকারীর নাম, ফোন নম্বর বা ইমেইল দিতে হবে না। নিজের বা
            ভুক্তভোগীর পরিচয় বিস্তারিত লেখায় যুক্ত করবেন না।
          </div>
          <div className="jwr-grid">
            <label>
              রিপোর্ট ক্যাটাগরি
              <select
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                <option value="">ক্যাটাগরি নির্বাচন করুন</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              ঘটনার শিরোনাম (অতিরিক্ত)
              <input
                name="title"
                maxLength={180}
                placeholder="কী ঘটেছে, সংক্ষেপে লিখুন (অতিরিক্ত)"
              />
            </label>
            <LocationFields
              value={loc}
              onChange={setLoc}
              required={true}
              requiredUpazila={false}
              showLabels={true}
              prefix="রিপোর্টের "
            />
            <label>
              ইউনিয়ন, পৌরসভা বা সিটি কর্পোরেশন (অতিরিক্ত)
              <input name="wardArea" maxLength={100} placeholder="শুধু প্রশাসনিক এলাকার নাম" />
            </label>
            <label>
              ওয়ার্ড নম্বর (অতিরিক্ত)
              <input name="ward" inputMode="numeric" pattern="[০-৯0-9]{1,3}" maxLength={3} placeholder="যেমন ৫" />
            </label>
            <label>
              ঘটনার তারিখ
              <input
                type="date"
                name="incidentDate"
                required
                max={today()}
                min="1900-01-01"
              />
            </label>
            <label>
              প্রমাণ সংযুক্ত করুন (অতিরিক্ত)
              <input
                type="file"
                name="evidence"
                accept={ACCEPT_ATTRIBUTE}
                multiple
                disabled={!uploadsOpen}
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  setError("");
                  const mimes = files.map((f) => canonicalMime(f.type, f.name));
                  let problem = "";
                  if (files.length > limits.maxFiles) problem = `সর্বোচ্চ ${bn(limits.maxFiles)}টি ফাইল দিন।`;
                  else if (mimes.some((m) => !m)) problem = "শুধু JPG, PNG, WebP, PDF, MP3, WAV, M4A, OGG, MP4, MOV, WebM বা 3GP দিন।";
                  else if (files.some((f, i) => f.size > limits.maxBytes[MIME_TYPES[mimes[i]!].kind])) problem = "একটি ফাইল অনুমোদিত আকারের চেয়ে বড়।";
                  else if (files.reduce((n, f) => n + f.size, 0) > limits.maxTotalBytes) problem = "ফাইলগুলোর মোট আকার অনুমোদিত সীমার বেশি।";
                  if (problem) {
                    setError(problem);
                    e.target.value = "";
                  }
                }}
              />
              <small>
                {uploadsOpen
                  ? <>সর্বোচ্চ {bn(limits.maxFiles)}টি ফাইল। ছবি {megabytes(limits.maxBytes.image)} MB, PDF {megabytes(limits.maxBytes.document)} MB, অডিও {megabytes(limits.maxBytes.audio)} MB, ভিডিও {megabytes(limits.maxBytes.video)} MB পর্যন্ত। প্রমাণ শুধু পর্যালোচক দেখতে পারবেন।</>
                  : "ফাইল আপলোড সাময়িকভাবে বন্ধ। ফাইল ছাড়া রিপোর্ট জমা দিতে পারেন।"}
              </small>
            </label>
            <label className="report-source-links">
              সংবাদপত্র বা সংবাদ প্রতিবেদনের লিংক (অতিরিক্ত)
              <textarea
                name="sourceLinks"
                rows={3}
                maxLength={10004}
                placeholder="https://… — প্রতি লাইনে একটি, সর্বোচ্চ ৫টি লিংক"
              />
              <small>
                শুধু পর্যালোচক দেখবেন। অডিওর কণ্ঠ ও ফাইলের তথ্যে পরিচয় থাকতে
                পারে; জমা দেওয়ার আগে যাচাই করুন।
              </small>
            </label>
            {(conditionalFields[category] || []).map((f) => (
              <label key={`${category}-${f.key}`}>
                {f.label} (অতিরিক্ত)
                <input
                  name={`fact_${f.key}`}
                  type={f.type === "number" ? "number" : "text"}
                  min={0}
                  max={f.type === "number" ? 1e12 : undefined}
                  step="0.01"
                  maxLength={180}
                />
                <small>{f.settings.unit}</small>
              </label>
            ))}
          </div>
          <fieldset className="accused-section">
            <legend>দোষী ব্যক্তি বা ব্যক্তিবর্গ (অতিরিক্ত)</legend>
            <p className="accused-helper">
              নাম জানা থাকলে লিখুন। পদবি, সংগঠনের সঙ্গে সম্পর্ক ও ঘটনায়
              সংশ্লিষ্টতার তথ্য দিন। এই অংশ শুধু পর্যালোচক দেখতে পারবেন।
            </p>
            {accusedRows.map((id, index) => (
              <div className="accused-person" key={id}>
                <div className="accused-person-heading">
                  <span>দোষী {bn(index + 1)}</span>
                  {accusedRows.length > 1 && (
                    <button
                      type="button"
                      className="accused-remove"
                      aria-label={`দোষী ${bn(index + 1)} সরান`}
                      onClick={() =>
                        setAccusedRows((rows) =>
                          rows.filter((row) => row !== id),
                        )
                      }
                    >
                      সরান ×
                    </button>
                  )}
                </div>
                <label>
                  দোষীর নাম {bn(index + 1)}
                  <input
                    name={`accused_name_${id}`}
                    maxLength={120}
                    placeholder="নাম বা পরিচিত নাম (জানা থাকলে)"
                    autoComplete="off"
                  />
                </label>
                <label>
                  দোষীর প্রাসঙ্গিক তথ্য {bn(index + 1)}
                  <textarea
                    name={`accused_information_${id}`}
                    maxLength={2000}
                    rows={3}
                    placeholder="পদবি, সংগঠন, ঘটনায় ভূমিকা ও শনাক্ত করার প্রাসঙ্গিক তথ্য"
                  />
                </label>
              </div>
            ))}
            <button
              type="button"
              className="accused-add"
              disabled={accusedRows.length >= 10}
              onClick={() => {
                const id = nextAccusedId.current++;
                setAccusedRows((rows) => [...rows, id]);
              }}
            >
              ＋ আরও একজন যোগ করুন
            </button>
            <small>
              নাম জানা না থাকলে তথ্য দিয়েও রিপোর্ট করা যাবে। সর্বোচ্চ ১০ জন।
            </small>
          </fieldset>
          <label>
            ঘটনার বিস্তারিত (অতিরিক্ত)
            <textarea
              name="description"
              maxLength={5000}
              rows={6}
              placeholder="ঘটনার সময়, স্থান, কী ঘটেছে এবং বিবরণ লিখুন (অতিরিক্ত)। অপ্রয়োজনীয় ব্যক্তিগত পরিচয় লিখবেন না।"
            />
          </label>
          <div className="jwr-hp" aria-hidden="true">
            <BotCheck
              siteKey={siteKey}
              action="report"
              resetKey={botReset}
              onToken={setBotToken}
            />
            <label>
              ওয়েবসাইট
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <label className="jwr-consent">
            <input type="checkbox" name="declaration" value="1" required />
            আমি নিশ্চিত করছি যে দেওয়া তথ্য আমার জানা অনুযায়ী সঠিক এবং এতে
            অপ্রয়োজনীয় ব্যক্তিগত তথ্য নেই।
          </label>
        </div>
        <LocationPreview location={loc} />
      </div>
      <div className="report-submit-footer">
        {stage && (
          <p className="muted" role="status">
            {stage}
            {progress !== null && <> {bn(Math.round(progress * 100))}%</>}
            {progress !== null && <progress value={progress} max={1} style={{ display: "block", width: "100%" }} />}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="report-submit-row">
          <p className="form-footnote">
            অভিযোগ জমা দেওয়া অপরাধ প্রমাণ করে না।
            <br />
            প্রকাশের আগে তথ্য পর্যালোচনা করা হবে।
          </p>
          <button
            type="submit"
            className="jwr-button"
            disabled={busy || !challenge || (!!siteKey && !botToken)}
          >
            {busy ? stage || "জমা হচ্ছে…" : "রিপোর্ট জমা দিন →"}
          </button>
        </div>
      </div>
    </form>
  );
}
