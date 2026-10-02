# MICO360 Tasks

Kanban task & project management — **web app + Chrome extension + Node/TS API + MySQL**, with a
Socket.IO real-time layer and a Mailjet email module. The API is built mobile-ready for a future
Android app (Phase 2). Full plan: [`MICO360-Tasks-Development-Plan.md`](MICO360-Tasks-Development-Plan.md);
live status: [`mico360-tasks-tracker.html`](mico360-tasks-tracker.html).

## Repository layout

Organised by product surface:

```
Web Portal/          The web product (deployed together)
  backend/           Fastify + Prisma + MySQL API + Socket.IO + Mailjet
    database/        MySQL init scripts
    docker-compose.yml   MySQL 8 for local dev
    .env.example     backend env template (copy to .env)
  frontend/          React + Vite + Tailwind web app
Extension/           Chrome MV3 extension                                   — a client of the API
Android App/         React Native (Expo) Android app                        — a client of the API
tools/release/       Release builds: Windows installer, Hostinger package, extension zip, APK
Installer/           Release packages, one folder per environment (see Installer/README.md; binaries are not committed)
docs/                OpenAPI spec, deployment (Hostinger, Windows server), data policy, email, QA, a11y
```

npm workspaces: `Web Portal/backend`, `Web Portal/frontend`, `Extension` (workspace names
`@mico360/backend`, `@mico360/frontend`, `@mico360/extension` are unchanged).

## Test status

`npm test` in each app → **2,225 passing** (backend 1,178 · web 521 · Android 340 · extension 186),
with typecheck and lint clean everywhere. Plus `npm run test:db` (Prisma integration on MySQL 8)
and `npm run test:e2e` (live-API lifecycle), and the release acceptance test
`tools/release/verify-server.mjs` (77 checks against a freshly installed server — web app, sign-in,
users, Arabic projects/tasks, recurring tasks, files, reports, chat + realtime, meetings, permissions).

## Release packages (v0.3.0)

`node tools/release/build-release.mjs` builds the Windows installer, the Hostinger server package and
the Chrome extension zip into `Installer/`, one folder per environment (Hostinger web server, Windows
office server, Android app, Chrome extension); `bash tools/release/build-apk.sh` builds the signed APK.
Each folder has its own step-by-step guide, starting from [`Installer/README.md`](Installer/README.md).
The self-contained Windows server is documented in [`docs/WINDOWS-SERVER.md`](docs/WINDOWS-SERVER.md).

## What's implemented

**Backend API (`/api/v1`, all RBAC-guarded, all with service + route tests + Prisma adapters):**
- **Auth** — login by email *or* username, passwordless **email-OTP**, **5-strike lockout**, JWT access + hashed refresh tokens, RBAC guard, and a full **forgot/reset-password** flow (emailed SHA-256 token link → new password → **unlocks the account**; no account enumeration; strength-checked).
- **Users** (admin) — CRUD + activate/deactivate/suspend + role assignment.
- **Projects** — CRUD + archive; **Kanban columns** per project.
- **Tasks** — CRUD, auto keys (`MICO-1`), **move endpoint** (drag-drop persistence), `/tasks/mine`.
- **Assignees** — many-to-many (mandatory multi-user).
- **Checklists** — items + auto-progress %.
- **Dependencies** — blocking / blocked-by edges with server-side **cycle detection** (rejects direct + transitive loops).
- **Recurring tasks** — daily, weekly (chosen days), monthly or quarterly (a day of the month, or "the 2nd Tuesday" / "the last Friday") and yearly schedules, every N periods, ending never / after N / on a date, pausable. The next copy is made **when this one is done** (default) or **on each due date** (hourly server job) and keeps the details, assignees, watchers, tags and checklist. A task never gets two next copies (unique database guard), so completing it twice or from several apps at once makes one. Set and edit repeats in the web app, the Chrome extension and the Android app — see [docs/RECURRING-TASKS.md](docs/RECURRING-TASKS.md).
- **Comments** — CRUD + `@mentions` + author/admin permissions; a mention **notifies** the user.
- **Attachments** — multipart file upload (type + size validation), local-disk storage (S3-ready port), download, delete; files served at `/uploads/<key>`.
- **Notifications** — per-user list / read / unread-count; **fired automatically** on task assignment and on `@mention`.
- **Activity** — per-task timeline; an `ASSIGNED` row is **recorded** when a user is assigned.
- **Reports** (admin-only) — status breakdown, project performance, employee workload, completion
  trend, filtered by project, team member and period. Exports: a **full report** (every section) or any
  single report as a formatted **Excel `.xlsx`** (one sheet per section, frozen bold headers, sized
  columns, real dates and numbers) or a **branded PDF** (logo header, brand colours and fonts, section
  headings kept with their content, tables that repeat their header across pages, page numbers), plus
  CSV. Every task can also be exported on its own (`GET /tasks/:id/export.xlsx|pdf`). Files are named
  after the report, its filters and the day (e.g. `tasks-report-rig-inspection-portal-2026-10-01.pdf`).
