# MICO360 Tasks 0.3.0 — ready to deploy

One folder for each place the system installs. Each folder holds the package for that place and a
`README.md` with the steps.

| Folder | Environment | Package |
| --- | --- | --- |
| [`1-Hostinger-Web-Server/`](1-Hostinger-Web-Server/README.md) | The live system at `https://task.mico360.com` (Hostinger, or any Linux host with Node.js 20+ and MySQL 8) | `MICO360-Tasks-Server-Hostinger-0.3.0.zip` and the live settings file |
| [`2-Windows-Office-Server/`](2-Windows-Office-Server/README.md) | A complete server on one Windows 10/11 computer, for an office network | `MICO360-Tasks-Server-Setup-0.3.0.exe` |
| [`3-Android-App/`](3-Android-App/README.md) | Android 6.0+ phones | `MICO360-Tasks-0.3.0.apk` |
| [`4-Chrome-Extension/`](4-Chrome-Extension/README.md) | Chrome and Edge | `MICO360-Tasks-Chrome-Extension-0.3.0.zip` |

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

## What's new in 0.3.0

- **Recurring tasks, everywhere:**
  - Set a repeat when creating a task, or later, in the web app, the Chrome extension or the Android
    app. All three share one rule on the server.
  - Schedules: daily; weekly on chosen days; monthly or quarterly on a date or on "the 2nd Tuesday" /
    "the last Friday"; yearly. Every N periods; ends never, after N tasks or on a date; pause and
    resume.
  - The next copy is made when the task is done (never already overdue), or on each due date even if
    it isn't done. It keeps the details, assignees, watchers, tags and checklist.
  - No duplicates: the database allows one next copy per task, even when it is completed from
    several apps at once.
  - Deleting just the newest copy skips it, and the series carries on.
  - Full guide: [docs/RECURRING-TASKS.md](../docs/RECURRING-TASKS.md).
- **Reports and exports, everywhere:**
  - Export the **full report** (summary, status, projects, team workload, trend and every task) or a
    single report as a formatted **Excel** workbook or a **PDF** in the MICO360 style: logo, brand
    colours and fonts, page numbers, tables that continue across pages with their headers. CSV too.
  - Exports follow the filters on screen: project, team member and period. The file name says so,
    e.g. `tasks-report-rig-inspection-portal-2026-10-01.pdf`.
  - Any task can be exported on its own (details, checklist, comments, files, dependencies and
    history), by anyone who can open it.
  - The Chrome extension and the Android app have a **Reports** screen for administrators, and an
    **Export** button on each task. On the phone the file opens in the share sheet: open it in Excel
    or a PDF viewer, or save it to Files or Drive.
- **Android app:**
  - Attach files to tasks from the phone, then open or remove them.
  - A **Details** screen for each project: progress, dates, team and managers, and shortcuts to the
    board and chat.
  - Choose which notifications you get and when "due soon" reminders arrive (shared with the web app).
  - Long-press a card on the board to move it to another column.
  - Privacy policy and terms links.
- **Web app:**
  - Public **Privacy** and **Terms** pages. The sign-in page's links to them were dead before.
  - **Download my data** on the Profile page.
  - **Undo** after deleting a meeting note: notes are now kept on the server and can be restored.
  - The **Download for Android** button works: it points to the server's own APK, the configured
    `ANDROID_APP_URL`, or the latest GitHub release.
- **Security:**
  - AI provider requests connect to the address that was checked, so a DNS answer that changes
    between the check and the connection can't reach an internal server.
  - Redirects from AI providers are refused.
- **Data repair:** a migration gives older projects that have no board columns the default board.
- **Deployment:** the backend's own `package-lock.json` is now in the repository, so deploying from
  git installs exactly the tested versions. CI checks that it stays in sync.

## What was new in 0.2.0

- All 115 findings from the September 2026 audit fixed; the self-contained Windows server; the Android
  app and Chrome extension can connect to an office-network server; built-in roles on new databases;
  Arabic reading order in the Chrome extension.

## How these builds were tested (1 October 2026)

- **Unit and component tests:** backend 1,229 · web 528 · Android 357 · extension 207, all passing,
  with typecheck and lint clean. A test fails if the web or Android copy of the recurrence code ever
  differs from the server's.
- **MySQL 8.0:**
  - A fresh database takes all 12 migrations with no schema drift.
  - The seeded development database took the new ones, and the repair migration fixed its 8
    existing series.
  - Prisma integration tests passed 10 of 10. They include:
    - three simultaneous completions of one task making exactly one copy;
    - an on-schedule series making one copy per date however often its job runs;
    - archived and completed projects making no more copies.
  - The end-to-end workflow passed 15 of 15.
