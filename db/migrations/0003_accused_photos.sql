-- A photo of an accused person is an ordinary evidence file (private, malware-scanned,
-- opened only through the audited reviewer link) that also records which person it shows.
-- NULL means general evidence for the report.
ALTER TABLE jamatnama.evidence
  ADD COLUMN IF NOT EXISTS accused_position integer
  CHECK (accused_position IS NULL OR (accused_position >= 0 AND accused_position < 10));
