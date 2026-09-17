# MICO360 Tasks

Kanban task & project management — **web app + Chrome extension + Node/TS API + MySQL**, with a
Socket.IO real-time layer and a Mailjet email module. The API is built mobile-ready for a future
Android app (Phase 2). Full plan: [`MICO360-Tasks-Development-Plan.md`](MICO360-Tasks-Development-Plan.md);
live status: [`mico360-tasks-tracker.html`](mico360-tasks-tracker.html).

## Repository layout

Organised by product surface:

```
Web Portal/          The web product (deployed together)
  backend/           Fastify + Prisma + MySQL API + Socket.IO + Mailjet   (15 modules)
    database/        MySQL init scripts
    docker-compose.yml   MySQL 8 for local dev
    .env.example     backend env template (copy to .env)
  frontend/          React + Vite + Tailwind web app                       (login → wired pages)
Extension/           Chrome MV3 extension (popup + service worker)         — a client of the API
Android App/         Phase 2 native mobile app (planned; see the plan)     — a client of the API
docs/                OpenAPI spec, deployment, data policy, email, CD, QA, a11y, screen flows
```

npm workspaces: `Web Portal/backend`, `Web Portal/frontend`, `Extension` (workspace names
`@mico360/backend`, `@mico360/frontend`, `@mico360/extension` are unchanged).

## Test status

`npm test` (root, all workspaces) → **413 passing**:
**backend 278 · frontend 128 · extension 7.** Typecheck and lint are clean everywhere.
Plus `npm run test:db` (Prisma integration) and `npm run test:e2e` (live-API lifecycle E2E).
**All 106 Phase-1 tasks are done.**
Every nav route is a real, API-wired page — no placeholders, no dead links.

**End-to-end verified against a live database:** `npm run test:db` → **5/5** Prisma integration
tests, plus a live-server API smoke test of **14/14** flows (login by email+username, RBAC,
auto task keys, kanban move, multi-user assignees, checklist auto-%, comments, reports, search,
5-strike lockout) — and an **11/11** cross-cutting check that file attachments upload/download/delete,
that assignment fires a notification + activity row, and that a comment `@mention` notifies the
mentioned user (all asserted directly against the DB). Production targets **MySQL 8**; because this machine only had PostgreSQL,
local verification ran on Postgres via `prisma/schema.postgres.prisma` (schema identical minus
the MySQL-only fulltext index — no code queries it). See `Web Portal/backend/.env` for the local setup.
Every task was built strict-TDD (red → green). `npm run test:db` (Prisma integration tests) is
written and ready — it just needs a running MySQL.

## What's implemented

**Backend API (`/api/v1`, all RBAC-guarded, all with service + route tests + Prisma adapters):**
- **Auth** — login by email *or* username, passwordless **email-OTP**, **5-strike lockout**, JWT access + hashed refresh tokens, RBAC guard, and a full **forgot/reset-password** flow (emailed SHA-256 token link → new password → **unlocks the account**; no account enumeration; strength-checked).
- **Users** (admin) — CRUD + activate/deactivate/suspend + role assignment.
- **Projects** — CRUD + archive; **Kanban columns** per project.
- **Tasks** — CRUD, auto keys (`MICO-1`), **move endpoint** (drag-drop persistence), `/tasks/mine`.
- **Assignees** — many-to-many (mandatory multi-user).
- **Checklists** — items + auto-progress %.
- **Dependencies** — blocking / blocked-by edges with server-side **cycle detection** (rejects direct + transitive loops).
- **Recurring tasks** — daily/weekly (by weekday)/monthly (day-of-month, clamped)/yearly rules with count + until; completing a recurring task (moving it to a Done column) **auto-spawns the next occurrence** and carries the rule forward (no double-spawn).
- **Comments** — CRUD + `@mentions` + author/admin permissions; a mention **notifies** the user.
- **Attachments** — multipart file upload (type + size validation), local-disk storage (S3-ready port), download, delete; files served at `/uploads/<key>`.
- **Notifications** — per-user list / read / unread-count; **fired automatically** on task assignment and on `@mention`.
- **Activity** — per-task timeline; an `ASSIGNED` row is **recorded** when a user is assigned.
- **Reports** — status breakdown, project performance, employee workload; **CSV / Excel / PDF export** of each (admin-only) — dependency-free (RFC-4180 CSV, SpreadsheetML `.xls`, a hand-built valid PDF).
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
(blocked-by / blocks, add + remove), and a **recurrence editor** (frequency, interval, weekdays,
day-of-month) with a summary badge. The **Reports** page exports as **CSV, Excel, or PDF**.

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
npm run db:seed                     # admin@mico360.test / Password1!
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
