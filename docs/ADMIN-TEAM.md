# Admin team
Open the admin panel and use the existing owner password and authenticator with username superadmin.

Only superadmin can create, disable or re-enable moderators and view the activity log. Moderators can edit, publish and unpublish reports and download evidence. Disabling or re-enabling an account revokes its sessions. The audit records successful sign-ins, sign-outs, account changes, report review changes and evidence downloads. It stores identifiers and change flags, not report bodies, credentials or authenticator codes.

For each moderator, generate a unique 32-character Base32 key locally. For example, run this in a private terminal:

    python3 -c 'import base64,secrets; print(base64.b32encode(secrets.token_bytes(20)).decode())'

Enter this key into the moderator’s authenticator as a time-based account. In the superadmin team panel, enter the new username, a unique password of at least 14 characters, the key and a current six-digit code. Keep each key private. Authenticator keys are sealed in the database with MFA_ENCRYPTION_KEY, so keep that key safe and separate from database backups. Losing it locks out every moderator until each is re-enrolled.

Disabling an account revokes its sessions immediately on every instance; re-enabling does not restore them. Evidence opens through an audited two-minute link and only after the malware scan has cleared it. The audit log is append-only at the database level.

See docs/DEPLOYMENT.md for schema setup and migration.
