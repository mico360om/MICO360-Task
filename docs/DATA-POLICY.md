# Backup, Data-Retention & PII Policy (T19.6)

## Personal data (PII) we store

- **Users**: name, email, username, hashed password (bcrypt), timezone/locale/theme preferences,
  lockout state. No plaintext passwords are ever stored.
- **Activity & audit logs**: which user did what, when.
- **Comments / attachments**: user-generated content that may contain personal data.

Passwords are hashed with bcrypt; OTP and password-reset tokens are stored **hashed** (bcrypt and
SHA-256 respectively) and are single-use and time-limited. JWT refresh tokens are stored hashed.

## Backups

- Take **automated daily backups** of the MySQL database (managed-DB automated snapshots, or
  `mysqldump` on a cron) with at least **30 days** retention and periodic restore tests.
- Back up the attachment store (`UPLOAD_DIR` / the S3 bucket) on the same cadence.
- Store backups **encrypted at rest** and restrict access to operators only.

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
  action items, recent activity and account events. Deleted items are left out, each section is
  capped at the latest 5,000 entries, and every export is recorded in the audit log.
- **Erasure**: on a verified erasure request, deactivate the account and anonymise PII
  (replace name/email/username with tombstone values) while preserving referential integrity of
  historical activity. Hard-delete attachments the user uploaded.

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
