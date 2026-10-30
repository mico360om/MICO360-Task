# Android app: catch up with the website 1.19.0 — design

Date: 31 Oct 2026. Owner: MICO360 (decisions taken one by one in the question box, 30–31 Oct).
Gap analysis this rests on: `2026-10-31-android-app-parity-1-19-gap.md` (same folder; three read-only reviews of `D:/mico-release/wt-i119`, branch integrate/1.19.0).

## 1. Intent and why

The Android app (Expo SDK 51 / React Native 0.74, folder `Android App/`) last caught up with the website at release 1.11.0 (24 Oct). Since then the website shipped 1.12–1.19: Timeline, Workload, MICO AI, welcome emails, a design pass, employees creating projects, the client page, templates, inspection checklists, scheduled inspections, the Management page, task approvals and a new design. The app got only wording copies. The owner asked: "analyze the web version and do the same for mobile app — design and all other things".

Success = a person who uses the website and the phone sees the same product: same look, same words, same numbers, and can do on the phone what they do on the website (except the admin/editor pages listed in §4), including carrying on an inspection on site without signal.

## 2. Owner decisions (verbatim choices)

1. **Scope: "Everything, in stages."** Stage 1 new look + bug fixes → Stage 2 daily work (approvals, move task, dashboard, projects, meetings, dates) → Stage 3 Timeline, Workload, Management, MICO AI → Stage 4 inspections, templates, client sharing. "Editing templates/inspection forms and admin settings stay on the website with a link."
2. **Inspections: "Fill in, works offline."** Open the project's check, answer each line, sign with a finger; kept on the phone and sent when the signal is back. Creating/editing inspection forms stays on the website. (Matches the owner's 27 Oct decision "offline on the phone — website now, app later".) Inspections always belong to a project (its Inspections tab, or a task with a form).
3. **Look: "Website look, white top bar."** White (surface) top bar with the logo, search and bell; drawn icons (no emoji); the website's fonts, buttons, badges, cards, colours and dark mode; the "Welcome back" band and the website's 4 Dashboard tiles; dates "30 Oct 2026". (Mockup shown 31 Oct: alerts move to a bell in the top bar; bottom tabs Dashboard, My Tasks, Projects, Meetings, Chat.)
4. **Releases: "Build all, release once the PC is clean."** Build and test all 4 stages now with test copies on the emulator; nothing published. When the owner's PC is clean, the owner types the keystore password once and ONE new app version ships with everything.
5. **Offline start: "Start needs signal."** As on the website: Start needs a connection (e.g. tap Start before leaving the office). After that every answer, signature, follow-up and the finish work with no signal. The phone also keeps copies of the project's due-checks list and of inspections already started/opened, so they open offline. No server change.

Earlier decisions still in force: System Settings, AI Management and the Audit log stay on the website with "Open on the website" (20 Oct); User Management is in the app (20 Oct); no time tracking or billing (27 Oct); one SemVer version for all parts, CHANGELOG via `tools/release/release.mjs`; "MICO360" wording and initials rules as on the website; publishing is PAUSED (malware on the PC) — no push, no tag push, no APK upload.

## 3. Goals

