# JAMATNAMA category update
The 16 categories in lib/shared.ts follow the supplied handwritten sheet, with allegation wording where appropriate. The less legible lines were interpreted as ধর্ষণ ও পরকীয়া, মওদুদীবাদ ও ইসলাম বিকৃতি, প্রশাসনিক হয়রানি ও দুর্নীতিতে সংশ্লিষ্টতা, জেলহত্যা ও নির্যাতন, and ডিপস্টেট ও আলবদর. These headings describe report topics, not established findings.

The public form offers the new catalog. Existing reports retain their original categories, which remain available in the published report filter. Ward numbers and parent areas are reported by users and reviewed by moderators. The map continues to show the verified parent geography.

The cloud backend uses an isolated jamatnama PostgreSQL schema and a private R2 bucket. Use the dry-run migration documented in DEPLOYMENT.md to bring over legacy SQLite records.
