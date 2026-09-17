# MICO360 Tasks — Development Plan & Tracker (Modules, Tasks, Owners, Estimates)

> **Type:** Planning & estimation only. No product code has been written.
> **Product:** MICO360 Tasks — Chrome Extension (MV3) + web app + Node/TS backend + MySQL, **API designed to also serve a future mobile app**.
> **Prepared:** 2026-09-07 · **Last updated:** 2026-09-07

---

## 0. How to read / use this tracker

**Columns in every task table:**
`ID · Task · Est.` (estimated dev tokens) `· Act.` (actual tokens — fill on completion)
`· Owner` (assignee — fill in) `· Target` (target date — fill in) `· Pri` (priority) `· Status`.

- **Status:** ⬜ Not Started · 🟨 In Progress · 🟦 In Review · ✅ Done · ⛔ Blocked (all ⬜ — greenfield)
- **Priority:** **P0** = MVP-critical / blocking foundation · **P1** = core (v1) · **P2** = enhancement / **v2-deferred**
- **Release:** see §3. Tasks tagged **(v2)** in their description are intentionally deferred out of the first release.
- **Est. tokens** = rough tokens an AI coding agent is expected to consume to *develop* the task (context + writing + tool/test runs + iteration). **Estimates, not guarantees** — real usage often runs **1.5×–3× higher**; track **Act.** to recalibrate (§4).
- **Owner / Target** are blank (`—`) for you to fill.

### Brand / theme (from supplied logo)
| Token | Value | Use |
|---|---|---|
| Primary (MICO maroon) | `#8B1E1E` (approx) | Primary buttons, active nav, priority accents |
| Dark (360 charcoal) | `#1E1E1E` (approx) | Text, headers, dark surfaces |
| Surface / neutral | `#FFFFFF` / greys | Backgrounds, cards |
| Logo assets | `logo.png` (dark, for light bg), `logo-w.png` (white, for dark bg) | Sidebar, popup, login, extension & email icons |

---

## 1. Phase 1 — Module map (Web app + Chrome extension · 21 modules, 106 tasks)

| # | Module | Tasks | Est. tokens (mid) | Depends on |
|---|--------|:---:|---:|---|
| M0 | Project Setup, Foundations & Wireframes | 5 | ~380K | — |
| M1 | Database & Data Layer (MySQL + Prisma) | 7 | ~930K | M0 |
| M2 | Backend Core, Auth, Security & API Contract | 11 | ~1,330K | M1 |
| M3 | Backend Domain APIs | 14 | ~2,220K | M2 |
| M4 | Real-time Sync & Conflict Handling | 3 | ~430K | M3 |
| M5 | Frontend Foundations | 5 | ~550K | M0 |
| M6 | Frontend Shell / Shared UI | 5 | ~720K | M5 |
| M7 | Kanban Board | 5 | ~830K | M6, M3, M4 |
| M8 | Task Management UI | 7 | ~1,000K | M7 |
| M9 | Projects Module UI | 3 | ~540K | M6, M3 |
| M10 | Dashboard & Charts | 4 | ~680K | M6, M3 |
| M11 | My Tasks / Calendar | 2 | ~470K | M6, M3 |
| M12 | Reports & Export | 2 | ~500K | M3 |
| M13 | Notifications & Activity/Audit UI | 3 | ~360K | M6, M3 |
| M14 | Settings (Personal + Admin) | 2 | ~400K | M6, M3 |
| M15 | User / Team Management (Admin) | 2 | ~300K | M6, M3 |
| M16 | Chrome Extension (MV3) | 6 | ~720K | M5, M2 |
| M17 | Testing, QA & Accessibility | 5 | ~1,280K | all |
| M18 | Documentation & Deployment | 3 | ~350K | all |
| M19 | Observability, CI/CD & Ops | 6 | ~660K | M0, M2 |
| M20 | Email Notifications (Mailjet) | 6 | ~850K | M2, M3, M14 |
| | **TOTAL (Phase 1)** | **106** | **~15.5M** | |

> **Phase 1 (this table): ~15.5M tokens · 106 tasks.** **Phase 2 (Android app, see §11): ~4.38M · 23 tasks.**
> **Whole program ≈ 19.9M midpoint · ~28M with a 1.4× planning contingency.** Realistic range ~16M–36M with debugging/iteration — budget against the contingency figure, not the midpoint.

---

## 2. Mobile-readiness & API design principles (applies to ALL of M2–M4)

The backend is the single source of truth for **web app, Chrome extension, and a future native mobile app**. Every endpoint must be built to these rules so the mobile app can reuse the same API with zero rework:

