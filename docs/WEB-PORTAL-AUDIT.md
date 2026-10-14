# Web portal audit — October 2026

A page-by-page check of the web portal: layout on every screen size, every feature, sign-in
protection and search-engine exclusion, speed, browsers, accessibility, and the loading, empty and
error states. Problems found were fixed and re-tested. An item is ticked only where a test was run
against the fixed build.

- **Build tested:** branch `fix/audit-findings` (0.3.0 plus the changes listed below), the
  production build of the web app served by the API itself.
- **Data:** a throwaway database with the demo data plus stress data (very long titles, an
  unbroken 300-character link, Arabic text, a meeting with many attendees, busy chat channels),
  and a second, empty database for the "nothing here yet" states.
- **Screen sizes:** 320, 375, 414, 600, 768, 900, 1024, 1280, 1440, 1920 and 2560 px wide; dialogs
  also at 480 px tall; phone sizes with touch emulation.
- **Browsers:** Chromium (all checks), Firefox and WebKit — Safari's engine — (layout crawl and
  live connection).
- **Roles:** administrator and employee.

## Checklist

Legend: ✔ tested and passing · ◐ passing, with a note below · — not applicable.

| Page | Layout 320–2560 | Dark theme | Features (click-through) | Loading / empty / error | Keyboard & screen reader | Signed-out / employee access | Not indexed |
|---|---|---|---|---|---|---|---|
| Sign in `/login` | ✔ | ✔ | ✔ | ✔ | ✔ | public | indexable (intended) |
| Forgot password `/forgot` | ✔ | ✔ | ◐ 1 | ✔ | ✔ | public | ✔ |
| Reset password `/reset` | ✔ | ✔ | ◐ 1 | ✔ | ✔ | public | ✔ |
| Privacy `/privacy`, Terms `/terms` | ✔ | ✔ | ✔ | — | ✔ | public | indexable (intended) |
| App shell (top bar, search, bell, account menu, sidebar, phone menu, New Task, sync status) | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Dashboard `/dashboard` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| My Tasks `/my-tasks` (cards and list) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Kanban Board `/board` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Task drawer (`?task=`) | ✔ | ✔ | ◐ 2 | ✔ | ✔ | ✔ | ✔ |
| Projects `/projects` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Project `/projects/:id` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Calendar `/calendar` | ✔ | ✔ | ◐ 3 | ✔ | ✔ | ✔ | ✔ |
| Meetings `/meetings` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Meeting `/meetings/:id` | ✔ | ✔ | ◐ 4 | ✔ | ✔ | ✔ | ✔ |
| My Action Items `/my-action-items` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Chat `/chat` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Activity `/activity` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Notifications `/notifications` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Settings `/settings` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Profile `/profile` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Reports `/reports` (admin) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ admin only | ✔ |
| User Management `/admin/users` | ◐ 5 | ✔ | ✔ | ✔ | ✔ | ✔ admin only | ✔ |
| AI Management `/admin/ai` | ✔ | ✔ | ◐ 6 | ✔ | ✔ | ✔ admin only | ✔ |
| System Settings `/admin/settings` | ✔ | ✔ | ◐ 7 | ✔ | ✔ | ✔ admin only | ✔ |
| Audit Logs `/admin/audit` | ◐ 5 | ✔ | ✔ | ✔ | ✔ | ✔ admin only | ✔ |
| Unknown address | ✔ | — | ✔ (goes to the dashboard, or to sign-in when signed out) | — | — | ✔ | ✔ |

Notes

1. Sending the reset email and the emailed sign-in code could not be exercised: email is not
   configured on the test server. The pages, their validation and every message were checked
   with the server's real "not available" answers.
2. Opening a task by clicking it does not put `?task=` in the address bar (the link only appears
   when a task is opened from search or a notification) — see "For you to decide", item 8. Start
   date and manual progress have no control in the drawer.
3. The calendar shows tasks only; meetings are not on it. Left as it is — see "For you to decide".
4. Action items can be re-assigned and their status changed, but their text and due date cannot
   be edited after creation. "Duplicate" copies the heading only (no agenda or attendees).
