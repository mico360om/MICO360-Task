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

- **Export**: an admin can compile a user's data (profile, assigned tasks, comments, activity)
  via the API; a `/users/me/export` convenience endpoint is a planned addition.
- **Erasure**: on a verified erasure request, deactivate the account and anonymise PII
  (replace name/email/username with tombstone values) while preserving referential integrity of
  historical activity. Hard-delete attachments the user uploaded.

## Authorization model (intentional collaborative visibility)

MICO360 Tasks is a **single-organization collaborative** tool (like a team workspace in
Trello/Jira): **any authenticated user can read, and update, any task or project by ID.** This is
**by design** — the trust boundary is "signed-in member of this organization," not per-project
membership. There is deliberately **no object-level (per-project) access control** on task/project
reads or ordinary edits.

What **is** enforced, server-side:

- **Authentication** — every `/api/v1` route except `/auth/*`, `/health`, `/config` requires a
  valid access token.
- **Role gates (RBAC)** — admin-only areas (user management, reports, audit logs, system/AI
  settings, project create/update/archive/delete) require the `ADMIN` role; employees get `403`.
- **Per-project manager tier** — column management and task deletion accept an admin **or** the
  project's `MANAGER` (`ProjectMemberRole`).
- **Ownership-ish actions** — a user can only act as themselves (e.g. "assign to me", their own
  notification preferences, their own session/refresh tokens).

**Implication / operator note:** do **not** put data that must be hidden from some employees into a
task or project here — everyone in the org can see it. If a future requirement needs private or
per-project-restricted boards (e.g. HR/finance projects, external collaborators, or multi-tenancy),
that requires adding object-level authorization (gate `GET/PUT /tasks/:id` and `/projects/:id` by
project membership) — a deliberate, breaking change to the collaborative model, tracked as a
known follow-up rather than a bug.

## Access & security

- Authorization is enforced **server-side** (RBAC + the manager tier above); employees cannot reach
  admin routes.
- Refresh tokens are **revocable and rotated**: each `/auth/refresh` rotates (single-use) the token
  and rejects a revoked/reused one; `/auth/logout` revokes server-side.
- Rotate `JWT_*` secrets and the **Mailjet secret** (shared in plaintext during planning) before
  go-live, and on any suspected exposure.
- Restrict database and backup access to the minimum set of operators.
