# Screen Flows & Information Architecture (T0.5)

Screen-flow reference for the web app, aligned to the MICO360 brand (deep-red `#8B1E1E`,
Archivo display + IBM Plex Sans, the MICO360 logo). These are the flows realised in the shipped
UI (see the components/pages named in each step).

## Auth (unauthenticated)
```
/login ──(password OR email-code OTP)──▶ /dashboard
  ├─ "Forgot your password?" ▶ /forgot ──(email link)──▶ /reset?token=… ▶ /login
  └─ 5 failed logins ▶ account-locked callout ▶ /forgot
```
- Split-screen: branded logo panel (logo-w) + form card. `LoginForm` has Password / Email-code tabs.

## App shell (authenticated) — `AppShell`
```
┌ Sidebar (role-aware) ┬ Header: GlobalSearch · NotificationsBell · user · Log out ┐
│  Dashboard           │ ┌───────────── routed content ─────────────┐              │
│  Board · My Tasks    │ │  (skip-to-content link is first focus)    │              │
│  Calendar · Projects │ │                                           │              │
│  Reports · Team …    │ └───────────────────────────────────────────┘              │
└──────────────────────┴────────────────────────────────────────────────────────────┘
```

## Core flows
- **Board** `/board`: columns + cards (drag-drop persists; live via Socket.IO). Click a card ▶
  **Task drawer** (checklist, assignees, comments, attachments, dependencies, recurrence).
  Admin ▶ "Manage columns".
- **Dashboard** `/dashboard`: stat tiles + status/project charts (project filter) for admins;
  "your assigned tasks" for employees.
- **Projects** `/projects` ▶ card ▶ `/projects/:id` with **Overview** and **Team** tabs.
- **Reports** `/reports`: table + Export CSV / Excel / PDF.
- **My Tasks / Calendar / Notifications / Activity / Team**: list/detail views.
- **Admin**: Users, System settings, Audit log.

## Global patterns
- One task drawer for all task detail/edit; consistent card, chip, and badge treatments.
- Empty, loading, and error states on every data view; `role="alert"`/`role="status"` messaging.
- Responsive 1024–1920px; keyboard-operable throughout (see `ACCESSIBILITY.md`).
