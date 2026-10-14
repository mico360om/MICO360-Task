# MICO360 Tasks 0.4.0 — ready to deploy

One folder for each place the system installs. Each folder holds the package for that place and a
`README.md` with the steps.

| Folder | Environment | Package |
| --- | --- | --- |
| [`1-Hostinger-Web-Server/`](1-Hostinger-Web-Server/README.md) | The live system at `https://task.mico360.com` (Hostinger, or any Linux host with Node.js 20+ and MySQL 8) | `MICO360-Tasks-Server-Hostinger-0.4.0.zip` and the live settings file |
| [`2-Windows-Office-Server/`](2-Windows-Office-Server/README.md) | A complete server on one Windows 10/11 computer, for an office network | `MICO360-Tasks-Server-Setup-0.4.0.exe` |
| [`3-Android-App/`](3-Android-App/README.md) | Android 6.0+ phones | `MICO360-Tasks-0.4.0.apk` |
| [`4-Chrome-Extension/`](4-Chrome-Extension/README.md) | Chrome and Edge | `MICO360-Tasks-Chrome-Extension-0.4.0.zip` |

`SHA256SUMS.txt` lists the checksum of every package.

**Every server starts clean:** an empty database and one administrator,
`khurram@prolens-team.com`. There are no test users, projects or tasks, and the demo seed is not in
any package. Everyone else is added from **Users** in the web app.

**Order for going live:** deploy the web server (folder 1) first. The Android app and the Chrome
extension connect to `https://task.mico360.com` by default, so they work as soon as it is up. The
Windows office server (folder 2) is a separate, self-contained system with its own database.

The packages are built from this repository by `node tools/release/build-release.mjs` (web server,
Windows installer, extension) and `bash tools/release/build-apk.sh` (Android). The binaries and the
live settings file are not committed to git; the guides are.

## Upgrading from 0.3.0

Your data is kept. 0.4.0 adds four database migrations. They only add columns, and they are applied
automatically when the new version is deployed:

| Migration | What it adds |
| --- | --- |
| `20261010120000_meeting_attendee_response` | Each attendee's answer (accept / maybe / decline) and when they were invited. People already on a meeting whose invitations went out are marked as invited. |
| `20261010140000_chat_prefs_replies_retries` | Per-person chat settings (favourite, archived, muted, delivered), replies, and a send id so a retried message is never stored twice. |
| `20261010180000_user_date_preferences` | Each person's own time zone and first day of the week (empty = the company's). |
| `20261010200000_project_icon` | A project's icon. |

- **Web server (folder 1):** back up the database first (hPanel → Databases → Backups, or
  `mysqldump`). Then follow "Later updates" in its guide: upload the new `backend/` and
  `public_html/`, keep `.env`, run `bash deploy.sh` and restart.
- **Windows office server (folder 2):** run the new Setup on the same computer.
- **Android app (folder 3):** install it over 0.3.0. It is signed with the same key.
- **Chrome extension (folder 4):** replace the unpacked folder, or upload the new zip to the Chrome
  Web Store.

## What's new in 0.4.0

- **Task details panel (web), redesigned:**
  - Compact: two columns on a computer, one on a phone.
  - Every field is edited in place and shows "Saving…", "Saved" or what went wrong.
  - Edit, reorder and tick checklist steps; ask the AI to suggest steps, then review them before
    anything is added.
  - Drag files in, with upload progress.
  - Pick blockers by searching.
  - A compact activity timeline. It now also records field changes, removed assignees, checklist
    steps, comments, files and blockers.
- **New task and Edit task (web):**
  - One form for both, opened from the board, the task list or "Edit task" in the details panel.
  - Describe the task in plain English, then review the suggested fields before using them.
  - Assignees as chips, and the repeat settings in their own panel.
  - The form remembers the last project.
- **Projects (web):**
  - A new New/Edit project form.
  - Each project has a picture: an uploaded image (cropped in the browser), an icon on its colour,
    or its initials. It is shown on lists, boards, reports and meetings.
  - Project codes are checked as you type.
- **Meetings (web), redesigned:**
  - The list and details pages are compact and work on a phone and right to left.
  - The main button depends on the meeting's status.
  - Attendees answer Accept / Maybe / Decline.
  - Invitations show who will get them first; people added later can be invited without
    re-sending to everyone. Sending to everyone twice is refused.
  - Minutes: preview them, choose the recipients, and get a clearer PDF with tables and a summary.
  - Turning a meeting note into a task also creates its action item.
- **Chat (web), rebuilt:**
  - The conversation list has search, sections, favourites, mute and archive.
  - The header shows who is online.
  - Messages are grouped, with read receipts.
  - Messages can be replied to, copied, reacted to, edited and deleted, with the mouse, the
    keyboard or touch.
  - The message box has emoji, @mentions and drafts. Files upload with progress and can be retried.
  - Messages written offline are kept and sent when the connection is back, never twice.
  - Live updates never show a message twice.
- **Calendar (web), rebuilt:**
  - Month, week and agenda views.
  - Filters are kept across views, and the legend shows status at a glance (red means overdue
    only).
  - Busy days show a list of their tasks, and a task opens in a preview.
  - Reschedule by dragging or with the keyboard, with undo. For a repeating task, choose this copy
    or the whole series.
  - Upcoming repeats are shown before they exist.
  - Settings → "Calendar & dates" holds your own time zone and first day of the week.
- **@mentions:** task comments now suggest people as you type "@", in the web app and the Android
  app. Chat does too. A mention notifies that person.
- **Email-code sign-in:**
  - Web: the code box gets focus, "Resend code" counts down, and a wrong code is easy to retype.
  - Android: "Email code" appears only when the server can send email.
  - The email states how long the code lasts.