- **Windows installer 0.3.0:**
  - Silent install; Kaspersky found all three programs clean.
  - `tools/release/verify-server.mjs` passed 85 of 85. That adds 22 recurring-task checks and 8
    export checks (below). The recurring-task checks cover:
    - the next copy's date, details, assignees, tags and unticked checklist;
    - no second copy when the old one is completed again, or by three apps at once;
    - "the last Friday", and "the 20th" for a task due on the 10th;
    - an earlier copy can't start a second series;
    - the newest copy can switch its repeat off and on again;
    - skip on delete, and deleting the entire series.
  - The bundled Android app is byte-identical to the APK here.
  - The uninstall removed everything.
- **Hostinger package:**
  - Clean extract, then `deploy.sh`: `npm ci` from its lockfile (307 packages), 12 migrations on a
    fresh database with no drift, and the first administrator created.
  - `npm ci` installs from the refreshed backend lockfile, which now includes the PDF fonts.
  - The acceptance test passed 83 of 83.
- **API scenarios** (25 of 25): next due dates for daily, weekly (chosen days, every 2 weeks),
  monthly (a date, the last day, "the 2nd Tuesday", "the last Friday"), quarterly and yearly, early
  and late completion, "after N", "until", pause, five simultaneous completions, and re-enabling.
- **On-schedule repeats** (local server): a daily series that was three days behind got exactly one
  copy dated today. Running the job again made none.
- **Web app** (browser):
  - Created "monthly on the last Friday" from the board. The editor previewed Nov 27 · Dec 25 · Jan 29.
  - Completing it showed the next copy, due 27 Nov, still assigned.
  - The completed task is shown as part of its series.
  - The New task dialog now scrolls on short screens.
- **Chrome extension 0.3.0** (the zip), 11 of 11 checks:
  - set a weekly repeat on Sunday and Thursday in the task drawer;
  - the card shows the repeat icon;
  - dragging it to Done made exactly one copy, on the next Sunday, and the board showed it.
- **Android APK 0.3.0** on an Android 14 emulator:
  - Set a weekly repeat in task details, completed the task, and got one copy on the next Sunday.
  - Created a monthly repeating task from the board and switched it to "the last Friday".
  - A copy made from outside the phone appeared live.
  - A completion made **offline** synced on reconnect and made exactly one copy.
  - The series stayed one task per date, with one rule.

### Reports and exports (1 October 2026)

- **Acceptance test, 8 export checks** (Windows install and Hostinger deploy):
  - the full report as `.xlsx`: a sheet per section, the project filter applied, Arabic intact,
    named after its filter;
  - the full report as a PDF with the logo;
  - a task as `.xlsx` and as PDF, by its assignee;
  - employees can't export reports (403), and an unknown task can't be exported (404).
- **Files checked with PyMuPDF and openpyxl:**
  - No PDF text falls outside the page or under the footer.
  - The brand fonts are embedded: Archivo, IBM Plex Sans, Noto Naskh Arabic.
  - Workbooks have bold, frozen headers and sized columns.
  - Filtered files hold only the filtered rows: 223 of 312 tasks for one project; 7 trend days for a
    7-day period.
- **Web app** (browser):
  - The Reports page exported the project-filtered full report as Excel and PDF, named
    `tasks-report-rig-inspection-portal-2026-10-01.*`.
  - The task drawer's Export menu downloaded a task with an Arabic title as PDF and Excel.
- **Chrome extension**, 20 of 20 checks:
  - Reports appears only for administrators.
  - Totals, tables and the period chart appear.
  - Full-report and filtered exports work in Excel, PDF and CSV.
  - Task exports work as Excel and PDF.
  - An employee is told reports are for administrators.
  - No script errors.
- **Android APK** on an Android 14 emulator:
  - Reports appears only in an administrator's menu.
  - Filtering by project showed its 11 tasks.
  - Excel, PDF and CSV exports opened the share sheet under the server's file names.
  - The PDF rendered in Android's print preview: 4 pages with the logo, tables and page numbers.
  - Task export worked as PDF and Excel.

### Antivirus note

These programs aren't code-signed yet. During testing, Kaspersky's heuristic scanner flagged one build
of the launcher as `VHO:Trojan.Win32.Sdum.gen`, a false positive that changed with nothing more than
the order of source files. The build now scans every program with Kaspersky when it's installed and
stops if anything is flagged. For customers, sign the programs with a code-signing certificate and
report the false positive to Kaspersky; both make warnings far less likely.
