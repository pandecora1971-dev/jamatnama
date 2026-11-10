# Admin team
Open the admin panel, enter username `superadmin` and the owner password, and complete the bot check. A six-digit code is emailed to `ADMIN_EMAIL` through Resend. Enter it within 10 minutes to finish signing in. Each code works once.

Only superadmin can create, disable or re-enable moderators and view the activity log. Moderators can edit, publish and unpublish reports and download evidence. Disabling or re-enabling an account revokes its sessions. The audit records successful sign-ins, sign-outs, account changes, report review changes and evidence downloads. It stores identifiers and change flags, not report bodies, credentials or login codes.

To add a moderator, enter a username and a unique password of at least 14 characters in the superadmin team panel. Moderators sign in with username and password only, so give each one a long password and share it privately. Disable the account at once if a password may have leaked.

Sessions last up to 7 days for moderators. Disabling an account revokes its sessions immediately on every instance; re-enabling does not restore them. Evidence opens through an audited two-minute link and only after the malware scan has cleared it. The audit log is append-only at the database level.

## Email setup (Resend)
1. Create an account at https://resend.com and add your domain under **Domains**. Add the DNS records it shows, then wait until the domain is verified.
2. Create an API key under **API Keys** with **Sending access**.
3. Set `RESEND_API_KEY`, `ADMIN_EMAIL` (the inbox that receives the codes) and `RESEND_FROM`, for example `JAMATNAMA Security <security@jamaatnama.org>`. Without a verified domain, Resend only delivers to the email address of the Resend account itself.

Production refuses admin sign-in until `RESEND_API_KEY` and `ADMIN_EMAIL` are set.

See docs/DEPLOYMENT.md for schema setup and migration.