- **Versioned base path:** all routes under `/api/v1/...` (see **T2.8**) so mobile can pin a version.
- **Stateless auth:** JWT access + refresh tokens carried in the `Authorization` header — **no reliance on browser cookies/sessions** (native apps have no cookie jar). Refresh-token endpoint usable by any client.
- **Pure JSON, consistent envelope:** predictable `{ data, meta, error }` shape; ISO-8601 UTC timestamps; no HTML in responses.
- **Absolute, tokenized asset URLs:** attachment/avatar URLs returned as full URLs (not web-relative paths) so a mobile client can fetch them directly.
- **Pagination + filtering on every list endpoint** (cursor or page/limit) — never assume a web-sized payload.
- **CORS / client allow-list** configurable for web origin, extension origin, and future mobile (mobile uses native HTTP, not CORS, but the token flow must not depend on same-origin).
- **Channel-agnostic notifications:** the notification model (T3.10) stores a channel-neutral event so in-app, **email (M20)**, and **mobile push (FCM — Phase 2 / A6.2)** all read the same source — the push channel + `device_tokens` table slot in with no schema change.
- **OpenAPI 3 contract (T2.8 / T18.1)** published as the shared source of truth for the mobile team to generate a client from.
- **Timezone-correct by design (cross-cutting):** store all datetimes in **UTC**; compute "due today / overdue / upcoming", calendar placement, and email send-times in the **user's** timezone (from their settings), never the server's. This affects T3.3, T3.10, T10.x, T11.x, T20.x — get it right in the data layer once.

*A dedicated mobile app UI is out of scope here; this section only guarantees the API won't need re-architecting for it.*

---

## 3. Release plan — MVP → v1 → v2

### 🎯 MVP — thin vertical slice (ship first, prove the whole stack)
**Flow:** login → projects → tasks → **Kanban drag-drop persisted** → basic (multi-user) assignment.
**Tasks:** T0.1–T0.3, **T0.5 (wireframes)**, T1.1–T1.3, T1.6, T1.7, T2.1, T2.2, T2.4, T2.5, **T2.8**, T3.1–T3.4, T5.1–T5.4, T6.1, T6.4, T7.1–T7.3, T8.1, T8.2, T9.1, T15.1, **T19.4 (CI)**. *(32 tasks)*
**Estimate:** **~4.7M tokens** for this disciplined slice. *(As you noted, taken module-complete this maps to roughly MS1–MS3 ≈ ~7.6M; the thin slice above is the leaner, recommended target — build only the happy path first.)*
**Explicitly NOT in MVP:** reports, recurrence, calendar, audit logs, email, dashboard charts, extension.

### 📦 v1 — feature-complete (everything except the deferred items below)
All remaining P1 work: comments, checklist, attachments + upload safety, in-app **and email** notifications (M20), reports & export, dashboards, my-tasks/calendar, settings, admin, Chrome extension, realtime board sync, activity/audit, observability, testing, docs.

### 🔮 v2 — deferred high-variance features (don't let these block a working demo)
Least-reliable estimates → schedule after v1 ships:
- **T3.7 Task dependencies** (blocking/blocked-by)
- **T3.8 Recurring tasks engine**
- **Watchers** (the watcher portion of T3.4 / `task_watchers`)
- **T4.3 Conflict handling** (optimistic concurrency resolution)

> The `task_dependencies` and `task_watchers` **tables** are still created in M1 (cheap, avoids a later migration); only the **features** are deferred.

---

## 4. Actual-vs-Estimate tracking & recalibration protocol

1. **Record `Act.` on every completed task**; flip `Status` ⬜→🟨→🟦→✅.
2. **First checkpoint after M0–M2:** compute `realized multiplier = Σ(Act.) ÷ Σ(Est.)` over completed tasks.
3. **Re-baseline** every not-started task's `Est.` by that multiplier; update the grand total.
4. **Re-run at each milestone** (MS1…MS5) — the multiplier tightens as the sample grows.
5. **Flag any task exceeding 1.5× its estimate** and investigate before the pattern repeats.

### Calibration log (fill as modules complete)
| Checkpoint | Tasks done | Σ Est. (K) | Σ Act. (K) | Realized × | Applied to remaining? |
|---|---|---:|---:|:--:|:--:|
| After M0 | | | | | |
| After M2 (MS1) | | | | | |
| After MS2 | | | | | |
| After MS3 | | | | | |
| After MS4 | | | | | |

---

## 5. Open decisions & credentials

