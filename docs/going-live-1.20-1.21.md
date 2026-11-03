# Going live with 1.20.0 and 1.21.0 — safety checklist

The live site (task.mico360.com) runs **1.18.1**. Waiting to go live: 1.18.2, 1.19.0 and 1.20.0 (pushed
together), then 1.21.0 (multi-company) on its own. Every push to GitHub `main` makes Hostinger build the
site, upgrade the database (`prisma migrate deploy`) and restart.

## What was checked (3 Nov 2026)

- **Database changes since 1.18.1: 7, and all of them only add.** New tables (backups, external contacts,
  meeting reminders, the search index, companies) and new optional columns (task approvals, a project's
  and a person's company, a meeting's company, a notification's project). Nothing is removed, renamed or
  emptied. The only change to existing rows is the companies backfill, which fills the new company
  columns where they are empty — every person and project goes into "Prolens Projects LLC".
- **Upgrade rehearsal** on two copies of live-version data (the small-company file and the 1.18.1 demo
  data), 1.18.1 → 1.20.0 → 1.21.0:
  - every table that exists today keeps every row and every value (64 of 64 tables identical);
  - every person signs in and sees everything they saw on 1.18.1 (projects, tasks, meetings, people,
    activity, their notifications);
  - search finds tasks made before the upgrade within a minute (the server indexes them on its own);
  - **going back works without touching the database:** the 1.18.1 and 1.20.0 servers run on the
    upgraded 1.21.0 database and everyone still sees everything.
- No new packages to install; every new setting is optional.
- The full browser test battery is run on each release before it is tagged.

## Before pushing

1. The PC is clean (the six traces are gone — Claude checks) and the passwords are changed.
2. **Back up the live database:** hPanel → Databases → phpMyAdmin → the site's database → Export →
   Quick → SQL → Go. Keep the file on your own computer, not on the server.
3. **Back up the uploaded files:** hPanel → File Manager → the uploads folder (UPLOAD_DIR) → Compress →
   download the zip.
4. Note what is live now: `https://task.mico360.com/build-info.json` shows `1.18.1`.

## Step 1 — push 1.20.0

- Claude pushes the tags v1.18.2, v1.19.0, v1.20.0 and moves `main` to 1.20.0.
- Wait for hPanel → Deployments to show the build finished (1–2 minutes).
- Check: `build-info.json` shows `1.20.0`. Sign in yourself and open the Dashboard, a project's board, a
  task, Meetings, the bell, and search for a task by a word from its title.
- hPanel → Advanced → Cron jobs: change the site's cron to **every 5 minutes** (meeting reminders).
- System Settings → Backups: read the card (backup folder, lock key) and make one copy by hand.

## Step 2 — push 1.21.0 (multi-company), after a few days on 1.20.0

- Take the two backups again (database and uploads).
- Claude pushes v1.21.0.
- Check: `build-info.json` shows `1.21.0`. With one company nothing changes for anyone, except a
  "Companies" item in the Admin menu: open it and see "Prolens Projects LLC" with everyone and every
  project in it.

## If something goes wrong

- **The build fails:** Hostinger keeps the previous version running. Nothing to undo — send Claude the
  build log (hPanel → Deployments → the build → Build logs).
- **The site runs but something is wrong:** put the previous version back. Claude makes a commit that
  restores the previous release's code and pushes it (no history is lost). **The database does not need
  restoring** — the older version runs on the upgraded database (rehearsed above).
- **Back on an older version after 1.21.0, then up again:** people or projects added in between are in
  no company yet. Run the companies backfill once more — phpMyAdmin → SQL → paste
  `Web Portal/backend/prisma/migrations/20261031200100_multi_company_backfill/migration.sql` → Go (it is
  safe to run more than once) — and they join "Prolens Projects LLC".
- **Only if data itself was damaged:** restore the database backup from "Before pushing" (phpMyAdmin →
  Import), and the uploads zip.