5. On a phone the users table and the audit table scroll sideways inside their card (labelled,
   keyboard-reachable). They are wide tables; nothing is cut off, but two columns are not
   visible at once.
6. Model sync and real AI answers need a real provider and were not exercised; failures with a
   made-up provider are reported clearly.
7. "Run carry-forward now" is unavailable while automatic carry-forward is switched off — see
   "For you to decide".

## What was fixed

### Layout and screen sizes
- Long titles and links no longer push cards or the page sideways (dashboard, My Tasks,
  projects, meetings, meeting page, chat).
- Task drawer: its header and Close button stay on screen on a phone; menus that opened
  off-screen on a phone (search results, notifications, export, "not synced" list) now fit.
- Page headings: a row of buttons drops below the title when there is no room, instead of being
  squeezed into a column of two-line buttons (meetings, users, meeting page on tablets).
- Top bar on tablets: the clock and search no longer squeeze each other; on a phone the sync
  indicators shrink to counts so they do not cover the search box.
- Sidebar on short laptop screens: the page you are on is always scrolled into view, and a soft
  shadow shows when more links are below.
- Dialogs: all of them scroll on short screens; **the "New Task" dialog (top bar and My Tasks
  button) opened half above the screen — fixed** by rendering every dialog at page level.
- New Task dialog on short screens (small laptops, phones): "Add task" stays pinned to the
  bottom edge of the dialog instead of waiting below the fold, and the field being typed in is
  always scrolled clear of it.
- Chat on a phone: the list and the conversation now take turns (tapping a conversation used to
  open it below the list, out of sight); the message toolbar stays on screen; long words wrap.
- Dashboard "Due soon" titles get their own line in the narrow column; My Tasks list rows show
  priority and due date on a phone; the calendar filter row fits at 320 px.
- Larger text: breakpoints now follow the reader's default text size, so "very large" browser
  text gets the tablet or phone layout instead of an overlapping desktop one.
- Touch: controls are at least 32 px on touch screens; stand-alone links get a larger hit area.

### Features
- **Chat (from the code review, 7 October):** a direct-message notification can be opened again
  and again from the bell while the chat page is open (the second click used to do nothing); a
  notification about a conversation the page had not seen yet (a first message from someone new)
  now fetches the inbox again and opens it, and one that cannot be found says so instead of doing
  nothing; two messages arriving at the same instant leave one waiting notification, not two.
- **Meeting minutes (7 October):** an action item's due day is taken in the meeting's time zone,
  like every other date in the app, so a due date stored as local midnight is not a day early.
- **Recurring tasks:** the notification for a copy made "on each date" now names the task by key
  ("MICO-123 · Daily site log"), like every other task notification. All copies of a series share
  one title, so the key is what tells them apart.
- **Tasks and board:** keyboard moves into an empty column work, one arrow press per column; the
  "Visible" switch really hides a column; a re-opened task no longer shows 100 %, and ticking the
  checklist moves the card's progress; My Tasks "Open" chip and the "Urgent open" view leave out
  finished work; Sort is available on phones; attachments download under their own names; the
  drawer can remove a checklist item and edit or delete your own comment; Escape closes only the
  open Export menu; refused uploads are explained in plain words.
- **Chat:** delete asks first; web addresses are links; the message box grows; the edit box gets
  the cursor; a file sent without a caption no longer shows an empty bubble.
- **Notifications:** each says which task it is about and when; direct messages give one
  notification per conversation naming the sender, it opens that conversation, it clears when
  the conversation is read, and the bell updates within a couple of seconds.
- **Meetings:** the minutes PDF now includes the meeting's action items (owner, due date,
  status); the same guest cannot be added twice; an end time equal to the start is refused;
  "email isn't set up" is said plainly.
- **Projects:** owner picker and project image are shown only to administrators (the server
  refuses them to anyone else); removing a team member asks first; failures are shown.
- **Reports:** dates typed by hand are no longer scrambled; a start date after the end date gets
  a clear message; single-section exports no longer print an unrelated "trend period" or repeat
  their title; the workload CSV includes the person's name.