| ID | Decision | Affects | Status / default |
|---|---|---|---|
| **D1** | **"Project Manager" — permission tier or just a label?** Spec has only Admin/Employee but projects have a `project_manager` field. | T2.7, T3.2, T9.x, RBAC | **Open.** Default: label only. If it's a real tier → enable **T2.7** (~120K). |
| **D2** | Email provider. | M20, T2.3 | **Resolved → Mailjet** (SMTP `in-v3.mailjet.com`, Send API v3.1 + Event API). |
| D3 | Malware-scanning for uploads (ClamAV self-host vs. hosted API)? | T2.6 | ClamAV sidecar, scan-on-upload, quarantine on hit. |
| D4 | Observability stack (Sentry / Grafana-Loki / SaaS)? | M19 | Sentry (errors) + JSON logs + health/metrics endpoint. |
| **D5** | **Android app stack — React Native (Expo) vs native Kotlin/Jetpack Compose?** | All of Phase 2 (§11) | **Recommend React Native + Expo** — reuses the web app's React/TS skills, components & API client for fastest delivery and an easy iOS follow-on. Choose **Kotlin/Compose** only if a fully-native Android feel is the priority. Estimates hold either way ±15%. |

> ### ⚠️ Mailjet credential handling (read before M20)
> The **API key and secret key were shared in plaintext in chat.** In the build they must live **only** in backend environment variables — `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` (plus `MAILJET_SMTP_HOST=in-v3.mailjet.com`, `MAILJET_SMTP_PORT=25`) — or a secrets manager. **Never** put them in the frontend, the Chrome extension, this document, or version control (`.env` stays git-ignored; only `.env.example` with blank placeholders is committed).
> Because the secret was exposed in a chat message, **rotate it in the Mailjet dashboard before go-live** and treat the shared value as compromised.

---

## 6. Task breakdown

### M0 — Project Setup, Foundations & Wireframes · ~380K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T0.1 | Monorepo structure (`extension/`, `frontend/`, `backend/`, `prisma/`, `database/`) + workspaces | 50K | — | — | — | P0 | ⬜ |
| T0.2 | Tooling: TS, ESLint, Prettier, Vite, env config, `.env.example` (incl. Mailjet placeholders) | 60K | — | — | — | P0 | ⬜ |
| T0.3 | Brand/design tokens: MICO360 palette, Tailwind theme, typography, logo assets | 80K | — | — | — | P0 | ⬜ |
| T0.4 | README scaffold, dev scripts, base package.json | 40K | — | — | — | P1 | ⬜ |
| T0.5 | **Wireframes / screen flows for key screens (login, board, task drawer, dashboard, project, settings) against MICO360 brand — before M6–M8 to prevent UI rework** | 150K | — | — | — | P0 | ⬜ |

### M1 — Database & Data Layer · ~930K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T1.1 | Prisma schema: `users` (+ `failed_login_attempts`, `locked_until`), `roles`, `user_roles`, `departments` | 120K | — | — | — | P0 | ⬜ |
| T1.2 | Prisma schema: `projects`, `project_members`, `tags`, `task_tags` | 120K | — | — | — | P0 | ⬜ |
| T1.3 | Prisma schema: `tasks`, `task_assignees`, `task_watchers`, `kanban_columns` | 150K | — | — | — | P0 | ⬜ |
| T1.4 | Prisma schema: `task_comments`, `task_checklists`, `task_dependencies`, `task_attachments`, `task_activity` | 130K | — | — | — | P1 | ⬜ |
| T1.5 | Prisma schema: `notifications`, `user_settings`, `system_settings`, `refresh_tokens`, `audit_logs`, `email_log`, `login_otps`, `device_tokens` | 110K | — | — | — | P1 | ⬜ |
| T1.6 | Indexes, FKs, unique constraints, soft-delete, timestamps + raw `database/mysql.sql` | 100K | — | — | — | P0 | ⬜ |
| T1.7 | Migrations + `seed.ts` (1 admin, 10 employees, 5 projects, 50+ tasks, comments, checklists) | 200K | — | — | — | P0 | ⬜ |

### M2 — Backend Core, Auth, Security & API Contract · ~1,330K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T2.1 | Server bootstrap (Express/Fastify), middleware, error handler, config, logging | 100K | — | — | — | P0 | ⬜ |
| T2.2 | Auth: login with **email _or_ username** + password, JWT access + refresh (header-based, mobile-ready), bcrypt/Argon2, logout, session expiry, Remember Me | 180K | — | — | — | P0 | ⬜ |
| T2.3 | Forgot-password / reset-password flow (email via M20) | 100K | — | — | — | P1 | ⬜ |
| T2.4 | RBAC middleware (admin/employee), route guards, user-status enforcement | 120K | — | — | — | P0 | ⬜ |
| T2.5 | Security: validation (zod), rate limiting, secure headers, CORS allow-list, SQLi/XSS/CSRF, base upload validation | 150K | — | — | — | P0 | ⬜ |
| T2.6 | Upload safety hardening: malware/virus scan hook (ClamAV), per-user/project storage quotas, deep MIME verification | 120K | — | — | — | P1 | ⬜ |
| T2.7 | Project Manager permission tier — **conditional on D1** (project-scoped elevated rights) | 120K | — | — | — | P2 | ⬜ |
| T2.8 | **API versioning (`/api/v1`) + mobile-ready contract (OpenAPI 3, consistent JSON envelope, absolute asset URLs, header auth)** | 90K | — | — | — | P0 | ⬜ |
| T2.9 | **First-admin bootstrap / installer for production (secure one-time admin creation; seed is dev-only)** | 80K | — | — | — | P1 | ⬜ |
| T2.10 | **Email OTP login (passwordless): request code → send via Mailjet → verify → issue JWT; codes hashed, expiring, single-use, rate-limited** | 150K | — | — | — | P1 | ⬜ |
| T2.11 | **Account lockout: lock after 5 failed password attempts; unlock ONLY via password reset; audit-logged + email alert to the user** | 120K | — | — | — | P1 | ⬜ |