- **Search** — global search across tasks / projects / users.
- **Email (Mailjet)** — templates (OTP, reset, task-assigned, welcome) + Send-API transport.
- **Realtime (Socket.IO)** — JWT-auth'd project rooms; task move/create/update broadcast live.

**Frontend** — a branded **split login screen** (MICO360 logo panel) with two sign-in modes —
password *or* passwordless **email code (OTP)** — email-or-username field, a distinct
account-locked callout, and **Forgot / Reset password** pages (`/forgot`, `/reset?token=…`);
protected routing, role-aware sidebar
(icons + sections), app shell,
**Kanban board** (loads columns + tasks from the API), Projects, Dashboard, My Tasks, Notifications,
Reports, Settings, and admin User Management — plus a UI kit (Button, Avatar, PriorityBadge,
TaskCard, StatTile, QuickAddTaskForm) and a typed API service layer. The **task drawer** shows the
checklist, comments, **file attachments** (upload / download / remove), **dependencies**
(blocked-by / blocks, add + remove), and a **repeat editor** (frequency, interval, weekdays,
day of the month or "the 2nd Tuesday", end, when copies are made, pause) with a summary badge and a
preview of the next dates. New tasks can repeat from the start. The **Reports** page exports the full
report or a single report as **Excel, PDF or CSV**, following the on-screen filters; the task drawer's
**Export** menu downloads the task as Excel or PDF.

**Chrome extension (MV3)** — popup (today/overdue/in-progress/completed + upcoming + actions),
background service worker (unread-count badge polling), "Open Full MICO360 Tasks".

> The whole system is composed in `Web Portal/backend/src/server.ts` and ready to run against MySQL.
> The Prisma-backed persistence and the DB integration tests are the only parts that need a live
> database to execute; everything else is unit/route/component-tested without one.

## Prerequisites

- Node.js 20+
- **MySQL 8** — via Docker (`npm run db:up`, needs a working Docker engine; on Windows
  that means WSL2 or the Hyper-V backend), or any existing MySQL 8 (point `Web Portal/backend/.env` at it).

## Setup & run

```bash
npm install
cp "Web Portal/backend/.env.example" "Web Portal/backend/.env"   # edit DB url + JWT secrets (+ Mailjet keys)
npm run db:up                        # starts MySQL 8 (Web Portal/backend/docker-compose.yml)
cd "Web Portal/backend"
npm run prisma:generate
npm run prisma:migrate              # dev DB
npx prisma migrate deploy           # (TEST_DATABASE_URL) test DB
npm run db:seed                     # demo data for development: admin@mico360.test / Password1!
                                    # (wipes the database; refuses in production or over real accounts)
npm run dev                         # API on :4000 (realtime enabled)
```

```bash
cd "Web Portal/frontend" && npm run dev           # web app on :5173
```

**Chrome extension:** `chrome://extensions` → Developer mode → *Load unpacked* → select the `Extension/` folder.

## Tests

```bash
npm test                # all workspaces (413)
cd "Web Portal/backend" && npm run test:db   # Prisma integration tests (needs a running DB)
cd "Web Portal/backend" && npm run test:e2e  # live-API lifecycle E2E (needs the dev server running)
```

## Security notes

- Secrets live in `Web Portal/backend/.env` (git-ignored). **Rotate the Mailjet secret before production** —
  it was shared in plaintext during planning.
- Backend enforces authorization server-side (RBAC guard); an Employee calling an Admin route is
  rejected regardless of the UI.