**Stage 1 — new look + bug fixes (everything else builds on it)**
- Tokens: `Android App/src/lib/theme.ts` etc. take the website's light AND dark values from `Web Portal/frontend/tailwind.config.js` + `src/index.css` (brand, brand-2/3, brand-ink, brand-as-text, ink/ink-2/ink-3 #736965, line/line-2, surface/surface-2, ground/ground-2, status fills + status TEXT tones, category colours, meeting colour, one 0.5 scrim, radii card 18 / button 14 / input 8 / badge 6, soft shadows, brand gradient).
- Fonts: IBM Plex Sans (body) + Archivo (titles, numbers), the same fonts the website bundles; tabular numbers for figures.
- Icons: drawn icons from the website's own SVG paths (sidebar icons, meeting kit icons, project icons) — no emoji anywhere (tabs, drawer, cards, project avatars, empty states).
- Primitives as on the website: Button (gradient primary, neutral secondary, ghost, danger; sizes), Card, Badge (radius 6, uppercase, optional dot), PriorityBadge (Normal neutral), one shared Avatar, ProjectAvatar with drawn icons, Toggle, Field with focus/error, EmptyState with icon + action, skeleton placeholders, StatTile, selected chip (brand fill, white text), progress bar in the project colour, ApprovalChip, BrandLogo per theme.
- Frame: white top bar (logo, search, bell with unread count), page title in the content; drawer grouped like the website sidebar (Workspace / Communication / Admin) with the logo and a gradient active row; bottom tabs Dashboard, My Tasks, Projects, Meetings, Chat with drawn icons; website labels ("Dashboard", "Notifications").
- Dates and times: one copy of the website's `lib/day-words.ts` ("30 Oct 2026", "Fri 30 Oct", 24-hour "09:05", "Sep" never "Sept") with a drift test, used by every date/time the app shows (the ~13 places in the gap analysis), never the phone's locale. The company week start from `/config` when the person has no own choice.
- Bug fixes: Search → Timeline/Workload/Management/Templates/MICO AI does nothing (fixed for real by Stage 3 screens; until then they must at least open the website); Management in Search for project runners, not only admins; waiting-for-approval tasks never counted late/overdue in any app count (copy of `isTaskLate`); a move into Done that becomes "Waiting for approval" says so and isn't shown as done; email-code sign-in honours `{sent:false, retryAfterSeconds}` and keeps the code step if Android closes the app; project permissions follow the server's `canManage` (owners, named managers, MANAGER members) and anyone may create a project (as since 1.15); contrast failures (ink-3, warning text).

**Stage 2 — daily work**
- Approvals: Needs approval tick in New/Edit task (project pre-tick; only managers/admins may untick — server already enforces), Waiting-for-approval badge everywhere, task Approval section (Approve, Send back with a required reason, "Waiting for X's approval"), To approve in My Tasks, Dashboard card, Approvals + Added-to-project notification switches, project setting "New tasks in this project need approval".
- Move a task to another project (task ⋯, card ⋯, My Tasks bulk) with the website's preview, team choice and permission rule; "Formerly KEY" line.
- Dashboard as the website: welcome band, the 4 tiles per role (employee: My tasks / Projects / Overdue / Due this week; admin: My tasks / Projects / All tasks / Overdue), Approvals card, Due soon, Recent activity, first steps for a new company.
- Projects as the website: status tabs with counts in one swipe row, search, owner, sort, only mine, the website's project card, status menu, Archive, `/projects/overview`, first-project invitation, per-project carry-forward / due-today / needs-approval switches in the form, team picker on create.
- Task details and form: comments before files/blockers on phones (website 1.19 order), approval and client marks, checklist in New task, due-today note, task templates in New task (use only).
- Board: card chips (approval, client eye, inspection), empty columns shrink.
- Meetings: summary strip (Next 7 days, Open action items, Minutes to finish, Held this month; tap filters), "Nothing coming up", faces in card footers, compact header, finished meeting shows Final MOM + action items first, "No notes were taken".
- Settings / Users / Reports leftovers: weekly summary switch, "company's week start" wording, last sign-in + Never signed in filter + sort, welcome emails (one / ticked / all never signed in), temporary password optional, on-time "—" until something is done.

**Stage 3 — planning and AI**
- Timeline (the website's phone list: avatar, health pill, progress, milestone/target lines, Late/At risk filters, task rows per project), Workload (one card per person with the week's day chips, Overdue, Off days, suggestions applied with the existing swap/edit endpoints, admin daily limit), Management (for admins and project runners via `GET /management/access`: tiles, health, approvals, inspections, people, trends, lists, PDF), MICO AI (chats list, ask, answers with tables and sources, Excel/PDF downloads, Stop, proposals confirm/cancel/undo, "Which Omar?" questions back, Ask MICO AI from Search), Calendar approval hourglass and scheduled checks.