### M3 — Backend Domain APIs · ~2,220K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T3.1 | Users CRUD + activate/deactivate/suspend | 130K | — | — | — | P0 | ⬜ |
| T3.2 | Projects CRUD + members + archive + per-project resources | 180K | — | — | — | P0 | ⬜ |
| T3.3 | Tasks CRUD + filtering + pagination + status/priority/dates/progress | 250K | — | — | — | P0 | ⬜ |
| T3.4 | Task assignees (many-to-many) add/remove **(watchers portion → v2)** | 120K | — | — | — | P0 | ⬜ |
| T3.5 | Comments + `@mentions` | 130K | — | — | — | P1 | ⬜ |
| T3.6 | Checklists/subtasks + auto % complete | 100K | — | — | — | P1 | ⬜ |
| T3.7 | Task dependencies (blocking / blocked-by + validation) **(v2)** | 120K | — | — | — | P2 | ⬜ |
| T3.8 | Recurring tasks engine (daily/weekly/monthly/yearly/custom) **(v2)** | 200K | — | — | — | P2 | ⬜ |
| T3.9 | Attachments (upload, local storage w/ S3-ready design, absolute URLs, metadata) | 150K | — | — | — | P1 | ⬜ |
| T3.10 | Notifications service — **channel-agnostic** (assign/mention/due/overdue/status/comment/checklist/complete/reopen) feeding in-app + email + future push | 160K | — | — | — | P1 | ⬜ |
| T3.11 | Activity timeline + Audit log recording | 150K | — | — | — | P1 | ⬜ |
| T3.12 | Settings APIs (user + system) + Kanban column management | 130K | — | — | — | P1 | ⬜ |
| T3.13 | Reports APIs (task, workload, project performance, due-date, productivity) | 300K | — | — | — | P1 | ⬜ |
| T3.14 | Global search API (tasks/IDs/projects/users/comments/tags) — **MySQL FULLTEXT indexes** for scale | 100K | — | — | — | P1 | ⬜ |

### M4 — Real-time Sync & Conflict Handling · ~430K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T4.1 | Socket.IO server + auth handshake + rooms (per board/project) | 150K | — | — | — | P1 | ⬜ |
| T4.2 | Broadcast events: task/assignment/comment/checklist/status/notification | 150K | — | — | — | P1 | ⬜ |
| T4.3 | Optimistic concurrency (`updated_at`/version) + "updated by another user" resolution **(v2)** | 130K | — | — | — | P2 | ⬜ |

### M5 — Frontend Foundations · ~550K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T5.1 | React + TS + Vite scaffold + React Router | 90K | — | — | — | P0 | ⬜ |
| T5.2 | API client + TanStack Query + token-refresh interceptors | 120K | — | — | — | P0 | ⬜ |
| T5.3 | Auth store, protected routes, login + forgot-password pages | 160K | — | — | — | P0 | ⬜ |
| T5.4 | Theme system (light/dark/system) + brand tokens + Tailwind | 100K | — | — | — | P0 | ⬜ |
| T5.5 | **Login UX: "email or username" field, "email me a code" (OTP) flow + code entry, account-locked / reset messaging** | 80K | — | — | — | P1 | ⬜ |

### M6 — Frontend Shell / Shared UI · ~720K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T6.1 | App layout: role-aware left sidebar, top header, profile menu | 160K | — | — | — | P0 | ⬜ |
| T6.2 | Global search UI (debounced, results dropdown) | 100K | — | — | — | P1 | ⬜ |
| T6.3 | Notifications bell + dropdown + unread count | 110K | — | — | — | P1 | ⬜ |
| T6.4 | Reusable components: buttons, modals, drawers, searchable multi-select, avatars, tables, toasts, tooltips | 250K | — | — | — | P0 | ⬜ |
| T6.5 | Quick Add Task global modal | 100K | — | — | — | P1 | ⬜ |

