# JAMATNAMA production deployment guide

Target: **Vercel Pro + Supabase Pro PostgreSQL + private Cloudflare R2**.

Starting on free plans first? Read [FREE-START.md](FREE-START.md) as well. Test results and known limits are in [VERIFICATION-RESULTS.md](VERIFICATION-RESULTS.md).

Nothing here has been run against your cloud accounts. Do the whole guide on a **staging** Supabase project, R2 bucket and Vercel preview first, pass section 10, and only then repeat it for production. Never put secret values in chat, in Git or in screenshots.

## 1. How it fits together

```
Browser ── page and JS (static, CDN) ─────────────► Vercel
   │ ─ /api/revision, /api/reports, /api/stats ───► Vercel CDN ─ cached miss ─► Function ─► Supabase
   │ ─ intent, finalize, tracking, votes, admin ──► Function ──────────────────► Supabase
   └─ file bytes, signed PUT ─────────────────────► R2 incoming/
                      finalize: server-side copy ─► R2 quarantine/ ─ validated
                      scan worker (your host + ClamAV) ─► R2 evidence/ ─ clean
Reviewer ─ /api/admin/evidence/:id (audited) ─ 303 ─► two-minute signed link ─► R2
```

| Role | Connects as | Can do |
|---|---|---|
| Vercel app | `jamatnama_app` via transaction pooler | Read and write app tables. Audit log is append-only. No deletes on reports or evidence. |
| Scan worker | `jamatnama_scanner` | Evidence metadata and budget only. Cannot read reports, accused details, staff or sessions. |
| Migrations, backups | `postgres` owner via direct or session connection, from your own machine | Everything. Never configured in Vercel. |
| Supabase `anon`, `authenticated`, `service_role` | | Nothing: no schema access, and RLS is on with no policy for them. |

## 2. Decision needed before you start: where the scanner runs

ClamAV needs a long-running host, so it cannot run on Vercel. **Uploads stay in quarantine and reviewers cannot open them until a worker clears them.** There is deliberately no bypass. Migrated evidence goes through the same path.

- A small always-on Linux machine you already have: no added cost.
- A small VPS: a paid service, so it needs your approval. ClamAV wants roughly 2 GB of RAM or more for its signatures.
- Scheduled `npm run worker:scan -- --once` from a CI runner: possible for low volume, but large videos may exceed runner limits and this path is untested.

## 3. Supabase

