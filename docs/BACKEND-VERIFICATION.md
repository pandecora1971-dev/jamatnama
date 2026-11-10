> Historical record of the earlier SQLite backend. Current state: [VERIFICATION-RESULTS.md](VERIFICATION-RESULTS.md).

# JAMATNAMA backend verification — 2026-11-07

Scope: hardening of the existing single-instance SQLite backend. Supabase and R2 are deliberately not connected. JAMATNAMA is excluded.

Changes: production mutations reject absent/untrusted Origin; JSON mutation endpoints reject null/array/primitive payloads; moderation update and public revision bump are atomic; rate windows expire at their exact boundary and reset atomically; indexes added for evidence lookup and expiry cleanup; consistent SQLite backup command added.

Verification: 23 automated tests passed. Local isolated HTTP integration flow passed: anonymous submission, tracking, private evidence/accused information, review gate, publishing/unpublishing, live events, deduplicated support, session revocation, forged session rejection and brute-force throttling. WAL backup was reopened and its data verified.

Run with Node 24+. npm ci; configure .env.local using .env.example; npm run admin:setup; npm run admin:2fa; npm run dev. Production requires the existing mandatory production configuration.

Backup: npm run db:backup -- /restricted/location/unique-backup.sqlite
Backups contain private reports. Encrypt and restrict them. For recovery, stop the application and restore into a NEW empty DATA_DIR; never replace a live database file alongside stale WAL/SHM files. Verify the restored application before switching traffic.

Limits: this is not yet Vercel-ready (persistent local SQLite). No 10k-concurrent-user claim or load certification. Cookie-based rate limits can be bypassed by cookie resets until global limits apply; edge protections remain necessary. The current public report endpoint still sends all published reports and SSE has a 250-connection per-process limit; server pagination and scalable live delivery remain future work. PDF/audio have no malware scanner; video uploads are not implemented. Real Turnstile/MFA/provider deployment verification must happen in staging.