### M7 — Kanban Board · ~830K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T7.1 | Board layout + columns (Backlog→Completed, colors/order) | 150K | — | — | — | P0 | ⬜ |
| T7.2 | Task cards (title, ID, project, priority, due, progress, avatars) | 120K | — | — | — | P0 | ⬜ |
| T7.3 | dnd-kit drag-drop between columns + persist status to API | 250K | — | — | — | P0 | ⬜ |
| T7.4 | Realtime board updates + optimistic move + rollback | 180K | — | — | — | P1 | ⬜ |
| T7.5 | Column management UI (add/rename/reorder/disable/color) | 130K | — | — | — | P1 | ⬜ |

### M8 — Task Management UI · ~1,000K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T8.1 | Task details drawer/modal (view + inline edit + auto-save) | 250K | — | — | — | P0 | ⬜ |
| T8.2 | Assignee multi-select (avatar/name/email/dept, "select all", remove) | 150K | — | — | — | P0 | ⬜ |
| T8.3 | Checklist UI + live progress | 100K | — | — | — | P1 | ⬜ |
| T8.4 | Comments UI + `@mentions` + edit/delete own | 160K | — | — | — | P1 | ⬜ |
| T8.5 | Attachments UI (upload/list/preview/remove, type/size validation) | 130K | — | — | — | P1 | ⬜ |
| T8.6 | Dependencies UI + block warnings **(v2)** | 110K | — | — | — | P2 | ⬜ |
| T8.7 | Recurrence UI **(v2)** | 100K | — | — | — | P2 | ⬜ |

### M9 — Projects Module UI · ~540K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T9.1 | Projects list + create/edit form (all fields, status, priority, color, tags, notes) | 200K | — | — | — | P0 | ⬜ |
| T9.2 | Project detail (Board / Tasks / Team / Dashboard / Activity tabs) | 220K | — | — | — | P1 | ⬜ |
| T9.3 | Team member management within a project | 120K | — | — | — | P1 | ⬜ |

### M10 — Dashboard & Charts · ~680K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T10.1 | Dashboard layout + "My Work" widgets | 180K | — | — | — | P1 | ⬜ |
| T10.2 | Admin overall-statistics widgets | 150K | — | — | — | P1 | ⬜ |
| T10.3 | Charts (status, priority, completed-over-time, by-project, workload) | 220K | — | — | — | P1 | ⬜ |
| T10.4 | Dashboard filters (today/week/month/custom/project/employee/status/priority) | 130K | — | — | — | P2 | ⬜ |

### M11 — My Tasks / Calendar · ~470K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T11.1 | My Tasks page (Today/Overdue/Upcoming/In-Progress/Waiting/Completed; list + kanban; filters) | 220K | — | — | — | P1 | ⬜ |
| T11.2 | Calendar (month/week/day; by start/due; project/user filters; click→details) | 250K | — | — | — | P2 | ⬜ |

### M12 — Reports & Export · ~500K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T12.1 | Report pages (task / workload / project / due-date / productivity) + filters | 300K | — | — | — | P1 | ⬜ |
| T12.2 | Export to CSV / Excel / PDF | 200K | — | — | — | P2 | ⬜ |

### M13 — Notifications & Activity/Audit UI · ~360K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T13.1 | Notifications page + mark read + preferences (in-app + email toggles) | 130K | — | — | — | P1 | ⬜ |
| T13.2 | Activity timeline UI | 100K | — | — | — | P2 | ⬜ |
| T13.3 | Audit log viewer (admin) with filters | 130K | — | — | — | P1 | ⬜ |

### M14 — Settings · ~400K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T14.1 | Personal settings (profile, password, language, tz, date format, defaults, theme, in-app + **email notification preferences**) | 180K | — | — | — | P1 | ⬜ |
| T14.2 | Admin/system settings (company, logo, statuses, priorities, columns, departments, notification rules, **email master on/off**, attachment limits) | 220K | — | — | — | P1 | ⬜ |

### M15 — User / Team Management (Admin) · ~300K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T15.1 | User management CRUD UI + status + role assignment | 200K | — | — | — | P0 | ⬜ |
| T15.2 | Team directory page | 100K | — | — | — | P2 | ⬜ |

### M16 — Chrome Extension (MV3) · ~720K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T16.1 | `manifest.json` (MV3) + permissions + branded icons | 80K | — | — | — | P1 | ⬜ |
| T16.2 | Popup UI (Today/Overdue/In-Progress/Completed + ~5 upcoming + actions) | 150K | — | — | — | P1 | ⬜ |
| T16.3 | Background service worker (auth/session, badge count, alarms) | 150K | — | — | — | P1 | ⬜ |
| T16.4 | "Open Full MICO360 Tasks" tab + hosted-URL config + Quick Add from popup | 120K | — | — | — | P1 | ⬜ |
| T16.5 | Chrome notifications integration | 90K | — | — | — | P2 | ⬜ |
| T16.6 | Extension ↔ API security: token storage in `chrome.storage`, CORS policy, badge-count polling interval vs. push (alarms/backoff), rate-limit-friendly sync | 130K | — | — | — | P0 | ⬜ |

