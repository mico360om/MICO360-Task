# Nightly backups — design (approved by the owner 30 Oct 2026)

Ships in **1.19.0** (server + web portal; web-only release). Must work on BOTH ways the server runs:
Hostinger Node.js hosting (task.mico360.com, Git deploy, `server.mjs`, MySQL on Hostinger) and the
Windows server package (`Installer/`, see `docs/WINDOWS-SERVER.md`). The owner is non-technical.

## Why
Today the app has no backup of its own (`docs/DATA-POLICY.md` only says "back up the database and the
attachment store"). If data is deleted by mistake, a bad release corrupts something, or the hosting
account has a problem, the company could lose its tasks, meetings, inspections and files. The owner
wants a copy every night that he can download, plus a copy in his Google Drive.

## Owner's decisions (question box, 30 Oct)
1. **Where kept:** on the server in a private folder (never served on the web) **+ downloadable by
   administrators** from System Settings **+ a copy sent to Google Drive** (needs a one-time Google
   connection that the lead will guide the owner through).
2. **Contents:** **data and files** — the whole database (every table) plus the uploaded files
   (`UPLOAD_DIR`: attachments, pictures, logos, chat/meeting files) — and the downloads folder only if
   it holds something not reproducible (the APK is reproducible; skip it unless trivial).
3. **Keep:** **7 nightly + 4 weekly** copies (the newest 7 nights, plus one per week for the 4 weeks
   before that); older copies are deleted automatically — on the server AND in Google Drive.
4. **Restore:** **no restore button in the app.** A tested **restore tool** (a script run on the
   server/PC, e.g. `npm run backup:restore -- <file> --into <database>`) plus **written step-by-step
   instructions** (docs/BACKUPS.md, plain English) — restoring replaces everything, so it is done
   deliberately with help. The restore is **tested automatically** (a DB integration test: seed → back
   up → restore into an empty database → identical row counts and contents for every table, files
   restored byte-for-byte).

## Rules (lead's calls — the builder follows these; flag any that turn out impossible)
- **No external dump tools.** Hostinger shared hosting may not have `mysqldump`; produce the dump in
  Node (Prisma/mysql2) — e.g. a zip/tar.gz containing one JSONL (or SQL INSERT) file per table + a
  manifest (app version, the latest applied migration name, created-at, table row counts, file count,
  checksums) + the files. Stream it (don't hold the whole DB or all files in memory); keep the app
  responsive while it runs (batches, low priority).
- **Schedule**: once a night at a quiet hour in the company time zone (e.g. 02:00 Asia/Muscat),
  using the server's existing sweep pattern (`setInterval` + `runExclusive(jobLock, …)` in
  `src/server.ts`) so only one instance runs it; catch up if the server was down at that hour.
  An administrator can also press **"Back up now"** in System Settings.
- **Where on disk**: a `BACKUP_DIR` setting (env), defaulting to a `backups` folder beside `UPLOAD_DIR`
  (outside the app folder, so a redeploy keeps it — see docs/DEPLOY-HOSTINGER.md on UPLOAD_DIR). Never
  under WEB_ROOT, never served statically. Check free space; if the disk is short, fail clearly.
- **Download**: System Settings → Backups: last backup time and size, status of the last 11 copies
  (date, size, kind nightly/weekly, Google Drive ✓/✗), "Download" per copy (admin-only, streamed,
  audit-logged), "Back up now". Admin-only API routes; nothing for other roles.
- **Google Drive**: OAuth 2.0 with the admin's Google account, scope **`drive.file`** only (the app
  sees only the files it creates). System Settings → "Connect Google Drive" → Google consent →
  callback stores the refresh token ENCRYPTED at rest (reuse how the app stores other secrets, e.g. AI
  keys in AI Management — check) → the nightly job uploads each new copy (resumable upload for big
  files) into a folder "MICO360 Tasks backups", and applies the same 7+4 retention there. Show
  "Connected as <email>" and "Disconnect". The Google OAuth client ID/secret come from env vars
  (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) — the owner will create them once with the lead; when
  they're not set, the Google section explains in one line that it isn't set up yet. No new heavy
  dependency if a few `fetch` calls do the job (Google's token + Drive upload REST APIs); if you do add
  `googleapis`, justify it (bundle size/ deploy time on Hostinger).
- **Failures**: if a nightly backup or the Drive upload fails, email the administrators (existing email
  module; if email isn't configured, just show it in System Settings) and show a clear warning there
  ("Last night's backup failed: <plain reason>"). A successful run is quiet.
- **Security**: backups contain everything (password hashes, client access codes, AI keys…). The local
  folder must not be web-reachable; downloads admin-only and audit-logged; Drive copies only in the
  owner's own Drive via drive.file. Consider encrypting the archive with a key from env
  (`BACKUP_ENCRYPTION_KEY`) — recommended but optional; if you do it, the restore tool and the docs
  must handle it and losing the key must be clearly explained. Record your decision.
- **Restore tool**: restores into a NAMED database (refuse to touch a non-empty database unless
  `--force`), runs migrations up to the backup's migration first (or refuses if the app is older than
  the backup), loads every table in FK-safe order, restores files into a given folder, and verifies
  counts/checksums. docs/BACKUPS.md: how backups work, where they are, how to download one, how to
  connect Google Drive, and step-by-step restore on Hostinger and on the Windows server.

## Out of scope
Point-in-time recovery, restoring single items, other cloud providers, a restore button.

## Done means
Test-first (unit + DB integration including the round-trip restore test), all suites green, tsc/eslint
clean, a real run against a populated test database (e.g. the QA data) with the archive inspected and
restored into a fresh database, retention tested with a fake clock (7 nightly + 4 weekly), the System
Settings section e2e-checked in a browser (Back up now → listed → download works → non-admin refused),
and the Google Drive flow covered by tests against a local fake of Google's token/upload endpoints
(the real connection is done later with the owner).