1. Create the project in the same region as Vercel. `vercel.json` uses `bom1` (Mumbai), which matches Supabase `ap-south-1`. If you choose Singapore, use `sin1` with `ap-southeast-1`. Measure from Bangladesh during staging.
2. **Project Settings → Data API → Exposed schemas:** make sure `jamatnama` is **not** listed. This app does not use the Data API. Disable the Data API entirely if nothing else in the project needs it.
3. **Project Settings → Database → SSL:** download the CA certificate. Base64-encode it for `DATABASE_CA_CERT`. Turn on **Enforce SSL**.
4. Save the owner connection string from **Connect → Session pooler** (or Direct) in your password manager. Then, on your own machine, with the variables set only in that shell:

   ```bash
   npm ci
   ```

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:set-password -- jamatnama_app
   ```

   ```bash
   DB_ROLE_PASSWORD="$SCANNER_PASSWORD" npm run db:set-password -- jamatnama_scanner
   ```

   `db:migrate` needs `DATABASE_ADMIN_URL` and `DATABASE_CA_CERT`. `db:set-password` reads `DB_ROLE_PASSWORD` and sends only a SCRAM verifier. Use different long random passwords for the two roles.
5. Build the application `DATABASE_URL` from **Connect → Transaction pooler** (port 6543), replacing the user with `jamatnama_app.<project-ref>`. Check the format against the string the dashboard shows. Build the scanner's URL the same way with `jamatnama_scanner.<project-ref>`.
6. **Project Settings → Database → Connection pooling:** note the pool size and maximum client connections for your compute size. Keep `peak Vercel instances × DB_POOL_MAX` under the client maximum. The default of 5 per instance allows 40 instances per 200 clients. In transaction mode, pool size is the real concurrency limit for queries.
7. Confirm **Database → Backups** shows daily backups. Decide whether Point-in-Time Recovery (a paid add-on) is worth it for you. Without it you can lose up to a day of reports, so at minimum also run section 9's encrypted backup on a schedule.

## 4. Cloudflare R2

1. **R2 → Create bucket**, for example `jamatnama-evidence`, Standard class. Choose a location hint near your users. Create `jamatnama-evidence-backup` as well if you take the backup in section 9.
2. Bucket **Settings → Public access:** keep **R2.dev subdomain disabled** and add **no custom domain**. Any public route to this bucket would expose raw evidence.
3. **Settings → CORS policy:** paste `docs/r2-cors.json` with `https://YOUR-PRODUCTION-DOMAIN` replaced. List only your exact origins. Add a staging origin only on the staging bucket.
4. **Settings → Object lifecycle:** add a rule to **abort incomplete multipart uploads after 2 days** with no prefix. Do **not** add a delete-objects rule for `quarantine/` or `evidence/`: a scanner outage could then destroy unscanned evidence. Maintenance cleans abandoned objects by name.
5. **R2 → Manage API tokens → Create:** **Object Read & Write**, scoped to this bucket only. It gives `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. The secret is shown once. Use a separate token for the scan worker and one covering both buckets for backups, kept on your own machine.

### Limits

| Limit | Default | Setting |
|---|---|---|
| Files per report | 5 | `UPLOAD_MAX_FILES` |
| Image (JPG, PNG, WebP) | 25 MB | `UPLOAD_MAX_IMAGE_MB` |
| PDF | 50 MB | `UPLOAD_MAX_DOCUMENT_MB` |
| Audio (MP3, WAV, M4A, OGG) | 200 MB | `UPLOAD_MAX_AUDIO_MB` |
| Video (MP4, MOV, WebM, 3GP) | 2 GB | `UPLOAD_MAX_VIDEO_MB` |
| All files in one report | 3 GB | `UPLOAD_MAX_TOTAL_MB` |
| All evidence, ever | 800 GB | `UPLOAD_BUDGET_TOTAL_GB` |
| New uploads per day (Asia/Dhaka) | 40 GB | `UPLOAD_BUDGET_DAILY_GB` |
| Signed PUT or part URL life | 15 minutes | fixed |
| Submission intent life | 2 hours | fixed |
| Reviewer link life | 2 minutes | fixed |

Files over 32 MB upload as 16 MB parts. Reaching a budget returns 503 with a clear message, and reports without files keep working. `UPLOADS_ENABLED=false` is the emergency stop for uploads alone. Word and Excel files are refused on purpose: reviewers open evidence on their own computers, and macro documents are a common attack path.

## 5. Cloudflare Turnstile

Create a widget restricted to your production hostname. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Keep your existing keys if they already cover this domain.

## 6. Scan worker (on the host from section 2)

```bash
docker compose -f scanner/docker-compose.yml --env-file scanner/.env up -d
```

`scanner/.env` holds the scanner's `DATABASE_URL`, `DATABASE_CA_CERT` and its `R2_*` values. Protect it with file permissions. Without Docker, install `clamd` with the limits in `scanner/clamd-limits.conf` and run `npm run worker:scan` under a service manager.

The Docker files were **not tested** because Docker was unavailable here. Run the ClamAV checks in section 10 on this host.

## 7. Vercel

1. Import the project. Framework: Next.js. Node.js 24. Leave build and output settings at their defaults.
2. **Settings → Environment Variables** (Production, and Preview pointing at staging only):
   `PUBLIC_ORIGIN`, `COOKIE_SECURE=true`, `ADMIN_PASSWORD_HASH`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM`, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `CRON_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `DATABASE_URL`, `DATABASE_CA_CERT`, `DB_POOL_MAX`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   - Reuse `ADMIN_PASSWORD_HASH` from the current deployment so the Super Admin password stays the same. The Super Admin login code is emailed through Resend; see docs/ADMIN-TEAM.md.
   - `R2_ACCOUNT_ID` must be present at build time, because the Content Security Policy that permits direct uploads is built from it. Redeploy after changing it.
   - Do **not** add `DATABASE_ADMIN_URL`, `DB_ROLE_PASSWORD` or backup keys.
   - Generate new keys locally: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep a copy of `MFA_ENCRYPTION_KEY` in your password manager.
3. `vercel.json` sets the region and a cron every 15 minutes for `/api/cron/maintenance`. Confirm under **Settings → Cron Jobs**.
4. **Firewall → Rules:** add per-IP rate limits here. The app deliberately stores no IP data, so its own limits are per browser cookie plus global, and clearing cookies only falls through to the global limit. Suggested starting points, per IP per 60 s, action Deny:

   | Path | Limit |
   |---|---|
   | `/api/admin/session` | 20 |
   | `/api/uploads/intent` | 10 |
   | `/api/uploads/sign` | 300 |
   | `/api/uploads/complete` | 60 |
   | `/api/track` | 30 |
   | `/api/reports/*/support` | 60 |
   | `/api/challenge` | 60 |
   | `/api/reports` (uncached searches) | 300 |

   WAF rate limiting is metered and counted per region. Check current pricing on Vercel's WAF page. Many visitors in Bangladesh can share one mobile carrier IP, so review denials after launch and raise limits if real people are blocked.
5. Point your domain at Vercel. Do not put another caching proxy in front: it would add a cache outside the bounds in section 8.

## 8. Public cache behavior

A publish or withdrawal bumps `meta.revision` in the same transaction. Clients poll `/api/revision` about every 30 to 40 s while the tab is visible and put the revision in every data URL.

| Layer | Lifetime | |
|---|---|---|
| `/api/revision` | 5 s + 5 s stale at the CDN | |
| Data URL for the current revision | 30 s at the CDN, no stale serving | Browsers keep no copy. |
| Data URL for any other revision | Not stored | Old URLs cannot be pinned. |
| Data URL without `rev` | 10 s at the CDN | |
| Instance memory | 2 s | |
| The page itself | Static, contains no reports | |

**Withdrawal guarantee (documented behavior):**

- **Any CDN URL** stops serving a withdrawn report within **about 32 s** (30 s entry + 2 s memo).
- **A visitor with the page open** sees it disappear within **about 55 s**: up to 40 s until the next poll + 10 s revision staleness + the fetch. Measured locally with no CDN: 11.4 s for an open page (one sample), under 2 s at the origin.
- **Hidden tabs** do not poll. They refresh as soon as they become visible again.
- A copy someone already saved is out of the system's control.

Support counts refresh at most every 5 minutes on an open page, because votes deliberately do not flush caches. Evidence is never in a public response, and there is no public evidence link feature.

For an urgent removal, also purge the CDN cache from the project's cache settings in Vercel.

## 9. Migrating from SQLite

The tool opens the source read-only and never changes it. It preserves report IDs, receipt hashes, timestamps, statuses, relations, moderator accounts, audit IDs and history. Moderator authenticator secrets are sealed with `MFA_ENCRYPTION_KEY`. **Sessions are not migrated, so everyone signs in again.** Replay state carries over. Legacy evidence is checksummed, read back, and placed in quarantine for the scanner.

1. Rehearse on staging with a copy of the database. Time it.
2. Announce a short maintenance window, then **stop the old application** so nothing changes during the copy.
3. Snapshot, then use the snapshot as the source:

   ```bash
   DATA_DIR=./data npm run db:backup:sqlite -- /restricted/path/cutover.sqlite
   ```

4. Dry run. Fix any listed problem in a copy of the source:

   ```bash
   npm run migrate:sqlite -- --sqlite /restricted/path/cutover.sqlite --dry-run
   ```

5. Execute. If interrupted, run the same command again; it resumes:

   ```bash
   npm run migrate:sqlite -- --sqlite /restricted/path/cutover.sqlite --execute
   ```

6. Verify with full checksums. It must print `"verified": true`. Run it before reopening, since later moderation is a legitimate difference:

   ```bash
   npm run migrate:sqlite -- --sqlite /restricted/path/cutover.sqlite --verify --deep
   ```

7. Start the scan worker and wait for it to clear the queue (Team panel, "waiting for scan").
8. Smoke test on the Vercel URL using section 10, then switch DNS.
9. Keep the old server stopped and its database untouched for at least 30 days.

These commands need `DATABASE_ADMIN_URL`, `DATABASE_CA_CERT`, `MFA_ENCRYPTION_KEY` and the `R2_*` values in your shell. **Do not run against production without a backup and your own go-ahead.**

### Rollback

**Before DNS switches or within the window, no new data:** point traffic back to the old deployment and start it. The SQLite database was never changed.

**After new reports arrived on PostgreSQL:** rolling back loses them from the public view. First export them with `npm run db:backup` to keep a copy, switch traffic back, and re-enter what matters by hand. No reverse migration tool exists.

**Application-only problem:** in **Vercel → Deployments**, use **Instant Rollback** on the last good deployment. The database and R2 stay as they are.

**To retry a failed migration from zero:** on the target only, after double-checking the connection string:

```sql
DROP SCHEMA jamatnama CASCADE;
DROP TABLE public.jamatnama_schema_migrations;
```

Then empty the bucket's `quarantine/` and `evidence/` prefixes and start from `db:migrate`. Roles remain and are reused.

## 10. Staging checks that remain

Everything local passed against real PostgreSQL 17 and test doubles, which is **not proof of live connectivity**. These need your staging accounts:

**Supabase**
- [ ] `jamatnama_app.<ref>` connects through the transaction pooler with TLS verification on.
- [ ] From the browser console with the anon key, `supabase.schema('jamatnama').from('reports').select()` fails, and the REST endpoint does not list `jamatnama`.
- [ ] Database encoding is UTF8 (the migration refuses otherwise). Search for a Bangla word finds a report. `EXPLAIN` uses `reports_pub_search` at volume under Supabase's locale.
- [ ] `statement_timeout` on `jamatnama_app` applies through the pooler: `SHOW statement_timeout`.

**R2**
- [ ] A browser on your domain uploads a small file and a 100 MB video, including on a phone. The preflight passes. Another origin is refused.
- [ ] An unsigned object URL returns an error. An `r2.dev` URL does not exist.
- [ ] Wrong length and wrong type PUTs are refused. An expired URL is refused.
- [ ] **Second PUT to the same URL returns 412.** Whether R2 honors a signed `If-None-Match` is not documented. If it does not, the app is still safe because validation runs on the separate quarantine copy, but expect replayed bytes to overwrite `incoming/` until maintenance removes it. Note the result.
- [ ] A multipart upload completes, `ListParts` sizes match, and the copy to `quarantine/` of a multipart object keeps its ETag.
- [ ] A 2 GB video finalizes within the 60 s function limit. The server-side copy happens during finalize; if it takes too long, raise `maxDuration` in `app/api/reports/route.ts`.
- [ ] A reviewer link downloads as an attachment and fails after two minutes.

**Vercel**
- [ ] `curl -sI "https://DOMAIN/api/revision"` twice shows `x-vercel-cache: HIT` on the second, and a browser-facing `cache-control` with `max-age=0`.
- [ ] Same for `/api/reports?rev=<current>`. `/api/reports?rev=999999` shows `MISS` and `no-store`.
- [ ] Time a withdrawal end to end. Confirm it meets section 8.
- [ ] The cron runs and returns 200. Calling it without the bearer token returns 401.
- [ ] Function logs for a full flow contain no report text, receipts, or signed URLs.
- [ ] Firewall rules fire at the expected thresholds.

**ClamAV**
- [ ] Run `clamdscan` on the harmless standard EICAR file on the host: it reports FOUND. (That exact file cannot go through the app, because format checks refuse it first.)
- [ ] For the full path, temporarily add a custom signature: a `test.ndb` file in the ClamAV database directory containing `JAMATNAMA.TestMarker:0:*:` followed by the hex of a unique marker string, then restart clamd. Upload a PDF containing that marker: state becomes `infected` and the object is gone. Remove the signature afterward.
- [ ] A clean 2 GB video completes without a size-limit error.
- [ ] Stop clamd: files stay in quarantine and nothing becomes `clean`.

**Turnstile and MFA**
- [ ] The real widget loads under the Content Security Policy and server validation passes. A token replayed for a second request fails.
- [ ] Super Admin signs in with the existing password and the emailed code. A migrated moderator signs in with username and password.

**Load**
- [ ] Repeat the load test against staging with the WAF temporarily adjusted. `scripts/load-test.mjs` only targets its own local servers, so use your preferred tool with the same request mix. Only staging capacity numbers can support a public claim.

## 11. Spend and usage monitoring

Prices change, so confirm them on each provider's pricing page before relying on these estimates.

**Vercel**
- **Settings → Billing → Spend Management:** set a monthly amount and alerts at 50, 75 and 100%. A spend amount alone does not stop usage; **Pause Production Deployments** does, and it takes the site offline, so choose deliberately. Spend is checked every few minutes, so it can overshoot slightly.
- Watch **Usage** for Edge Requests, Function invocations and duration, and Fast Data Transfer. Polling is the largest source: 10,000 visitors with tabs open at once is about 300 requests per second, roughly 1 million edge requests per hour, nearly all CDN hits. If this gets expensive, raise `POLL_MS` in `components/Home.tsx`.

**Cloudflare R2**
- **R2 → Overview / bucket Metrics:** storage and Class A and B operations. Add a billing notification under **Notifications** if available on your account. Check weekly at first.
- About 800 GB of Standard storage is on the order of $12 per month at the published $0.015/GB-month, plus a second copy if you back up to another bucket. R2 charges no egress. Part uploads are Class A operations.
- The Team panel shows the app's own counters: total and daily bytes against budget, and files waiting for scan or failed.

**Supabase**
- **Reports → Database:** connections, CPU, disk, memory. **Project Settings → Usage** for the plan quota. Evidence is not in PostgreSQL, so the database stays small; expect well under 8 GB until reports reach the hundreds of thousands.
- Set the **spend cap** according to your preference, and add a Compute upgrade only if staging shows the need.

**Alerts worth setting**
- An uptime monitor on `/api/health` (returns 503 if the database is unreachable).
- A daily look at the Team panel. **Files waiting for scan for more than an hour mean the worker is down.**

## 12. Backup and restore

Backups contain private reports. Store them encrypted, away from the app, with restricted access, and keep `BACKUP_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` apart from them.

**Database, managed:** Supabase daily backups (see section 3). Test a restore into a new project at least once.

**Database, logical, from your own machine on a schedule:**

```bash
npm run db:backup -- /restricted/backups/2026-11-07
```

To restore: create a new empty database, set `DATABASE_ADMIN_URL` to it, run `npm run db:migrate`, then:

```bash
npm run db:restore -- /restricted/backups/2026-11-07
```

Restore refuses a non-empty target, a wrong key or a tampered file, and reads the data back to verify it. Sessions and rate limits are left out on purpose. `pg_dump` from a machine with PostgreSQL client tools also works against the direct connection, for an additional full copy.

**Evidence:** R2 has no automatic backup in this setup. A second private bucket holds copies, made server-side with no egress:

```bash
R2_BACKUP_BUCKET=jamatnama-evidence-backup npm run r2:backup
```

Other modes: `--verify` compares sizes and checksums, `--restore` copies missing objects back, `--orphans` lists objects with no database row. For protection against a Cloudflare account problem, also sync to another provider with `rclone`; that incurs storage there.

Local proof: section "Backup and restore" of [VERIFICATION-RESULTS.md](VERIFICATION-RESULTS.md).

## 13. Reference

```bash
npm test
```

```bash
R2_ENDPOINT=http://127.0.0.1:54340 npm run build
```

```bash
npm run verify:e2e
```

```bash
npm run load:test -- --out results.json
```

Local development uses the same PostgreSQL code path: `npm run dev:stack` prints values for `.env.local`, then `npm run dev`.
