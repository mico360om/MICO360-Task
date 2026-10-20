# MICO360 Tasks 1.0.1 — ready to deploy

1.0.0 is the first release with version tracking: every page shows the version and when it was last
updated, and **About** lists what each release changed ([CHANGELOG.md](../CHANGELOG.md),
[docs/RELEASES.md](../docs/RELEASES.md)). It includes all the work prepared as 0.4.0. The packages
in these folders are rebuilt as 1.0.1 together with the Android app (see "Android APK" below).
1.0.1 fixes the deployment from GitHub: the build tools are installed even where the server is
set up as production (see [CHANGELOG.md](../CHANGELOG.md)).

One folder for each place the system installs. Each folder holds the package for that place and a
`README.md` with the steps.

| Folder | Environment | Package |
| --- | --- | --- |
| [`1-Hostinger-Web-Server/`](1-Hostinger-Web-Server/README.md) | The live system at `https://task.mico360.com` (Hostinger, or any Linux host with Node.js 22, or 20.19 or later, and MySQL 8) | `MICO360-Tasks-Server-Hostinger-1.0.1.zip` and the live settings file |
| [`2-Windows-Office-Server/`](2-Windows-Office-Server/README.md) | A complete server on one Windows 10/11 computer, for an office network | `MICO360-Tasks-Server-Setup-1.0.1.exe` |
| [`3-Android-App/`](3-Android-App/README.md) | Android 6.0+ phones | `MICO360-Tasks-1.0.1.apk` |
| [`4-Chrome-Extension/`](4-Chrome-Extension/README.md) | Chrome and Edge | `MICO360-Tasks-Chrome-Extension-1.0.1.zip` |

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

## Upgrading from 0.3.0 or 0.4.0

Your data is kept. Since 0.3.0 there are six database migrations (the last two came after 0.4.0).
They only add columns and tables, and they are applied automatically when the new version is deployed:

| Migration | What it adds |
| --- | --- |
| `20261010120000_meeting_attendee_response` | Each attendee's answer (accept / maybe / decline) and when they were invited. People already on a meeting whose invitations went out are marked as invited. |
| `20261010140000_chat_prefs_replies_retries` | Per-person chat settings (favourite, archived, muted, delivered), replies, and a send id so a retried message is never stored twice. |
| `20261010180000_user_date_preferences` | Each person's own time zone and first day of the week (empty = the company's). |
| `20261010200000_project_icon` | A project's icon. |
| `20261016120000_project_number` | A project's own number (e.g. the client's job number). |
| `20261016140000_meeting_series_milestones` | Repeating meetings (each meeting's place in its series) and the milestone flag on tasks. |

- **Web server (folder 1):** back up the database first (hPanel → Databases → Backups, or
  `mysqldump`). Then follow "Later updates" in its guide: upload the new `backend/` and
  `public_html/`, keep `.env`, run `bash deploy.sh` and restart.
- **Windows office server (folder 2):** run the new Setup on the same computer.
- **Android app (folder 3):** install it over 0.3.0 or 0.4.0. It is signed with the same key.
- **Chrome extension (folder 4):** replace the unpacked folder, or upload the new zip to the Chrome
  Web Store.

## What's new in 1.0.0

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
- **Typing on a phone (web app and Android app):** the on-screen keyboard no longer hides what
  you are typing into.
  - When a field is focused and the keyboard opens, the screen scrolls so the field is above the
    keyboard with some room, together with its label, any hint or error, and the buttons that go
    with it (Save, Send, Sign in…). When the field and its buttons can't both fit, the field comes
    first.
  - Pop-up forms end at the keyboard, and their fields scroll while the buttons stay in view.
    New/Edit meeting, New user and Create task from note now have a button bar like New task.
  - On iPhone, where the browser doesn't shrink the page for the keyboard, pop-ups and the chat now
    fit into the part of the screen that is left.
  - With a phone held sideways, the keyboard leaves very little room. Pop-ups and the task panel
    then scroll as one piece and the top bar scrolls away, so the field itself always has room.
  - In the Android app's chat, the newest message stays in view when the keyboard opens.
  - When the keyboard closes, everything returns to its full size and the field stays in view.
- **AI Management:** connecting an AI service needs only its key, and its models load by
  themselves.
  - Pick the service: OpenAI, Anthropic (Claude), Google Gemini, OpenRouter, Groq, Mistral,
    DeepSeek, MICO360 AI (our own platform — see `docs/AI-MICO360.md`), Ollama, or any other
    OpenAI-compatible one. Its name and address fill themselves in.
    A key the service refuses is not saved.
  - The model list loads on connecting and is checked again every day. New models appear switched
    off; models the service retires are marked Unavailable. Image, speech and moderation models are
    left out, and each model shows its proper name and what it can do (chat, vision, embeddings).
  - When a service is first connected, its recommended chat model is switched on, so the AI
    features work straight away.
  - Each service's models can be searched and filtered. Switched-on and recommended models come
    first; the rest fold away. **Test** sends a model a tiny question and shows how fast it
    answered, or the service's own reason it didn't.
  - Default models start on **Automatic**: the recommended switched-on model, fast ones first
    (Claude Haiku, GPT mini, Gemini Flash). If that model goes away, Automatic moves to the next one
    by itself. The AI features now use it, instead of whichever model happened to be listed first.
  - GPT-5 and the o-series models now work: they need different request settings.
- **"Describe it in plain English" (New task)** now also suggests:
  - a **description**: details the note gives beyond the title;
  - a **repeat**, when the note says the task repeats (e.g. "every Monday");
  - the **project**: one whose number or code is written in the note, else the one the AI
    recognises, only ever among the projects you can add tasks to.

  As before, each suggestion has a tick box, and one that would replace something you set yourself
  starts unticked.
- **Project number:** projects have an optional number beside their code (e.g. the client's job
  or contract number, up to 40 characters). It is set in the New/Edit project form, shows on the
  project page and its card, and appears in the minutes PDF.
- **Minutes of meeting PDF:**
  - A project meeting's minutes open with the project's picture (or its initials on its colour),
    its name, code and number. A meeting without a project keeps the MICO360 logo.
  - A badge says WORKING DRAFT or FINAL.
  - The meeting details sit in two columns, and risks and open issues get their own section.
  - The minutes end with the next steps: the open action items, soonest first, with their owners.
  - New project pictures are saved as JPEG, or as PNG when they have transparency, so they print.
    Older WebP pictures show the initials until they are replaced.
- **Final minutes (Final MOM):** a new card on the meeting page.
  - The organizer starts from a draft, written by the AI from the meeting's agenda, notes and
    action items (or "Start from the notes" without AI). The draft has a summary, the discussion
    under each agenda item, the decisions, risks and open issues, and next steps.
  - They edit it, save it, and **Mark as final**, which records who approved it and when.
  - Final minutes are read-only until reopened. Attendees see them once they are final.
  - **Export final minutes (PDF)** prints them, badged FINAL with the approval. Once they are
    final, **Email minutes** sends the final version.
- **Contact address:** info@mico360.com replaces support@mico360.com everywhere: the sign-in page,
  the Privacy and Terms pages, and the footer of emails and PDFs (the server's `SUPPORT_EMAIL`).
- **Repeating meetings:** the New Meeting form has a **Repeat** option.
  - Daily, weekly on chosen days, monthly (a day of the month or "the 2nd Tuesday"), quarterly or
    yearly, every N days/weeks/months. A series can end never, after a number of meetings or on a
    date.
  - Each meeting of a series is a real meeting, with its own agenda, notes, minutes and action items.
    About the next three months (at most 26) are created, and a server job keeps them topped up.
  - Editing, cancelling or deleting a meeting of a series asks: **This meeting only** or **All
    upcoming meetings in the series**. Meetings already held are never changed, and people added
    to a series meeting join its later meetings too.
  - Invitations carry the whole series to people's calendars, and each change updates just what
    changed (one date, or the series). See [docs/RECURRING-MEETINGS.md](../docs/RECURRING-MEETINGS.md).
  - Meetings now show in the **Calendar**, beside the tasks due, with a "Show meetings" filter.
- **Project dashboard:** the project page has four tabs, all for that project only.
  - **Overview:** details and timeline (work done against time gone), milestones, deadlines in the
    next two weeks, the project manager, team and who has what, the next meeting, and tasks by
    status.
  - **Tasks:** ongoing, pending, overdue, completed or milestone tasks, with priority, people,
    progress and due date.
  - **Meetings:** upcoming, under way, held and cancelled meetings, with attendees and minutes, and
    the project's decisions, action items and repeating meetings.
  - **Team.**

  It updates live as people change the project's tasks and meetings, and it works on phones.
- **Milestones:** tick **Milestone** in the task form to mark a key date or deliverable. Milestones
  carry a flag on the board and in the task panel, and the project dashboard lists them.
- **Fixes found in testing:**
  - Meeting agenda and action-item rows were squeezed on narrow screens.
  - The meetings filter row wrapped badly.
  - Meeting title links were too small to tap.
  - The calendar now uses the compact month below 1024 px.
  - Menus return focus to their button.
  - Task detail rows wrap at large text sizes.
- **Version and release tracking:**
  - Every signed-in page's footer shows the version and when the running copy was last updated
    (deployed), in Oman time: `Version: v1.0.0 | Last Updated: 16/10/2026, 08:17 PM (Oman Time)`.
    Both come from the build, never from the browser.
  - **About and version history** (footer, profile menu or search) lists each release's new
    features, improvements and bug fixes. Admins also see its security fixes and what is deployed:
    the server and web app builds, the code revision, and whether the two match.
  - A page left open across a deployment says "A new version is available" and offers to reload.
    The server serves a rebuilt web app at once, even without a restart.
  - One version for the server, web app, Android app and extension. `npm run release` sets it
    everywhere from CHANGELOG.md, and a test fails if anything drifts.
- **Keyboard shortcuts (web app):**
  - Anywhere: Ctrl+S saves and Ctrl+Enter submits the form or dialog you're in, Esc cancels, and
    Ctrl+K searches.
  - On a page: N adds new (a task, project, meeting or user, depending on the page), E edits and
    Delete deletes the open task, meeting or project (always asking first), R refreshes, and /
    jumps to the page's search box.
  - Ctrl+/ (or ?) shows the list, which can also switch the single keys off.
  - Buttons show their shortcut in their tooltip and to screen readers; dialogs' main buttons and
    menu items show the keys.
  - On a Mac it's ⌘, the keys work with the Arabic layout, and no browser shortcut is taken over.
    See [docs/KEYBOARD-SHORTCUTS.md](../docs/KEYBOARD-SHORTCUTS.md).
- **Android app:**
  - A project's screen shows its project number, its milestones (done, late, or how many days
    left), what's late or due in the next two weeks, and its meetings: the next ones, its repeating
    series, open action items and recent decisions.
  - The calendar shows meetings beside the tasks due, with their times, place and a 🔁 mark for
    repeating ones; tap one for its notes and **Join online meeting**. It opens at today.
  - Mark a task as a milestone in its details (**Milestone** switch); task lists show a 🏁 flag.
  - Meetings stay read-only in the app; they're planned and run in the web portal.
- **Windows installer:** each program now contains only the code it uses. The launcher no longer
  carries the uninstaller's clean-up code, which Kaspersky's heuristics flagged.

Not in this release: the Android app's chat, and project pictures in the Android app and the
Chrome extension, are unchanged.

## How these builds were tested (October 2026)

- **Unit and component tests (16 October, on 0.4.0):**
  - backend 1,635 · web 1,190 · Android 456 · extension 207, all passing. The log-out test with
    unsynced offline changes had failed only while a local server was running on port 4000 (the
    test's live-update socket reached it); it now has a stand-in socket;
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
- **Typing above the on-screen keyboard (15 October):** tested on an Android emulator with its real
  keyboard, on a small phone (360 × 640), a regular phone, a tablet and a phone held sideways.
  - **Web app, in Chrome:**
    - sign-in, New meeting, New project, New task, New user, a task comment, chat and a meeting's
      agenda;
    - each field was tapped and measured;
    - the same checks ran a second time with the keyboard laid over the page the way iPhone Safari
      does it;
    - 611 checks across the four screen sizes, none failed. Each field and its buttons were above
      the keyboard and not covered, every pop-up stayed on screen, and the screen returned to full
      size afterwards;
    - the browser tests for the forms that changed still pass: meeting form 30, meetings 78, task
      form 69, project form 97, chat 90, chat by keyboard and touch 12, task panel 73;
    - every pop-up still sits inside the window at phone and short-laptop sizes.
  - **Android app, before the fix (small phone):** 14 failures. Fields sat flush against the
    keyboard, and Sign in, Use this server, Save and Save tags were under it.
  - **Android app, after the fix:** 46 of 46 on each of the small phone, the regular phone and the
    tablet, covering:
    - sign-in (server address, password) and forgot password;
    - a task's title, description, checklist, tags and comment;
    - the New task sheet;
    - chat.

    The tablet run found one more bug, now fixed: the New task sheet adjusted for the keyboard
    twice, and the second time it was opened its buttons ended up under the keyboard.
  - Every screen returned to full height when the keyboard closed.
- **AI Management (16 October), in a real browser:** 46 of 46 checks, with stand-in OpenAI and
  Anthropic services and the real Ollama on the test computer.
  - Connecting with only a key; a refused key isn't saved.
  - Models loading by themselves: all 23 of Claude's, not just the first 20, and no image or speech
    models. The recommended model is switched on.
  - Search, filters and "Show more"; Test on a quick model, on GPT-5 and on a refusal; the real
    Llama answering.
  - Automatic and a chosen default; the AI features using the automatic model.
  - Refresh finding new and retired models, and a service that is down.
  - Desktop, phone and dark mode, with no accessibility (axe) violations and no console errors.
  - The task panel's AI buttons still pass: 12 of 12 with a stand-in, 11 of 11 with the real Llama.
- **Describe a task, project number, minutes PDF and Final MOM (16 October), in a real browser:**
  40 of 40 checks, with a stand-in AI and the real Llama on the test computer.
  - The contact links say info@mico360.com.
  - A project created with a number shows it on its card and its page.
  - A plain-English note fills in the description, a weekly repeat and the project named by its
    code, and the task is created with all of them.
  - The working minutes PDF opens with the project's picture, code and number.
  - Final MOM: AI draft → edit → save (kept across a reload) → mark final → final PDF (named and
    badged final, with the approval) → reopen → start again from the notes.
  - An attendee sees the final minutes read-only, and the server refuses their edits.
  - Phone width and an accessibility (axe) scan pass. The real Llama drafts final minutes from
    the meeting's facts in about 5 seconds.
  - The browser tests for the forms that changed still pass: task form 69, project form 97,
    meetings 78.
- **Review and fixes (16 October, before release):** three independent code reviews of the repeating
  meetings, invitations and dashboard found about 25 problems. All are fixed, each with a test:
  - changing a series to new days (e.g. every other week) could clash with its own meetings and fail;
  - a meeting deleted or cancelled on its own let later meetings slide into its date;
  - moving a Tuesday series to Thursday stayed on Tuesdays;
  - a refused change could leave the series ended;
  - the first meeting could fall outside the repeat's days (Outlook then dropped it). It now moves
    to the first chosen day, and the form says so;
  - repeating meetings made before this version, cancelled or deleted, would have come back;
  - someone running one meeting could change the whole series;
  - invitations: the series now uses its own details, single-meeting updates go only to people who
    have the series, update numbers always rise, every time zone used is described, a yearly
    meeting on 29 February stays on the 28th in other years, and a person taken off a series is
    told they're off it;
  - calendars kept an old series when one whose first meeting was deleted got a new schedule;
  - the dashboard missed series that started long ago, cut off upcoming meetings on busy projects,
    and refreshed once per meeting when a whole series changed;
  - the form: a meeting after its series' end date couldn't be saved on its own, picking the same
    repeat again lost its days, a save without changes emailed everyone, and changes made by
    someone else while the form was open could be overwritten.
  - A second browser test of edge cases (a London clock change, deleting the first meeting, a past
    meeting, the 31st, "Does not repeat", people taken off, duplicating, access, and the fixes
    above): 36 of 36.
- **Second review (16 October):** a fourth review of those fixes found more, now fixed with tests:
  - a new time or length for a series could push every meeting a week late when the first one's
    new time had already passed today, or one had been postponed on its own; each meeting now keeps
    its day;
  - a yearly or quarterly series whose only meeting so far was cancelled on its own stopped;
  - moving a monthly series to another date picked the wrong day ("day 31", or the wrong week for
    "the 2nd Tuesday"), and a meeting moved on its own moved the series by the wrong number of days;
  - a series handed to someone else, or moved to another project, couldn't be changed by them;
  - a meeting deleted on its own could become the first meeting of a split series, and the
    "series ended" notice missed people added to later meetings;
  - the form's first-day hint and end-date check ignored a count or end date; moving the first
    meeting onto the repeat's days kept a sent reminder and didn't refresh other screens;
  - editing a cancelled meeting's details for the whole series sent a cancellation.
  - Checked again in the browser: repeating meetings 53, edge cases 36, meetings 78, calendar 64;
    and on the real database (API) 15 of 15.
- **Keyboard shortcuts, tested (16 October):** a browser test of every shortcut in every module,
  33 of 33. It covers the Arabic layout, a Mac, a phone, single keys switched off and an
  accessibility check of the key hints. The forms, meetings and calendar tests still pass: task
  form 69, project form 97, meetings 78, calendar 64.
- **Version tracking, tested (16 October):** a browser test of the footer on ten pages (computer and
  phone), the About page as admin and as a regular user, a stale copy, and a real redeployment that
  an open page notices, with the new build time shown after reloading: 21 of 21. Chat 90, shortcuts
  33 and meetings 78 still pass.
- **Repeating meetings and the project dashboard (16 October), in a real browser:** 53 of 53
  checks, against MySQL, with invitation emails and calendar files in the test mailbox.
  - A weekly Tue/Thu series with an end date made in the New Meeting form: every meeting is
    created at 10:00 company time, and the meeting page says how it repeats.
  - People added to the first meeting join the later ones. The series invitation is one calendar
    entry with its rule.
  - One meeting changed (another room): only it changes, and invitees get an update for that date.
  - The series renamed, then moved to 11:00: every upcoming meeting follows, keeping its id, and
    the meeting changed on its own keeps its room.
  - One meeting cancelled: only it, and calendars drop just that date.
  - The series cancelled: every upcoming meeting, and calendars drop the series. It stops.
  - The calendar shows the meetings (month and agenda), and each opens its page.
  - The project dashboard's overview, milestones, tasks and meetings tabs.
  - Live updates: a milestone and a meeting added by another person appear without reloading.
  - A daily series without an end keeps 26 meetings ready. A monthly series ("2nd Tuesday",
    3 times) makes 3.
  - Phone width with no sideways scrolling, an accessibility (axe) scan, and no console errors.
  - Re-run and passing: meetings 78, calendar 64, task form 69, project form 97. The calendar
    test now centres each drop target before dragging: on today's dates the target fell at the
    bottom edge and the drop missed.
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
- **Android APK 1.0.1 (build 6):** not built yet. `bash tools/release/build-apk.sh` needs the release
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