### M17 — Testing, QA & Accessibility · ~1,280K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T17.1 | Backend unit/integration tests (auth, RBAC, tasks, assignees, reports, **email dispatch**) | 300K | — | — | — | P1 | ⬜ |
| T17.2 | Frontend component/integration tests | 250K | — | — | — | P1 | ⬜ |
| T17.3 | E2E workflows (login, task lifecycle, kanban, multi-user, realtime, permissions) | 300K | — | — | — | P1 | ⬜ |
| T17.4 | Manual QA pass + bug fixing (console/API/routes/permission issues) | 250K | — | — | — | P1 | ⬜ |
| T17.5 | Accessibility (a11y) audit — WCAG AA: keyboard nav, focus mgmt, ARIA, brand contrast, screen-reader for Kanban drag-drop (build a11y in during M6–M8) | 180K | — | — | — | P1 | ⬜ |

### M18 — Documentation & Deployment · ~350K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T18.1 | API documentation — **OpenAPI 3 + published contract for the mobile team** | 120K | — | — | — | P1 | ⬜ |
| T18.2 | README, install, dev commands, Chrome extension install guide | 100K | — | — | — | P1 | ⬜ |
| T18.3 | Production deployment guide + env (incl. Mailjet vars) + storage (S3-ready) | 130K | — | — | — | P1 | ⬜ |

### M19 — Observability, CI/CD & Ops · ~660K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T19.1 | Structured logging (JSON) + centralized log aggregation | 100K | — | — | — | P1 | ⬜ |
| T19.2 | Error tracking (Sentry) — frontend + backend | 100K | — | — | — | P1 | ⬜ |
| T19.3 | Health checks, metrics, uptime monitoring | 90K | — | — | — | P1 | ⬜ |
| T19.4 | CI pipeline (lint / type-check / test / build on PR) | 120K | — | — | — | P0 | ⬜ |
| T19.5 | CD / deploy automation + **Redis adapter for Socket.IO** multi-instance scaling | 130K | — | — | — | P1 | ⬜ |
| T19.6 | **Backup, data-retention & PII policy: automated DB backups, retention for audit/email logs, per-user data export & erasure (offboarding)** | 120K | — | — | — | P1 | ⬜ |

### M20 — Email Notifications (Mailjet) · ~850K  *(new)*
> Provider **Mailjet** — SMTP `in-v3.mailjet.com:25` and/or **Send API v3.1**; **Event API** for real-time delivery/open/bounce webhooks. Guide: `https://dev.mailjet.com/email/guides/#event-api-real-time-notifications`. Keys in env only (see §5 warning).

| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| T20.1 | Mailjet integration layer: config from env, SMTP (`in-v3.mailjet.com:25`) + Send API v3.1 client, sandbox/test mode, retry/backoff | 130K | — | — | — | P1 | ⬜ |
| T20.2 | Branded MICO360 email templates: task assigned, added/removed assignee, due-soon, overdue, status changed, comment, `@mention`, checklist done, task completed/reopened, **login OTP code**, **password reset**, welcome/new-user | 180K | — | — | — | P1 | ⬜ |
| T20.3 | Dispatch service tied to channel-agnostic notifications (T3.10): async queue, per-event fan-out, `email_log` recording | 150K | — | — | — | P1 | ⬜ |
| T20.4 | **Activation/deactivation controls: system-level master on/off (admin, T14.2) + per-user per-event email preferences (T14.1); respect user status & suppression list** | 120K | — | — | — | P1 | ⬜ |
| T20.5 | **Mailjet Event API webhook receiver:** delivery/open/click/bounce/spam/blocked → update `email_log`, auto-suppress hard bounces/complaints | 150K | — | — | — | P1 | ⬜ |
| T20.6 | Email testing & deliverability verification: send-test button, unit/integration tests, template render checks, SPF/DKIM notes | 120K | — | — | — | P1 | ⬜ |

---

## 7. Recommended build sequence (critical path)

```
M0 (incl. T0.5 wireframes) → M1 → M2 → M3 ─┬─→ M4 ──┐
                                           │        │
M0 → M5 → M6 ──────────────────────────────┴──→ M7 → M8 → (M9–M15 in parallel)
                                                          │
M2/M3/M14 → M20 (email)   M5/M2 → M16 (extension)         │
                                                          ▼
                                    M17 (Test + a11y) → M18 (Docs/Deploy)

M19: CI (T19.4) right after M0; logging/error-tracking alongside M2–M3;
     Redis adapter + CD before first multi-instance deploy.
```

- **T0.5 wireframes come before M6–M8** — approve screens against the brand first; cheapest place to change the UI.
- **CI (T19.4) lands right after M0.**
- **M20 email** needs auth (M2), the notification model (T3.10), and the settings toggles (M14) — build it in v1 after those exist.
- **M7 Kanban is the first vertical-slice / demo milestone.**
- **The API is mobile-ready by construction** (see §2) — no separate mobile-API module needed.

