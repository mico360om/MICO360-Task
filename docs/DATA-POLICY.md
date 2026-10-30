# Backup, Data-Retention & PII Policy (T19.6)

## Personal data (PII) we store

- **Users**: name, email, username, hashed password (bcrypt), timezone/locale/theme preferences,
  lockout state. No plaintext passwords are ever stored.
- **Activity & audit logs**: which user did what, when.
- **Comments / attachments**: user-generated content that may contain personal data.

Passwords are hashed with bcrypt; OTP and password-reset tokens are stored **hashed** (bcrypt and
SHA-256 respectively) and are single-use and time-limited. JWT refresh tokens are stored hashed.

## Backups

The app makes its own backups ([BACKUPS.md](BACKUPS.md)):

- **What**: every night from 02:00 company time, one file holding the whole database (every table, read
  as one consistent moment) and every uploaded file (`UPLOAD_DIR`), with checksums.
- **Kept**: the last 7 nights, one copy a week for the 4 weeks before (about five weeks), and the 3
  newest "Back up now" copies. Older copies are deleted automatically, on the server and in Google Drive.
- **Where**: a private folder on the server (`BACKUP_DIR`, never served by the website), and — when an
  administrator connects it — the owner's Google Drive, with the `drive.file` permission only (the app
  sees only the files it makes there).
- **Access**: only administrators can see, make or download copies; every download is in the audit log.
  A copy holds everything, including password hashes, so downloaded copies must be kept private.
- **Encryption**: with `BACKUP_ENCRYPTION_KEY` (AES-256) — optional in the app, but the owner wants the
  copies locked, and a production server without a key says so in System Settings (and emails the
  administrators once). The key is kept in a password manager, never beside the copies in Google Drive.
  The Google Drive connection and AI provider keys inside a copy stay sealed with
  `SECRETS_ENCRYPTION_KEY` either way.
- **Restore tests**: the restore tool checks every table and file against the copy after restoring; the
  automated tests restore a copy into an empty database on every build. Try a restore into a spare
  database now and then (BACKUPS.md, "Restoring a copy").

## Retention

- **Soft-deleted** tasks/projects/comments keep a `deletedAt` marker; purge rows older than
  **90 days** with a scheduled job if hard deletion is required.
- **Login OTPs / password-reset tokens**: expire quickly (minutes–1 hour) and can be pruned daily.
- **Audit logs**: retain **1 year** (adjust to your compliance needs), then archive or delete.
- **Email log**: retain **90 days** for deliverability debugging.

## Subject requests (export / erasure)

- **Export**: anyone can download their own data from **Profile → Download my data**
  (`GET /api/v1/users/me/export`). The JSON file holds their profile, project memberships, tasks
  assigned to or created by them, comments, uploaded-file details, chat messages, meeting notes,
  action items, recent activity, account events and their MICO AI chats. Deleted items are left
  out, each section is capped at the latest 5,000 entries, and every export is recorded in the
  audit log.
- **Erasure**: on a verified erasure request, deactivate the account and anonymise PII
  (replace name/email/username with tombstone values) while preserving referential integrity of
  historical activity. Hard-delete attachments the user uploaded, and the user's MICO AI chats.

## MICO AI

- Each person's MICO AI chats (`mico_ai_chats`, `mico_ai_messages`) are private to them: no one
  else can open them, administrators included. A chat deleted by its owner is deleted for good,
  with all its messages.
- A chat keeps copies of the data shown in its answers (the tables, and the records they came
  from, so later questions can use them) until the chat is deleted. Before an answer uses such a
  copy again, each record is checked against what the person can see at that moment, and records
  they have lost access to are left out.
- When an administrator deletes a user, that user's MICO AI chats are deleted too.
- MICO AI reads only what the person can already see (their projects' tasks, the meetings they
  may open, the chat conversations they are part of) and changes nothing.
- The audit log records only that MICO AI was used (`mico-ai.ask`), never the question or the
  answer. The question and the data it needs are sent to the AI service set up in AI Management.

The public privacy notice for staff (`/privacy` in the web app, linked from sign-in and the phone
app) summarises this policy in plain language. `/terms` holds the terms of use.

## Authorization model

MICO360 Tasks is a single-organization tool with **per-project visibility**:

- **Authentication**: every `/api/v1` route except `/auth/*`, `/health` and `/config` requires a
  valid access token. Suspended or signed-out sessions are refused right away (token version check).
- **Project access**: an administrator sees every project. Anyone else sees a project, and every
  task, column, comment, file and chat channel in it, only when they own, manage, created or belong
  to it. Assignees must be project members. Removing someone from a project removes their access to
  its tasks and its chat.
- **Role gates (RBAC)**: admin-only areas (user management, reports, audit logs, system/AI settings,
  project create/update/archive/delete) require the `ADMIN` role; employees get `403`.
- **Per-project manager tier**: column management and task deletion accept an admin **or** the
  project's `MANAGER` (`ProjectMemberRole`).
- **Ownership**: a user acts only as themselves, for example their own notification preferences,
  sessions, meeting notes (the organizer may also moderate them) and data export.

Meeting notes are soft-deleted (restorable with **Undo**), like tasks, projects and comments.

## Access & security

- Authorization is enforced **server-side** (RBAC + the manager tier above); employees cannot reach
  admin routes.
- Refresh tokens are **revocable and rotated**: each `/auth/refresh` rotates (single-use) the token
  and rejects a revoked/reused one; `/auth/logout` revokes server-side.
- Rotate `JWT_*` secrets and the **Mailjet secret** (shared in plaintext during planning) before
  go-live, and on any suspected exposure.
- Restrict database and backup access to the minimum set of operators.