- **Admin:** "New user" names the real problem (invalid email vs already in use); AI Management
  shows a message when a change fails; System Settings shows the full status list, visible
  keyboard focus on the chips, and does not offer a run that would do nothing; Audit Logs keeps
  every module in the filter and explains a reversed date range; row buttons name their user.
- **Sign-in and account:** nothing that needs email is offered until the server confirms email
  works; without email, "Forgot password?" is replaced by "ask your administrator"; an expired
  reset link offers a new one; refused profile photos say why; a switch that fails to save says
  so; changing your password on a slow connection no longer signs you out; Settings states the
  real session length.
- **Search:** arrowing down keeps the highlighted row in view; Enter opens the first result even
  if the mouse rests on another; for an employee, choosing a person opens a conversation with
  them (it used to lead nowhere); the shortcut hint reads "Ctrl K" on Windows.
- **Offline:** adding a task while the browser is offline is queued ("1 queued") instead of
  hanging on "Adding…".
- **Phone menu:** it is a proper dialog — Escape and a Close button dismiss it and focus moves
  into it.

### Protection and search engines
- Every signed-in page, the API and uploaded files carry "do not index"; only `/`, `/login`,
  `/privacy` and `/terms` may be indexed. `robots.txt` added. API answers are never cached by
  shared caches. Every page has its own title.
- Verified: 19 private pages redirect a signed-out visitor to sign-in and return there
  afterwards; admin pages turn an employee back; the API refuses each call without a session
  (401) or without the role (403); sign-out removes the session and Back does not reveal a page.

### Speed
- Scripts and styles are sent compressed by the API's own web server (about 810 KB → 220 KB).
- Fonts are bundled with the app instead of fetched from Google Fonts (which stalled pages when
  unreachable); no request goes to another site.
- Logos reduced from 2330 px wide to the size they are shown at.
- One live connection per feature, no longer dropped and re-opened on every page.
- See `PERFORMANCE.md` for the measured numbers.

### Accessibility and consistency
- Colour contrast (light and dark), one visible focus ring, landmarks and heading order, names on
  icon buttons and row actions, scrollable regions reachable by keyboard, charts with text
  alternatives, dialogs that trap and return focus, skip link first. Details in
  `ACCESSIBILITY.md`.
- A button that is busy saving keeps keyboard focus. It used to be switched off while it worked,
  which dropped focus to the page: after a refused save (for example a user name already in use)
  a keyboard user had lost their place in the dialog.
- Chat, dark theme: a mention inside your own message is now readable (contrast was 3.5 : 1).
- Consistent error wording with a Retry button; loading skeletons instead of misleading zeros;
  "not found" pages for a missing project, meeting or task.

## Verified results

All of the following were run against the final build (the last full run finished on
3 October 2026, after the last source change).

**Automated tests** — server 1,274 passing · web app 696 passing · Chrome extension 207 passing ·
Android app 357 passing; type-checks and lint clean for server and web app.

**Every page, every size** (the crawler loads each page and measures: sideways page scroll, text
or controls cut off or off-screen, overlapping text, covered or squeezed controls, small touch
targets, console errors, failed requests, and axe-core accessibility rules):