**Stage 4 — inspections, templates, client sharing**
- Inspections offline (owner decision 2): project Inspections tab (due checks late/today/upcoming, schedules list, Schedule an inspection, finished reports), start/continue an inspection from a check task or the tab, Pass/Fail/N/A + note, readings with unit and limits (outside limits fails — server checks too), finger signatures (inspector always; client/supervisor when the form asks), follow-up tasks (one / all), finish (offers to complete the task), report PDF, show to client, reopen / take over — all answers and the finish kept in an on-phone outbox and sent in order when online, with the same conflict rules the website uses. Starting needs signal (decision 5): the phone's outbox is a copy of the website's `lib/inspection-outbox.ts` (drift-tested), plus a kept copy of each project's due-checks list so it opens offline.
- Templates: start a new project from a project template (start day, roles), start a task from a task template, Save as template (project/task) for people allowed on the website. Editing templates and inspection forms: website, with "Open on the website".
- Client sharing: the project's Share with client panel (add, last looked, Resend with the 1.19 wording, Remove, read-only when archived), per-task Show to client switch and the eye mark, meeting minutes / inspection report Show to client switches.

## 4. Non-goals and anti-goals

- Not on the phone: System Settings (incl. Backups, Google Drive, daily limit page itself is fine via Workload), AI Management, Audit log, template editors, inspection form editor, the client page itself (clients use a browser). These get "Open on the website" links.
- No new product features beyond what the website has. No time tracking/billing. No change to website behaviour except bug fixes the app work uncovers (each called out and shipped with the next web release).
- Anti-goals (a failure even if it "works"): the phone shows different numbers from the website (overdue, progress, completion); a phone user can do something the server would refuse to a website user, or is refused something the website allows; offline work lost or sent as the wrong person on a shared phone; text that is unreadable in dark mode or at a large font size; anything published or pushed while publishing is paused.

## 5. Constraints

- Code lives in the monorepo; the app in `Android App/`. Shared logic follows the existing pattern: a copy of the website/server helper in the app with a drift test that fails when they differ.
- Server endpoints for all of this already exist (gap analysis lists them). Server/website changes only for bugs found; they ride the next web release.
- New native packages are allowed now (the "no new packages" rule was for parallel lanes sharing node_modules): e.g. react-native-svg, expo-font (+ the font files), expo-linear-gradient, installed with `npx expo install` so versions match SDK 51. A test APK then needs `expo prebuild` + a Gradle build (debug-signed). No release signing.
- Tests: vitest unit tests for every lib change (TDD), `tsc`, eslint, `expo export` bundle check; emulator checks with a debug-signed test APK on AVD `mico360_tasks_test` (emulator-5620) against a local 1.19.0 server — light and dark, 360 dp width and a large font, offline/online for the outbox features, TalkBack labels.
- One release at the end: CHANGELOG lines collected per stage; `release.mjs` (not --web-only) when the owner signs; until then nothing is tagged for the app.

## 6. What's left to the builder

Component structure and file names; how the gradient is drawn; exact icon set mapping (as long as the website's paths are the source); skeleton shapes; how the offline inspection outbox reuses the app's existing queue (`lib/item-lanes`, owned writes per user); order of work inside a stage; how stages are split into worktrees/lanes, provided Stage 1's primitives land before stages that use them.

## 7. My calls (owner can overrule)

- Bottom tabs = Dashboard, My Tasks, Projects, Meetings, Chat; Notifications move to the bell in the top bar (shown in the approved mockup).
- Phone layouts copy the website's own phone layouts where it has them (Timeline list, Users cards, Projects tabs row); where it has none (Workload, Management), a phone design in the same style.
- MICO AI polls for answers like the website (no new socket events).
- Stage 1 search links open the website until Stage 3 replaces them with screens.