## 8. Milestones

| Milestone | Modules added | Cumulative tokens (mid) |
|---|---|---:|
| **MS1 — Foundations & Auth** | M0, M1, M2, M5 | ~2.84M |
| **MS2 — Core APIs + Shell** | + M3, M6 | ~5.78M |
| **MS3 — Vertical slice (Kanban + Tasks + Realtime)** | + M4, M7, M8 | ~8.04M |
| **MS4 — Feature-complete web app** | + M9–M15 | ~11.29M |
| **MS5 — Extension, email, hardening & ops** | + M16, M17, M18, M19, M20 | ~15.5M |
| **MS6 — Phase 2: Android app** | + A0–A9 (see §11) | ~19.9M |

> **MVP thin slice ≈ 4.7M tokens** (32 tasks, see §3) — ship this first, then v1 (incl. email M20), then v2 (T3.7, T3.8, watchers, T4.3).

## 9. Definition of Done (applies to every task)

A task moves to ✅ only when **all** hold:
1. Wired to the backend/DB — **no hardcoded or mock data** (Dev Rule #1–4).
2. Backend authorization enforced server-side (an Employee hitting an Admin route is rejected regardless of the UI).
3. Input validated; errors return friendly messages (no raw stack traces / SQL to users).
4. Responsive at 1024 / 1366 / 1440 / 1920px; works in light **and** dark theme.
5. No console errors, no dead buttons/menus, no broken routes.
6. Covered by a test **or** a written manual-QA check (see M17).
7. `Act.` tokens recorded and `Status` updated in this tracker.

## 10. Assumptions & risks (affecting token spend)

- Stack assumed: React/TS/Vite/Tailwind/TanStack Query/dnd-kit + Node/TS/Fastify or Express + Prisma + MySQL 8 + Socket.IO + Redis + **Mailjet**. A different stack shifts numbers.
- **Highest-variance / most likely to overrun:** T3.8 recurring, T3.13 reports, T7.3 drag-drop persistence, T4.3 conflict handling, T16.6 extension security, T20.5 email webhooks/deliverability, T17.x testing/a11y, and real-time multi-user sync — hence the **v2 deferral** of T3.7/T3.8/watchers/T4.3.
- Token figures are **development** estimates only; they exclude runtime/API costs (incl. Mailjet send volume) and client-requested design-iteration rounds.
- No hardcoded data: every module is backend-wired; the API is built mobile-ready from day one so the future mobile app reuses it without re-architecting.

---

---

## 11. Phase 2 — Android Mobile App (plan)

> **Prerequisite already met:** Phase 1's API is **mobile-ready by construction** (§2) — versioned `/api/v1`, header-based JWT, OpenAPI 3 contract, absolute asset URLs, channel-agnostic notifications. Phase 2 consumes that same API with **no backend re-architecture**; the only new backend work is the **FCM push channel + `device_tokens`** endpoint (folded into A6.2).
> **Stack — see decision D5:** recommended **React Native + Expo (TypeScript)** to reuse Phase 1's React/TS skills, components and generated API client; native **Kotlin + Jetpack Compose** is the alternative. Estimates below hold for either within ±15%.
> **Auth parity:** the mobile app supports the same login methods added in Phase 1 — **email or username + password**, **email OTP**, and the **5-strike lockout / reset** flow — plus **biometric unlock** (fingerprint/face).

### Phase 2 module map (10 modules, 23 tasks · ~4.38M tokens)

| # | Module | Tasks | Est. tokens | Depends on |
|---|--------|:---:|---:|---|
| A0 | Mobile Foundations (scaffold, design-system port, navigation) | 3 | ~540K | Phase 1 API |
| A1 | Mobile Auth (login, email OTP, biometric, lockout/reset) | 3 | ~450K | A0, M2 |
| A2 | Mobile API / Data Layer (client, offline cache, realtime) | 3 | ~500K | A1 |
| A3 | Dashboard & My Tasks (mobile) | 2 | ~380K | A2 |
| A4 | Kanban & Task Detail (mobile) | 3 | ~700K | A2 |
| A5 | Projects & Calendar (mobile) | 2 | ~380K | A2 |
| A6 | Notifications & Push (FCM) | 2 | ~380K | A2, T3.10 |
| A7 | Settings & Profile (mobile) | 1 | ~150K | A2 |
| A8 | Offline & Sync | 1 | ~250K | A2 |
| A9 | Testing, Play Store Release & Mobile Ops | 3 | ~650K | all A |
| | **TOTAL (Phase 2)** | **23** | **~4.38M** | |

#### A0 — Mobile Foundations · ~540K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A0.1 | Project scaffold (RN+Expo/TS or Kotlin+Compose), Gradle/build config, env & build flavors (dev/prod) | 200K | — | — | — | P0 | ⬜ |
| A0.2 | Design-system port: MICO360 brand tokens, typography, light/dark theming, reusable components | 220K | — | — | — | P0 | ⬜ |
| A0.3 | Navigation (stack/tab/drawer) + deep links (open task/project from push) | 120K | — | — | — | P0 | ⬜ |

#### A1 — Mobile Auth · ~450K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A1.1 | Login (email/username + password) via shared API; secure token storage (Android Keystore / EncryptedSharedPrefs / SecureStore) | 180K | — | — | — | P0 | ⬜ |
| A1.2 | Email OTP login flow (request code → enter code → session) | 120K | — | — | — | P1 | ⬜ |
| A1.3 | Forgot/reset password + account-locked messaging + **biometric unlock** (fingerprint/face) | 150K | — | — | — | P1 | ⬜ |

#### A2 — Mobile API / Data Layer · ~500K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A2.1 | API client generated from OpenAPI + auth/refresh interceptors + error handling | 150K | — | — | — | P0 | ⬜ |
| A2.2 | Data caching / offline read (React Query persist or Room) + optimistic updates | 200K | — | — | — | P1 | ⬜ |
| A2.3 | Realtime (Socket.IO client) for board & notifications | 150K | — | — | — | P1 | ⬜ |

#### A3 — Dashboard & My Tasks · ~380K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A3.1 | Dashboard (My Work widgets, mobile layout) | 180K | — | — | — | P1 | ⬜ |
| A3.2 | My Tasks (Today/Overdue/Upcoming lists + filters) | 200K | — | — | — | P0 | ⬜ |

#### A4 — Kanban & Task Detail · ~700K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A4.1 | Kanban board (mobile columns, swipe/drag, status persist to API) | 300K | — | — | — | P0 | ⬜ |
| A4.2 | Task detail (view/edit, assignees, checklist, comments, attachments) | 300K | — | — | — | P0 | ⬜ |
| A4.3 | Quick Add Task (mobile) | 100K | — | — | — | P1 | ⬜ |

#### A5 — Projects & Calendar · ~380K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A5.1 | Projects list + detail (mobile) | 200K | — | — | — | P1 | ⬜ |
| A5.2 | Calendar (mobile agenda / month view) | 180K | — | — | — | P2 | ⬜ |

#### A6 — Notifications & Push (FCM) · ~380K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A6.1 | In-app notifications screen + preferences (incl. push toggles) | 130K | — | — | — | P1 | ⬜ |
| A6.2 | **Push notifications (FCM):** `device_tokens` registration endpoint + backend push sender (extends T3.10) + client receive + deep-link on tap | 250K | — | — | — | P1 | ⬜ |

#### A7 — Settings & Profile · ~150K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A7.1 | Personal settings, profile, theme, notification prefs (in-app / email / push) | 150K | — | — | — | P1 | ⬜ |

#### A8 — Offline & Sync · ~250K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A8.1 | Offline queue for task/status changes + conflict handling + sync-on-reconnect | 250K | — | — | — | P2 | ⬜ |

#### A9 — Testing, Play Store Release & Mobile Ops · ~650K
| ID | Task | Est. | Act. | Owner | Target | Pri | Status |
|---|---|---:|---:|:--:|:--:|:--:|:--:|
| A9.1 | Testing (unit + UI/instrumented + E2E on device/emulator) | 300K | — | — | — | P1 | ⬜ |
| A9.2 | Play Store release: signing, Play Console, privacy policy, store listing, staged rollout | 200K | — | — | — | P0 | ⬜ |
| A9.3 | Crash/analytics (Crashlytics/Sentry) + CI for mobile builds | 150K | — | — | — | P1 | ⬜ |

### Phase 2 milestones
| Milestone | Modules | Cumulative (Phase 2) |
|---|---|---:|
| **AS1 — App shell + auth + data layer** | A0, A1, A2 | ~1.49M |
| **AS2 — Core app (dashboard, my-tasks, kanban, task detail)** | + A3, A4 | ~2.57M |
| **AS3 — Feature-complete app** | + A5, A6, A7, A8 | ~3.73M |
| **AS4 — Tested & on the Play Store** | + A9 | ~4.38M |

### Whole-program total
**Phase 1 ~15.5M + Phase 2 ~4.38M = ~19.9M midpoint** (~28M with the 1.4× contingency) · **129 tasks · 31 modules.** Ship Phase 1 (web + extension) first — the mobile app is far cheaper to build afterward precisely because the API was made mobile-ready up front.

---

*Update `Act.`, `Owner`, `Target`, and `Status` as work proceeds; recalibrate per §4 at each checkpoint. Resolve **D1** (PM role) before M2/M9 and **D5** (mobile stack) before Phase 2; rotate the Mailjet secret before go-live.*