| Run | Page loads | Problems |
|---|---|---|
| Light theme, admin, 11 widths (320–2560) | 330 | 0 |
| Dark theme, 4 widths | 120 | 0 |
| Employee, 3 widths | 75 | 0 |
| Dialogs, menus, tabs, sub-views, "not found" states — light | 100 | 0 (one best-practice note ¹) |
| The same — dark | 67 | 0 (same note ¹) |
| The same on a 480 px-tall screen | 67 | 0 |
| Firefox, 3 widths | 90 | 0 |
| WebKit (Safari's engine), 3 widths | 90 | 0 |
| Browser text size set to "very large" (24 px), 4 widths | 120 | 0 at 768–1920; at 375 nine button labels wrap onto two lines ² |

¹ The drop-down list of the searchable pickers is drawn at page level, outside the page's
landmarks (axe "region", moderate, best-practice only).
² A 375 px phone with text enlarged by half. Nothing is cut off or overlapping.

**Sign-in protection and search engines** — 23 of 23 checks pass (every API route refuses a
request without a session; admin routes refuse an employee; 19 private pages redirect to
sign-in and come back; sign-out; forged session; `robots.txt`; "noindex" on private pages, the
API and uploads; the public pages stay indexable; every page has its own title).

**Dialogs** — 9 dialogs × 3 window sizes: all inside the window over a fully dimmed page.
**New Task dialog** (both of them, six window sizes from 1366×768 down to 320×480) — "Add task"
is on screen from the moment the dialog opens, the field in use is never under the pinned bar,
nothing shows through beneath it, and "Cancel" is reachable at the end: 60 of 60 checks in
Chromium and in Firefox; 57 of 60 in WebKit ³.
**Keyboard** — 12 dialogs, menus and panels plus the skip link: focus moves in, Tab stays in,
Escape closes, focus returns. After a refused save, focus is still on the dialog's button.
**Chat** — 21 of 21 checks in a real browser (phone layout, long words, toolbar, delete
confirmation, links, growing message box, notifications).
**Live updates** — the connection comes up in Chromium, Firefox and WebKit: three steady
connections, none dropped, no console errors.
**Loading, empty and error states** — with every read delayed, all 20 pages show a loading
indicator; with every read failing, 19 pages show an error with Retry (the profile page reads
nothing); on an empty database each list page says there is nothing yet.
**Speed** (slow connection, cold cache) — sign-in page 748 KB → 306 KB, largest paint 3.2 s →
1.5 s; dashboard 4.7 s → 2.1 s; no requests to other sites.

³ Safari's engine scrolls a little short when moving *backwards* through a form with the
keyboard on a very short screen (560 px tall or less): a field can sit 9 px under the dialog's
top edge. It does the same without the pinned bar; the field stays usable.

**Recurring tasks, created automatically** (re-checked on 6 October 2026 against the final
build, on a test copy of the server whose hourly timer was shortened to 20 seconds; nothing else
changed, the server was not restarted and no app was open):
- the timer fired by itself and made the copies: a daily series with 3 missed days got exactly
  one copy, due today; a weekly series due 8 days ago got one, due yesterday; each copy is open,
  assigned to the same person, carries the repeat, and its assignee got one notification;
- it made nothing for a series due today, a paused series, a series that had ended, a series set
  to "when this one is done", or a series in an archived project — 11 of 11 checks, and the same
  11 again after a second timer run (no duplicates, no second notification);
- in the browser: "Create the next copy: on each date, even if not done" set up from the board's
  New task dialog saves correctly, and with the board left open the copy the timer made appeared
  9 seconds later without a reload — 7 of 7;
- the 25 recurrence scenarios from the 0.3.0 release (every schedule type's next date, endings,
  pause, 5 simultaneous completions → 1 copy, earlier-copy protection, skipping and deleting a
  series) — 25 of 25; completing a task in the drawer made the next copy a week later (workflow
  run above).
In production the timer runs as long as the server does: on Hostinger the 15-minute cron in
`DEPLOY-HOSTINGER.md` step 6 keeps the app awake; the Windows office server runs while its tray
icon is present (choose start-at-sign-in). If the server was off, its first run afterwards
catches up with one copy for the latest missed date.

**The rest of the project** (7 October 2026, same source, after the chat/minutes fixes above):
- **Server:** type-check and lint clean; the migration chain applies to an empty MySQL database
  with no drift against the schema; 10 of 10 database integration tests; the standalone
  deployment lockfile matches package.json; the live end-to-end workflow 15 of 15 and the release
  acceptance test 83 of 83 (sign-in, projects, tasks, recurring tasks, attachments, reports, chat,
  meetings, administration, the web app served by the server).
- **Chrome extension (packaged 0.3.0 = current source):** loads in Chrome, signs in to an office
  server, boards and Arabic names 10 of 10; recurring tasks 15 of 15; reports and exports 20 of
  20. A self-hosted server must list `chrome-extension://*` in `CORS_ORIGINS` (the Windows
  installer does; the live site is covered by the extension's own permissions).
- **Android app (packaged 0.3.0 = current source):** 357 unit tests, type-check and lint clean,
  the production bundle builds; on an emulator against the office-server address it signs in,
  shows Home, My Tasks, Projects, a board, a task's detail (repeat editor, subtasks, files,
  people), Chat, Alerts, Settings, Reports, Calendar and Profile; a task created from its
  quick-add sheet (status, priority, weekly repeat) is saved correctly, and a task created on the
  server appears on its open board within seconds without a refresh.
- **Packages:** the four files under `Installer/` match `SHA256SUMS.txt`; the extension zip and
  the APK were built from the current extension and Android source, the Hostinger zip and the
  Windows installer from the pre-audit server and web app (they need rebuilding — see below).
- **Code review** of this audit's changes (13 findings): six fixed (listed above and in
  "Features"), one not needed, six left as follow-ups — a live update for checklist-driven
  progress on other people's boards, and four tidy-ups (one shared "why it failed" helper, one
  shared confirm-before-remove control, one keep-in-view helper, a dialog footer slot).

