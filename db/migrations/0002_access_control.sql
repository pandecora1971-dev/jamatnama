-- Least-privilege access. Passwords are never stored here; set them with
-- `npm run db:set-password` (the verifier is hashed on the client side).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jamatnama_app') THEN
    CREATE ROLE jamatnama_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jamatnama_scanner') THEN
    CREATE ROLE jamatnama_scanner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

ALTER ROLE jamatnama_app SET search_path = jamatnama, pg_catalog;
ALTER ROLE jamatnama_app SET statement_timeout = '8s';
ALTER ROLE jamatnama_app SET lock_timeout = '4s';
ALTER ROLE jamatnama_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE jamatnama_scanner SET search_path = jamatnama, pg_catalog;
ALTER ROLE jamatnama_scanner SET statement_timeout = '15s';
ALTER ROLE jamatnama_scanner SET idle_in_transaction_session_timeout = '30s';

GRANT USAGE ON SCHEMA jamatnama TO jamatnama_app, jamatnama_scanner;

GRANT SELECT, INSERT, UPDATE ON jamatnama.reports TO jamatnama_app;
GRANT SELECT, INSERT ON jamatnama.source_links, jamatnama.accused, jamatnama.supports TO jamatnama_app;
GRANT SELECT, INSERT ON jamatnama.evidence TO jamatnama_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jamatnama.submission_intents, jamatnama.upload_files TO jamatnama_app;
GRANT SELECT, INSERT, UPDATE ON jamatnama.upload_budget TO jamatnama_app;
GRANT SELECT, INSERT, UPDATE ON jamatnama.staff TO jamatnama_app;
GRANT SELECT, INSERT, DELETE ON jamatnama.staff_sessions, jamatnama.admin_sessions, jamatnama.challenges TO jamatnama_app;
GRANT SELECT, INSERT, UPDATE ON jamatnama.totp_replay TO jamatnama_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jamatnama.rate_limits TO jamatnama_app;
GRANT SELECT, UPDATE ON jamatnama.meta TO jamatnama_app;
-- Append-only: the application can never alter or remove audit history.
GRANT SELECT, INSERT ON jamatnama.audit_log TO jamatnama_app;

-- The scanner sees evidence metadata only: never reports, accused details, staff or sessions.
GRANT SELECT, UPDATE ON jamatnama.evidence TO jamatnama_scanner;
GRANT SELECT, UPDATE ON jamatnama.upload_budget TO jamatnama_scanner;
GRANT INSERT ON jamatnama.audit_log TO jamatnama_scanner;

-- Row level security: on for every table, with no policy for any Supabase API role,
-- so even a future accidental grant or schema exposure returns nothing.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'jamatnama' LOOP
    EXECUTE format('ALTER TABLE jamatnama.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_access ON jamatnama.%I TO jamatnama_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
CREATE POLICY scanner_evidence ON jamatnama.evidence TO jamatnama_scanner USING (true) WITH CHECK (true);
CREATE POLICY scanner_budget ON jamatnama.upload_budget TO jamatnama_scanner USING (true) WITH CHECK (true);
CREATE POLICY scanner_audit ON jamatnama.audit_log FOR INSERT TO jamatnama_scanner WITH CHECK (true);

-- Supabase API roles exist only on Supabase; plain PostgreSQL skips them.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA jamatnama FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA jamatnama FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA jamatnama FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA jamatnama FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA jamatnama FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA jamatnama REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA jamatnama REVOKE ALL ON ROUTINES FROM PUBLIC;
