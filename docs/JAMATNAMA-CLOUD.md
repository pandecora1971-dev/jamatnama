# JAMATNAMA cloud release

Backend adapted from pandecora1971-dev/bnpnama commit 028c175952e9f3fb50e4c3d1725e5b0584854912. The JAMATNAMA catalog, Bangla editorial design and hero are integrated with the reference API contracts.

- Configure a separate Supabase project or isolated jamatnama schema with jamatnama_app and jamatnama_scanner roles, a separate private R2 bucket, and independent credentials. Use the templates and migrations in this archive.
- The login route requires per-account authenticator codes. Production also requires Turnstile and the configured HTTPS origin. Moderator authenticator keys are encrypted in PostgreSQL. Super admin audit and moderator permissions are checked on the server.
- Vercel Pro maintenance runs every 15 minutes. The malware scanner worker runs separately and uses its restricted role.
- Before production, run the SQLite migration dry run, copy and verify evidence, and confirm the new credentials in staging. Old SQLite data and credentials are outside the release archive.
- Local tests use real PostgreSQL with R2, ClamAV and Turnstile test doubles. Cloud provider configuration is a separate staging check.
