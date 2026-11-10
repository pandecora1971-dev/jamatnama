-- JAMATNAMA core schema. All tables live in a private schema that the Supabase
-- Data API does not expose; never add "jamatnama" to the API's exposed schemas.
DO $$
BEGIN
  IF getdatabaseencoding() <> 'UTF8' THEN
    RAISE EXCEPTION 'JAMATNAMA stores Bangla text and requires a UTF8 database, found %', getdatabaseencoding();
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE SCHEMA jamatnama;
REVOKE ALL ON SCHEMA jamatnama FROM PUBLIC;

CREATE TABLE jamatnama.reports (
  id               text PRIMARY KEY,
  receipt_hash     text NOT NULL UNIQUE,
  title            text NOT NULL,
  description      text NOT NULL,
  -- Originals are preserved exactly; display_* holds the read-time alias mapping
  -- so that filters and aggregates can run in SQL.
  category         text NOT NULL,
  facts            jsonb NOT NULL,
  display_category text NOT NULL,
  display_facts    jsonb NOT NULL,
  division         text NOT NULL,
  district         text NOT NULL,
  upazila          text NOT NULL,
  ward             text NOT NULL DEFAULT '',
  ward_area        text NOT NULL DEFAULT '',
  incident_date    date NOT NULL,
  -- Millisecond precision keeps keyset cursors exact after a JavaScript round trip.
  created_at       timestamptz(3) NOT NULL,
  updated_at       timestamptz(3) NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  fingerprint      text NOT NULL UNIQUE,
  review_note      text NOT NULL DEFAULT '',
  supports_count   integer NOT NULL DEFAULT 0 CHECK (supports_count >= 0),
  search_text      text GENERATED ALWAYS AS (
    title || ' ' || description || ' ' || display_category || ' ' || district || ' ' || upazila
  ) STORED
);
CREATE INDEX reports_public_feed ON jamatnama.reports (created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX reports_admin_queue ON jamatnama.reports (status, created_at DESC, id DESC);
CREATE INDEX reports_pub_category ON jamatnama.reports (display_category, created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX reports_pub_division ON jamatnama.reports (division, created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX reports_pub_district ON jamatnama.reports (district, created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX reports_pub_upazila ON jamatnama.reports (upazila, created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX reports_pub_incident ON jamatnama.reports (incident_date) WHERE status = 'published';
CREATE INDEX reports_pub_ward ON jamatnama.reports (ward) WHERE status = 'published' AND ward <> '';
CREATE INDEX reports_pub_search ON jamatnama.reports USING gin (search_text extensions.gin_trgm_ops) WHERE status = 'published';
CREATE INDEX reports_pub_ward_area ON jamatnama.reports USING gin (ward_area extensions.gin_trgm_ops) WHERE status = 'published' AND ward_area <> '';
CREATE INDEX reports_admin_search ON jamatnama.reports USING gin (search_text extensions.gin_trgm_ops);

CREATE TABLE jamatnama.source_links (
  report_id text NOT NULL REFERENCES jamatnama.reports(id) ON DELETE CASCADE,
  position  integer NOT NULL,
  url       text NOT NULL,
  PRIMARY KEY (report_id, position)
);
CREATE TABLE jamatnama.accused (
  report_id   text NOT NULL REFERENCES jamatnama.reports(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  name        text NOT NULL,
  information text NOT NULL,
  PRIMARY KEY (report_id, position)
);
CREATE TABLE jamatnama.supports (
  report_id text NOT NULL REFERENCES jamatnama.reports(id) ON DELETE CASCADE,
  token     text NOT NULL,
  PRIMARY KEY (report_id, token)
);

-- Evidence metadata only. The bytes live in private R2 objects.
CREATE TABLE jamatnama.evidence (
  id               text PRIMARY KEY,
  report_id        text NOT NULL REFERENCES jamatnama.reports(id) ON DELETE CASCADE,
  mime             text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  object_key       text NOT NULL UNIQUE,
  sha256           text,
  state            text NOT NULL DEFAULT 'pending_scan'
                   CHECK (state IN ('pending_scan','clean','infected','rejected','scan_error')),
  origin           text NOT NULL DEFAULT 'upload' CHECK (origin IN ('upload','legacy')),
  scan_attempts    integer NOT NULL DEFAULT 0,
  scan_lease_until timestamptz(3),
  scan_engine      text NOT NULL DEFAULT '',
  scan_detail      text NOT NULL DEFAULT '',
  scanned_at       timestamptz(3),
  created_at       timestamptz(3) NOT NULL
);
CREATE INDEX evidence_report ON jamatnama.evidence (report_id);
CREATE INDEX evidence_scan_queue ON jamatnama.evidence (created_at) WHERE state = 'pending_scan';

-- One-time authorization for a single anonymous submission and its uploads.
CREATE TABLE jamatnama.submission_intents (
  id             text PRIMARY KEY,
  token_hash     text NOT NULL UNIQUE,
  created_at     timestamptz(3) NOT NULL,
  expires_at     timestamptz(3) NOT NULL,
  reserved_bytes bigint NOT NULL DEFAULT 0,
  budget_day     text NOT NULL,
  report_id      text UNIQUE REFERENCES jamatnama.reports(id) ON DELETE SET NULL,
  finalized_at   timestamptz(3)
);
CREATE INDEX intents_abandoned ON jamatnama.submission_intents (expires_at) WHERE report_id IS NULL;

CREATE TABLE jamatnama.upload_files (
  id                  text PRIMARY KEY,
  intent_id           text NOT NULL REFERENCES jamatnama.submission_intents(id) ON DELETE CASCADE,
  incoming_key        text NOT NULL UNIQUE,
  mime                text NOT NULL,
  size_bytes          bigint NOT NULL CHECK (size_bytes > 0),
  multipart_upload_id text,
  part_size           bigint,
  state               text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued','attached','rejected')),
  incoming_removed    boolean NOT NULL DEFAULT false,
  created_at          timestamptz(3) NOT NULL
);
CREATE INDEX upload_files_intent ON jamatnama.upload_files (intent_id);
CREATE INDEX upload_files_incoming_sweep ON jamatnama.upload_files (created_at) WHERE state <> 'issued' AND NOT incoming_removed;

-- Periods: 'total' and 'day:YYYY-MM-DD' (Asia/Dhaka).
CREATE TABLE jamatnama.upload_budget (
  period text PRIMARY KEY,
  bytes  bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);

CREATE TABLE jamatnama.staff (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  totp_secret   text NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz(3) NOT NULL
);
CREATE TABLE jamatnama.staff_sessions (
  token_hash text PRIMARY KEY,
  staff_id   text NOT NULL REFERENCES jamatnama.staff(id) ON DELETE CASCADE,
  expires    bigint NOT NULL
);
CREATE INDEX staff_sessions_staff ON jamatnama.staff_sessions (staff_id);
CREATE INDEX staff_sessions_expiry ON jamatnama.staff_sessions (expires);
CREATE TABLE jamatnama.admin_sessions (
  token_hash         text PRIMARY KEY,
  expires            bigint NOT NULL,
  credential_version text NOT NULL
);
CREATE INDEX admin_sessions_expiry ON jamatnama.admin_sessions (expires);

CREATE TABLE jamatnama.audit_log (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  actor_id   text NOT NULL,
  actor_name text NOT NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  detail     text NOT NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX audit_target ON jamatnama.audit_log (target, id DESC);
CREATE INDEX audit_actor ON jamatnama.audit_log (actor_id, id DESC);

-- Shared single-use and throttle state, visible to every Vercel instance.
CREATE TABLE jamatnama.challenges (
  nonce   text PRIMARY KEY,
  used_at bigint NOT NULL
);
CREATE INDEX challenges_used ON jamatnama.challenges (used_at);
CREATE TABLE jamatnama.totp_replay (
  identity text PRIMARY KEY,
  step     bigint NOT NULL
);
-- UNLOGGED: losing counters in a crash is acceptable and avoids WAL on every request.
CREATE UNLOGGED TABLE jamatnama.rate_limits (
  bucket  text PRIMARY KEY,
  count   integer NOT NULL,
  expires bigint NOT NULL
);
CREATE INDEX rate_limits_expiry ON jamatnama.rate_limits (expires);

CREATE TABLE jamatnama.meta (
  key   text PRIMARY KEY,
  value bigint NOT NULL
);
INSERT INTO jamatnama.meta (key, value) VALUES ('revision', 0);
