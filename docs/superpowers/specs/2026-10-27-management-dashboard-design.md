# Management dashboard — design (approved 27 Oct 2026)

Ships in **1.18.0** (web + server only), together with Scheduled inspections (built in parallel in
`D:/mico-release/wt-sched-insp`, branch `feat/scheduled-inspections`; its spec is
`docs/superpowers/specs/2026-10-27-scheduled-inspections-design.md` on that branch — read it for the
"check" definitions). Both branches start from commit 39e4a4d, which adds `tasks.inspectionFormId` and
`tasks.inspectionPlace` (migration `20261028120000_task_inspection_form`). Do not change that migration.

## Why

Leadership has no single place to see how every project is doing. The pieces exist (project dashboard,
Workload, Timeline, Reports) but each is per project or per week. The Management page answers "where are
we in trouble, who is overloaded, are inspections being done, and is it getting better?" on one screen,
as a PDF for meetings, and as a weekly email.

## Owner decisions (do not change)

1. **Who**: administrators see **every** project; project runners (owner, named manager `managerId`, or a
   MANAGER member — `managesProject` / `managedProjectsWhere` in
   `backend/src/modules/projects/project-managers.ts`) see the same page **for the projects they run**.
   Everyone else: no page, no link, 403 from the API.
2. **Contents** (all four):
   - **Project health** — every project in one table: % done, late tasks, next milestone, last activity,
     a red/amber/green mark — worst first.
   - **Inspections** — checks done vs due, late and missing checks, most-failed items and forms, open
     follow-up tasks.
   - **People & workload** — who is overloaded or has late work this week, and open meeting action items
     per person.
   - **Trends** — weekly charts over the last 12 weeks: tasks created vs completed, late tasks,
     inspection pass rate.
3. **Extras** (all three): **Download as PDF** (branded); **Weekly email** — a short summary to each
   person who can see the dashboard (their projects only) with a link, sent on the **first working
   morning of the company week** (Sunday when the week starts Sunday), which each person can turn off in
   Settings; **Filters** — project, owner, project status, and the trend range.
4. Clicking any number opens the list behind it.

## Definitions (exact)

- Projects in scope: not deleted; status filter default = PLANNING, ACTIVE, ON_HOLD (COMPLETED and
  ARCHIVED only when chosen); then the runner scope; then the project/owner filters.
- **late task** = open (not in a Done-category column / no `completedAt`), not deleted, and
  `isOverdue(dueDate, COMPANY_TIMEZONE, now)` (`backend/src/lib/due-date.ts`). Milestones are tasks with
  `isMilestone`.
- **% done** = reuse the project dashboard's existing calculation (find it — the project Overview tab);
  do not invent a second one.
- **check** (inspection) = a non-deleted task with `inspectionFormId` not null. State: done = completed;
  done late = `completedOnTime(due, completedAt, tz) === false`; missing = open and overdue; closed
  without a report = done with no finished inspection linked to the task. These must match the scheduled
  inspections branch exactly (same helpers); at integration both are checked against the same cases.
- **pass rate** = passed items ÷ (passed + failed) over inspections finished in the period (N/A and
  unanswered excluded). Item labels come from each inspection's copied `structure` JSON; results from
  `inspection_answers.result`.
- **RAG** (show the reasons as text next to the mark — never colour alone):
  - **Red**: a milestone overdue and not done; OR late tasks ≥ 25% of open tasks with at least 3 late;
    OR 3+ missing checks.
  - **Amber**: otherwise any late task, any missing check, or (ACTIVE projects) no activity for 14 days.
  - **Green**: none of the above.
  Sort: red, amber, green; then late count desc; then name.
- **overloaded** = on any working day of the current week, the person's open tasks due that day exceed
  the Workload daily limit (`workload.dailyLimit`) — reuse `modules/planning/workload-service.ts` /
  `workload.ts` (same working days and limit as the Workload page), restricted to scope projects.
- **open action items** = `ActionItem` rows with an open status, assigned to the person, in scope
  projects; also count overdue ones.
