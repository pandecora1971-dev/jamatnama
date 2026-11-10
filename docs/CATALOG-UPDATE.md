# JAMATNAMA category update
The 35 categories in lib/shared.ts follow the owner-supplied list of 10 November 2026, in the same order and wording (whitespace tidied, text stored in Unicode NFC). New headlines inherit the form fields of the closest earlier category. Clear renames are read-time aliases, so older reports appear under the new headline; topics that were dropped stay valid for existing reports only. These headings describe report topics, not established findings.

The public form offers the new catalog. Existing reports retain their original categories, which remain available in the published report filter. Ward numbers and parent areas are reported by users and reviewed by moderators. The map continues to show the verified parent geography.

The cloud backend uses an isolated jamatnama PostgreSQL schema and a private R2 bucket. Use the dry-run migration documented in DEPLOYMENT.md to bring over legacy SQLite records.
