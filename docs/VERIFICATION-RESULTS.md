# JAMATNAMA verification results

Date: 2026-11-07. Machine: Windows 11, 8 logical CPUs, Node 24.16. All data was synthetic. **No cloud account was used, nothing was deployed, and no production system was touched.**

## What was real and what was simulated

| Component | In these tests |
|---|---|
| PostgreSQL | **Real** PostgreSQL 17, with `jamatnama_app`, `jamatnama_scanner` and simulated Supabase API roles |
| Next.js | **Real** production build, `NODE_ENV=production`, all security configuration on, 2 to 4 instances |
| Browser | **Real** Chromium for the form and admin flow, on a development server |
| Cloudflare R2 | **Test double** with independent SigV4, expiry, CORS and multipart checks |
| ClamAV | **Test double** speaking the clamd protocol |
| Turnstile | **Test preload** answering siteverify. The app itself has no bypass. |
| Vercel CDN, Supabase pooler, TLS, network | **Not exercised** |

Passing against a double shows our logic is right. It does not show that the provider behaves the same way. The checks that need your accounts are in [DEPLOYMENT.md](DEPLOYMENT.md), section 10.

## Final results

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | **95 of 95 pass** (the original 26 baseline tests ported to async, plus new suites) |
| `npm run build` | Pass. `/` is now static. |
| `npm run verify:e2e` | **18 of 18 pass** on the production build across 2 instances |
| Browser flow | Pass (details below) |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Requirements covered by automated tests

- **Anonymous report flow:** submission with no login, direct and multipart upload, finalization, tracking, moderation, publication, withdrawal, audit attribution.
- **Roles:** moderators get 403 on account management and the audit log, on every instance. Each moderator has their own MFA. Codes cannot be replayed, including across instances and under concurrent attempts.
- **Disabling:** sessions die immediately on every instance. Reactivation does not restore them.
- **Public privacy:** no accused details, notes, hashes, evidence or unpublished reports in public responses. Unsigned object URLs are refused. Supabase API roles get "permission denied" on every table, even connecting directly.
- **Failing uploads:** expired URL, oversized body, smaller body, wrong type, mismatched real format, replay before and after finalize, another intent's file, consumed and expired intents, over budget, including concurrent budget races.
- **Consistency:** a failed moderation change rolls back its audit entry and revision. Retried finalize and moderation produce one report and one audit entry. Concurrent moderators lose no audit entry. The app role cannot alter audit history.
- **Scanner:** fails closed on outage or no verdict. Infected files are destroyed. Image metadata is removed. Workers cannot claim the same file. The scanner role cannot read reports.
- **Logs:** no receipts, tokens, credentials, signed URLs or report content in server logs.

### Migration (synthetic database: 450 reports, 6 evidence files, moderators, audit history)

Dry run wrote nothing. A corrupt source was refused. A run interrupted at 250 reports, then at 2 of 6 files, resumed without duplicates. `--verify --deep` passed, and detected deliberately tampered rows, audit entries and object bytes. Preserved and checked: report IDs, receipt hashes, millisecond timestamps, statuses, relations, moderator passwords and MFA, disabled state, audit IDs, replay state. Old sessions were dropped. **The source database stayed byte-identical (SHA-256 compared).**

### Backup and restore

Encrypted database backup restored into a new database and matched the source table by table. The generated search column rebuilt, sealed MFA secrets opened, and the audit sequence continued. Restore refused a non-empty target, a wrong key and a tampered file, and a failed restore left nothing behind. An evidence object deleted from the primary bucket was restored from the second bucket with a matching checksum.

### Browser check (real Chromium)

Worked: demo mode, hero, 64-district map, 20 categories, report form, real CORS preflights and Content Security Policy against the storage origin, a 40 MB multipart video with live progress, receipt, admin queue with paging counts, quarantine labels, publish, public list, search, stats, map filter.

A report withdrawn with the page open left the list after **11.4 s** with no reload, and the open detail dialog closed (one sample, no CDN).

**Defects this check found, now fixed:** a crash in part-URL signing, caused by the timestamp parser registering twice when a module loads once per route bundle. A regression test covers it.

**Not reproduced:** one reading showed the map's total as 0 while the map showed 1 report, during development hot reload. Three later readings were correct. Watch for it on staging.

## Load test

**Setup:** `scripts/load-test.mjs`. 50,000 synthetic reports (80% published), 4 production instances with 5 database connections each, real PostgreSQL. Each simulated visitor opens the page, loads stats and the list, then repeats an action every 3 to 10 s: mostly revision polling, plus paging, filtering, search, detail views, votes, tracking and file-free report submission. Each stage lasts 60 s after ramp-up; the spikes reach their full count in 5 s.

**Read these numbers carefully:**
- The load generator, app and database all shared one 8-CPU machine, so these are not Vercel or Supabase capacity figures.
- No network latency, TLS, pooler or CDN, except the labelled simulation.
- "Visitors" means simultaneously active visitors with think time. 10,000 *total* visitors spread over a day is far lighter than these stages.
- File upload bytes were not part of the load, because they go straight to R2.

### Origin only: no CDN (worst case for the app servers)