**Click-through workflows** — 39 scripts written by four independent testers (sign-in and
account; tasks, board, calendar; projects and meetings; administration and reports), run on a
desktop and a phone size: **1,166 checks pass, 5 do not**. The five are the two open questions
below, not faults: a task opened by a click is not in the address bar (counted on four pages,
"For you to decide" 8), and meetings are not on the calendar (5). Steps that had been written
against the old behaviour (two arrow presses to cross one board column, one-click removal of a
team member, the old wording of messages) were brought in line with the fixed behaviour, so
each still tests something real.

## For you to decide

1. **Release packages.** The folders under `Installer/` still contain the build from before this
   audit. They need rebuilding from this source before deployment (and a version number chosen).
2. **Uploaded files** (attachments, photos) open for anyone who has the exact address, without
   signing in. The addresses are long and random and are never listed or indexed, but they are
   not checked against a session. Requiring sign-in for files is a larger change.
3. **"Run carry-forward now" while automatic carry-forward is off.** The server does nothing in
   that case. The button now says "Switch carry-forward on to run it". Should a manual run work
   regardless of the switch?
4. **Project managers** cannot change a project's owner or image (administrators only on the
   server). The controls are now hidden from managers. Should managers be allowed instead?
5. **Calendar:** should meetings appear on it alongside tasks?
6. **Which pages search engines may list:** currently the site root, sign-in, privacy and terms.
7. **Shared hosting (`.htaccess`)**: the "do not index" rule for Hostinger could not be tested
   on this machine; check one private address there after deployment
   (`curl -I https://task.mico360.com/dashboard` should show `X-Robots-Tag: noindex, nofollow`).
8. **A task opened by clicking it is not in the address bar** (only tasks opened from search, a
   notification or a meeting are). So the address cannot be copied as a link to that task, a
   reload closes it, and on a phone the Back button leaves the page instead of closing the task.
   Putting every opened task in the address changes how Back behaves on the board, My Tasks,
   the dashboard and the calendar — should it?

## Smaller items left as they are

- Clicking outside a "New …" dialog closes it and discards what was typed.
- Removing a task attachment and archiving a project happen at once, without a confirmation
  (archiving can be undone).
- The chat page does not remember the open conversation after a reload.
- Meeting action items cannot be edited after creation; "Duplicate" copies the heading only.
- Employees typing an admin address are returned to the dashboard without a message.
- A very large profile photo is stored and served at full size.
- Tasks created by the demo seed without a board day do not appear on the board (demo data only;
  an upgraded database needs `scripts/backfill-board-date.ts`).

## Re-running the checks

The tools live outside the repository in `D:/mico-release/audit-tools` (Playwright + axe-core).
With MySQL and the two audit servers running (`api-audit` on 4000, `api-audit-empty` on 4001):

```bash
bash final-battery.sh quick    # dialogs, keyboard, chat, live connection, protection, states, speed, late fixes
bash final-battery.sh crawls   # every page at every width, themes, roles, Firefox, WebKit, large text
bash final-battery.sh flows    # the click-through workflow scripts
```
