# Manual QA Checklist (T17.4)

Run before each release, in addition to the automated suite (`npm test` → 380+ unit/route tests,
`npm run test:db` → Prisma integration, `npm run test:e2e` → live-API E2E).

## Auth
- [ ] Log in by **email** and by **username**.
- [ ] **Email-code (OTP)** sign-in: request code → enter code → signed in.
- [ ] **5 failed logins** → account **locked (423)**; **Forgot password** → reset link → new
      password signs in, old rejected, account unlocked.
- [ ] Log out clears the session; protected routes redirect to `/login`.

## RBAC
- [ ] Employee cannot see/use admin nav (Users, System settings, Audit) and admin API returns 403.

## Board & tasks
- [ ] Drag a card between columns; the move **persists** on reload.
- [ ] Open the task drawer: toggle/add **checklist** items (progress updates), post a **comment**,
      add/remove **assignees**, upload/download/remove an **attachment**, add/remove a
      **dependency** (a cycle is rejected), set/clear **recurrence**.
- [ ] Move a **recurring** task to Done → a **next occurrence** appears with the right due date.
- [ ] Admin: **Manage columns** — add / rename / recolour / enable / reorder / delete.

## Projects & team
- [ ] Open a project → **Team** tab; admin adds/removes members; employee sees read-only.

## Dashboard, search, notifications, reports
- [ ] Dashboard shows stat tiles + status/project charts; project filter works.
- [ ] Global search returns tasks/projects/people; results link out.
- [ ] Notifications bell shows unread count + list; "Mark all read" clears it.
- [ ] Reports export as **CSV, Excel, PDF** (files open correctly).

## Real-time & extension
- [ ] Two browsers on the same board: a move in one appears in the other without reload.
- [ ] Chrome extension popup shows today/overdue/etc.; badge shows unread; opens the app.

## Cross-cutting
- [ ] No console errors; no dead buttons/links.
- [ ] Works 1024–1920px; light theme legible; keyboard-only navigation works (see ACCESSIBILITY.md).