| Concurrent visitors | Requests/s | p50 | p95 | p99 | Errors | 429s | Peak DB connections |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 | 18 | 10 ms | 415 ms* | 763 ms | 0% | 0 | 14 |
| 250 | 47 | 7 ms | 44 ms | 401 ms | 0% | 0 | 13 |
| 500 | 90 | 5 ms | 45 ms | 155 ms | 0% | 0 | 13 |
| 1,000 | 171 | 4 ms | 44 ms | 127 ms | 0% | 72 | 15 |
| 2,000 | 343 | 8 ms | 58 ms | 195 ms | 0% | 46 | 16 |
| 5,000 | 622 | 1.1 s | 8.4 s | 13.3 s | 0% | 0 | 23 |
| **10,000** | 779 | **4.4 s** | **23 s** | **26.7 s** | **4.14%** | 0 | 21 |

\* First stage includes cold starts.

### Traffic spikes

| Spike | Requests/s | p50 | p95 | p99 | Errors | 429s |
|---|---:|---:|---:|---:|---:|---:|
| 0 to 1,500 in 5 s | 287 | 6 ms | 108 ms | 312 ms | 0% | 161 |
| 0 to 5,000 in 5 s | 730 | 898 ms | 8.5 s | 9.5 s | 0% | 41 |

The 1,500 spike's 429s came from the old report-intent ceiling of 300 per 5 minutes, since raised to 1,200. The 429s are controlled refusals with `Retry-After`, not failures.

### With a simulated CDN (2,000 visitors)

The generator honored the app's `Vercel-CDN-Cache-Control` headers. **76.4% of requests never reached the origin.** Steady p95 was 52 ms, spike p95 81 ms, 0% errors. The remaining origin traffic was mostly page loads, which Vercel serves statically, plus writes. This shows the headers work as intended. It is a simulation, not a measurement of Vercel.

### Conclusion and bottlenecks

- **Supported by this evidence:** 2,000 concurrent active visitors on this machine with sub-60 ms p95 and no errors, and a sudden 1,500-visitor spike with 108 ms p95.
- **10,000 simultaneous users is NOT supported by this evidence.** At that level this machine degraded badly: p95 of 23 s and 4.14% client-side failures. **Do not claim this capacity** unless a staging test shows it.
- **First bottleneck: CPU on the shared machine,** starting between 2,000 and 5,000 visitors. The app logged no server errors in any run. The database was not the limit: at most 23 connections, 6 active, and no lock waits. Page requests were the slowest (p50 8.4 s at 5,000) because Node served them here; Vercel serves that static page from its CDN, which should remove this particular load. That is expected, not measured.
- **Slowest query: public statistics,** at about 200 to 700 ms p95 with 40,000 published reports when uncached. The CDN and a 2 s memo mean it should run rarely in production, but uncached map filters on a small database are the first place to watch. If it becomes a problem, add summary tables.
- **Global limits are real ceilings:** the report-intent limit is 1,200 per 5 minutes, tracking 1,800 per minute, and votes 3,000 per minute. Tune them in `lib/abuse.ts` after watching real traffic.
- **On Supabase, expect the pooler and compute size to matter sooner** than they did on this local database. Measure on staging.

## Remaining limitations

**Must be checked on your accounts:**
- Live connectivity and behavior of R2, Supabase, Vercel CDN, Turnstile and ClamAV (checklist in DEPLOYMENT.md, section 10).
- Whether R2 honors a signed `If-None-Match`, and whether copying a 2 GB multipart object finishes inside the 60 s finalize limit. If it does not, large uploads will fail at finalize.
- Bangla trigram index behavior under Supabase's locale. Search results stay correct either way, but may be slower.
- The scanner's Docker files, which were not run because Docker was unavailable.
- The free-plan path in FREE-START.md, which was not run on any live account.
- Phone browsers and the real Turnstile widget.

**Known design limits:**
- Malware scanning needs a separate always-on host. Without it, evidence stays locked in quarantine. **Scanning reduces risk but cannot catch everything,** so reviewers should still open files carefully.
- Video and non-MP3 audio are checked by file signature and malware scan only, not fully parsed. Metadata in PDF, audio and video files is not removed. Only images are rewritten.
- Upload progress does not survive a page reload. Parts retry automatically, but closing the tab means starting that submission again.
- App-level limits are per browser cookie plus global, with no IP data stored, by design. Per-IP protection depends on the Vercel Firewall rules in the guide.
- Public evidence links are not supported, by design.
- There is no reverse migration from PostgreSQL to SQLite.
- `MFA_ENCRYPTION_KEY` must not be lost. Without it, every moderator must be re-enrolled.
- Static help text on the site states the default upload limits. If you lower them, as on the free plan, update that text.

## Rollback in short

- **App problem:** Vercel → Deployments → Instant Rollback.
- **Migration problem before reopening:** switch traffic back to the old server. The SQLite database was never changed.
- **After new reports arrive on PostgreSQL:** back up first, because rolling back drops those reports from view. There is no automated way back.

Full steps: [DEPLOYMENT.md](DEPLOYMENT.md), section 9.