- **Period filter**: 4 / 12 / 26 weeks (default 12) — applies to trends and to inspection statistics
  (checks due, done, done late, pass rate, most-failed). "Right now" numbers (late tasks, missing checks,
  open follow-ups, this week's workload, open action items) are always current.
- Weeks are company weeks (company time zone, company week start); the current week is the last bucket
  (partial).

## Server

New module `backend/src/modules/management/` (ports + Prisma adapter + pure rules, like the other
modules), registered in `app.ts`/`server.ts`.
- `GET /management/access` → `{ allowed, scope: 'ALL' | 'RUN' }` (cheap; used to show the sidebar link).
- `GET /management/overview?projectIds=&ownerId=&status=&weeks=` → headline tiles + the four sections.
- `GET /management/items?metric=…&projectId=&personId=&…` → the list behind a number (late tasks,
  milestones, missing checks, done-late checks, open follow-ups, a person's late tasks / overloaded days /
  action items, most-failed item occurrences …), capped with a total; every row links to its task /
  inspection / meeting. Every filter value is checked against the caller's scope (a runner can never
  read another project's rows by passing its id).
- `GET /management/overview.pdf?…` — branded with `backend/src/lib/pdf-document.ts` (logo, title
  "Management overview", the filters in words, generated at in the company time zone, "Page N of M"):
  headline numbers, the project-health table (RAG as a word + dot), inspections summary + top failed
  items, people table, trends as compact tables (simple bars only if pdf-document already supports
  drawing them). Rate limited like the other PDF routes. Server-named file via Content-Disposition
  (existing pattern).
- Aggregate in SQL (groupBy / raw queries with bound parameters); never load every task. Target < 1.5 s
  at 200 projects / 50k tasks. Exclude soft-deleted rows everywhere.
- **Weekly email**: a new sweep beside the daily task emails (`modules/daily-emails`, `server.ts`
  timers, `job_locks`), sent at the daily-email send time on the first working day of the company week.
  Recipients: active staff with an email who can see the dashboard and have ≥1 project in scope.
  Opt-out: `users.notificationPrefs.weeklySummary === false` (no migration; default on). Company-wide
  off switch next to the daily-email admin settings (default on). Dedupe per person per week with a DB
  unique key and the same retry/backoff behaviour as daily emails (a new table or a new
  `DailyEmailKind` value — your call; migration timestamp `20261028130000_…`). Skip people with nothing in
  scope. Content (plain English, the 600px centred card design the daily email uses): red/amber counts
  with the top 3 projects and their reasons, late tasks, missing checks, checks done late last week, pass
  rate last week, the 3 people with the most late work, and an "Open the dashboard" button to
  `APP_URL/management`. Mail goes through the existing email service (local outbox in dev).

## Website

- Route `/management`, page title "Management" (eyebrow "Workspace"), in the sidebar beside Reports /
  Workload, shown only when `/management/access` allows (admins and runners). Add it to the command
  palette page lists (web `frontend/src/lib/commands.ts`; the drift tests also cover the extension
  `Extension/src/search.js` PAGES and Android `Android App/src/lib/commands.ts` + `search.ts` — follow
  how admin-only pages such as Reports are handled there).
- Layout: header with filters (project multi-select, owner, status, period) kept in the URL query, and
  **Download PDF**; headline tiles (`StatTile`); Project health table (sortable by the RAG order,
  responsive — cards on phones); Inspections; People & workload; Trends (`LineChart` / `BarChart`).
  Every number is a button opening a side sheet with the list behind it (rows open the task drawer /
  inspection / meeting). Empty states for "no projects in scope" and "no inspections yet".
- Refetch on focus and every 5 minutes; loading skeletons; `LoadError` on failure.
- **Settings** page: "Weekly management summary" switch (only for people who can see the dashboard).
- Design system: tokens `rgb(var(--c-…))`, dark mode, Tailwind em breakpoints, 375px phones, 44px touch
  targets on coarse pointers, `dir="auto"` for user text, keyboard + screen-reader friendly (RAG has text;
  charts have a table/summary alternative), axe-clean.

## Out of scope

Android app and Chrome extension pages (beyond the shared page-list copies the drift tests require),
time tracking or billing, editing anything from the dashboard, custom RAG thresholds.

## Tests (test-first)

Pure-rule unit tests (RAG incl. thresholds and reasons, period/week bucketing at company time zone and
week-start boundaries, overloaded, pass rate, % done reuse), route tests (403 for non-runners, runner
scope enforced on every filter and on `/items`, admin sees all, PDF headers + content via the existing
pdf-inspect helper), DB tests (`TEST_DATABASE_URL`) for the SQL aggregates on a seeded mix (deleted rows
excluded, archived only when chosen), weekly-email tests (day/time, week start Sunday vs Monday, opt-out,
company switch, dedupe/retry, nothing in scope → no email), web component tests (link visibility,
filters ↔ URL, drill-down sheet, settings switch). A browser e2e (Playwright, see the brief) on a
throwaway database.