- **Download for Android:** the sign-in page's button downloads the site's own APK from one
  unchanging address, `/downloads/MICO360-Tasks.apk`. A new build replaces that file, and the
  button never sends anyone to GitHub. The site package carries the APK in `public_html/downloads/`.
  Until the file is there, the button says "Not available yet".
- **Android app:**
  - @mentions in task comments and chat.
  - The email-code sign-in above.
  - A clear message when a task can't be opened (deleted, no access, offline).
- **Fixes found in testing:**
  - Meeting agenda and action-item rows were squeezed on narrow screens.
  - The meetings filter row wrapped badly.
  - Meeting title links were too small to tap.
  - The calendar now uses the compact month below 1024 px.
  - Menus return focus to their button.
  - Task detail rows wrap at large text sizes.
- **Windows installer:** each program now contains only the code it uses. The launcher no longer
  carries the uninstaller's clean-up code, which Kaspersky's heuristics flagged.

Not in this release: the Android app's chat and calendar, and project pictures in the Android app
and the Chrome extension, are unchanged.

## How these builds were tested (October 2026)

- **Unit and component tests (14 October, on 0.4.0):**
  - backend 1,385 · web 1,024 · Android 424 · extension 207, all passing;
  - typecheck and lint clean in every app;
  - the Android production bundle builds.
- **MySQL 8.0 (14 October):**
  - A fresh database takes all 16 migrations with no schema drift.
  - Prisma integration tests passed 10 of 10.
  - The backend's own lockfile installs cleanly (`npm ci`).
- **Upgrade from 0.3.0, web-server package (14 October):**
  - The 0.3.0 package was deployed with `deploy.sh` on an empty test database, and the acceptance
    test passed 83 of 83 on it. A meeting with sent invitations was added.
  - The 0.4.0 package was deployed over it with the guide's "Later updates" step. It applied the
    four new migrations and nothing else.
  - Every table and row was kept: 46 tables, 97 rows, the same before and after.
  - The two people on the meeting when its invitations went out were marked as invited; the person
    added later was not.
  - The acceptance test passed 83 of 83 on the upgraded server, and its sign-in page loaded.
- **Windows installer 0.4.0 (14 October):**
  - Kaspersky found the launcher, the uninstaller and Setup clean. The build also checks that each
    program is still there afterwards and inside the installer: a first 0.4.0 build lost its
    launcher to real-time protection after a clean scan.
  - Silent install into a test folder: a new database with all 16 migrations and the administrator.
    The acceptance test passed 83 of 83.
  - Running the same Setup again over the running server stopped it, kept the database and restarted
    cleanly. All 47 tables and 115 rows were unchanged, and the acceptance test passed 83 of 83 again.
  - The uninstall removed the program, the data and the Apps & features entry.
  - The 0.3.0 installer couldn't be used to rehearse an upgrade: Kaspersky's current signatures
    detect it, and Windows refused to run it. Don't hand out 0.3.0 any more. The same migrations were
    tested from 0.3.0 with the web-server package (above).
- **Chrome extension 0.4.0:** the zip holds manifest version 0.4.0 and 43 files, with no test
  helpers.
- **Feature tests in a real browser (10 October, desktop and phone):**
  - task form 69 · project form 97 · calendar 64 · meetings 78 · meeting form 30 · chat 90;
  - chat by keyboard and touch 12 · task details 73 + 11 + 31, with no accessibility (axe)
    violations · task details AI 12;
  - email-code sign-in 24 · Download for Android 19;
  - the page crawls and the four end-to-end flows;
  - the live-API lifecycle 15 of 15, and the acceptance test 83 of 83.
- **Chrome extension (10 October):** the board 10 of 10, recurring tasks 15 of 15, reports 20 of 20.
- **Android test build on an Android 14 emulator (10 October):** email-code sign-in 12, task details
  40, task delete 2.
- **Android APK 0.4.0:** not built yet. `bash tools/release/build-apk.sh` needs the release
  keystore's password. Once it is built, the Windows installer and the web-server package are
  rebuilt so both carry it, and `SHA256SUMS.txt` is regenerated.

## What was new in 0.3.0

- **Recurring tasks** in the web app, the Chrome extension and the Android app, all sharing one rule
  on the server, with a database guard against duplicate copies
  ([docs/RECURRING-TASKS.md](../docs/RECURRING-TASKS.md)).
- **Reports and exports:** the full report or any single report as a formatted Excel workbook or a
  branded PDF (or CSV), following the filters on screen; any task can be exported on its own.
- **Android app:** file attachments, project details, notification choices, long-press to move a
  card.
- **Web app:** Privacy and Terms pages, "Download my data", undo after deleting a meeting note.
- **Security:** AI provider requests connect only to the address that was checked, and redirects
  are refused.
- **Deployment:** the backend's own `package-lock.json`, checked in CI.

The full 0.3.0 notes and test results are in git history (commit `524fc8e`).

## What was new in 0.2.0

- All 115 findings from the September 2026 audit fixed; the self-contained Windows server; the Android
  app and Chrome extension can connect to an office-network server; built-in roles on new databases;
  Arabic reading order in the Chrome extension.

## Antivirus note

These programs aren't code-signed yet. Kaspersky's heuristic scanner has flagged unsigned builds of
the launcher as false positives: `VHO:Trojan.Win32.Sdum.gen` in 0.3.0 (the verdict changed with
nothing more than the order of source files) and `VHO:Trojan.Win32.SelfDel.gen` in the first 0.4.0
build (fixed by leaving the uninstaller's clean-up code out of the launcher). The build scans every
program with Kaspersky when it's installed and stops if anything is flagged. For customers, sign the
programs with a code-signing certificate and report false positives to Kaspersky; both make warnings
far less likely.
