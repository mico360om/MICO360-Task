# Task approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Some tasks need the OK of whoever runs their project before they count as done (1.19.0, web + server).

**Architecture:** The server decides everything: one pure rule (`tasks/task-approval.ts`) says what entering a column does to a task that needs approval, and the task service applies it on every path that changes a task's column (board move, edit, create, approve, send back; the project move, inspection finish and MICO AI go through these). A waiting task is never in a Done column and never has `completedAt`, so every report, count, email, calendar and client page already treats it as not done. The web app adds a badge, a panel section, a send-back dialog, a To-approve list, a Dashboard card, a Management section and a settings switch, each in its own new file with small insertions into existing pages.

**Tech Stack:** Fastify 5, Prisma 5 + MySQL, Vitest; React 18 + Vite + Tailwind + React Query; Playwright for the browser e2e.

**Spec:** `docs/superpowers/specs/2026-10-30-task-approvals-design.md`

## Global Constraints

- Ships in 1.19.0 web-only; no version bumps here; Android 1.11 and the extension get no UI change but must keep working.
- Approvers = `projectAuthz.canManageProject` (admins, owner, named manager, MANAGER members).
- Plain short English copy; user text in `<bdi>`; components/ui/*; 44px touch on coarse pointers (`[@media(pointer:coarse)]:!min-h-11`).
- UI changes additive: new components in their own files, small insertions into existing pages.
- Shared copies with drift tests stay in step (activity-feed: web ↔ backend ↔ Android).
- Migration additive only; rehearsed on a populated database; nothing existing changes state.

## Data model

- `tasks.needsApproval BOOLEAN NOT NULL DEFAULT false`
- `tasks.approvalRequestedAt DATETIME(3) NULL` — non-null **means waiting**
- `tasks.approvalRequestedById VARCHAR(191) NULL` → users (ON DELETE SET NULL) — who finished it
- `tasks.approvedAt DATETIME(3) NULL`, `tasks.approvedById VARCHAR(191) NULL` → users (SET NULL) — last approval (history)
- index `tasks(approvalRequestedAt)`
- `projects.newTasksNeedApproval BOOLEAN NOT NULL DEFAULT false`

## Rulings (the calls the spec leaves to the builder; cost if wrong in brackets)

1. **Waiting = `approvalRequestedAt` set.** Cleared on approve, send back, withdraw and switch-off. [cheap: one column]
2. **Server default for new tasks:** a create that doesn't send `needsApproval` takes the project's "New tasks in this project need approval" (so Android, the extension, MICO AI, meeting notes, inspection follow-ups and template tasks follow the project too). The web form sends it explicitly. Recurring copies keep their source's tick, not the project's. [if the owner wanted the setting to pre-tick only the web form: tasks from the phone would need approval unexpectedly — one line to change]
3. **Where a waiting task sits:** the project's first REVIEW column (switched-on columns first, by board position), else it stays in its current column. Its progress is left as it is (not forced to 100%), so nothing counts it as finished. [low]
4. **Created straight into a Done column** by someone who can't approve, ticked: created in the first REVIEW column, else the first open (not Done) column, waiting. [rare path]
5. **Approve** moves it to the project's first Done column (switched-on first); `completedAt` = approval time, progress 100%, board day = today (as any completion). No Done column → 409 "This project has no Done column." [low]
6. **Send back** moves it to the first IN_PROGRESS column, else the first TODO, else BACKLOG, else it stays; reason required (1–2000 characters), saved as a comment by the approver (written directly — no extra "new comment" notice, because the sent-back notice carries it). [low]
7. **Moving a waiting task by hand to another column that isn't Done withdraws the request** (activity "withdrew the approval request"); a reorder in its own column changes nothing. A non-approver moving it to Done again changes nothing (it stays waiting; answer is the task as it is). An approver moving it to Done approves it. [if wrong: an approver could approve work the assignee took back]
8. **Moving a waiting task to another project keeps it waiting** (the mover runs both projects; the new project's managers see it). Into a Done column it is approved (the mover can approve). [rare]
9. **Unticking while waiting:** approvers only (403 otherwise: "Only the people who run this project can turn off approval while the task is waiting."); the task then completes in the first Done column (activity: the switch-off edit + "completed"). Unticking when NOT waiting: anyone who can edit (spec), and the activity records it. **Flag:** this lets an assignee untick and finish; the owner may want unticking limited to approvers. [one rule to tighten]
10. **Re-opening** (leaving Done, any path) clears `approvedAt/approvedById`; the tick stays, so it needs approval again when finished again.
11. **Approver finishes it themselves** (any path): done at once, `approvedAt/By` = them, activity COMPLETED with `meta.approved = true` → "completed this task (approved)".
12. **Notifications** — one new type `TASK_APPROVAL` (one row in Settings → notifications, mutable like the others):
    - starts waiting → the project's runners (owner, named manager, MANAGER members; active; not the finisher); if none, the active admins. Title "Waiting for your approval", body "KEY · title". No "Task moved to Review" status notice for that move.
    - approved → assignees + the finisher (not the approver): "Your task was approved". No "moved to Done" status notice.
    - sent back → assignees + the finisher: "Sent back: <reason>" (cut to 140). No status notice.
    - Admins see every waiting task in their To-approve list, Dashboard card, daily email and Management page (they can approve all).
13. **To-approve list scope:** waiting tasks in live projects the person can approve (admins: all), oldest waiting first. Same list behind the daily-email line, the Dashboard card and Management (Management keeps its own project filters/scope).
14. **Daily email:** the pending-tasks email gets a line "3 tasks waiting for your approval" with a button to My Tasks' To-approve list; it is sent (subject "3 tasks waiting for your approval") even when the person has no pending tasks of their own but approvals are waiting. Turned off pending email = no line. [low]
15. **Client page:** a waiting task shows "In progress" (never "In review"), no approval details.
16. **Inspection finish** of a check that needs approval: the task waits; the finish answer says so (`taskWaiting`), and the "mark the task done too?" offer is not made. A replayed finish after a send back or withdrawal leaves the task alone.
17. **MICO AI** moving a task that needs approval to Done: saved, with the warning "It needs approval, so it is waiting for a project manager."
18. **API:** `GET /tasks/approvals` → `{ data: { canApprove, tasks } }`; `POST /tasks/:id/approve {expectedVersion?}`; `POST /tasks/:id/send-back {reason, expectedVersion?}`. 404 when the task can't be seen; 403 plain message for non-approvers; 409 `NOT_WAITING` "This task isn’t waiting for approval any more."; 409 `VERSION_CONFLICT`. Audit log `task.approve` / `task.send-back` (module tasks). `GET /tasks/:id` adds `approval: { canApprove, requestedBy, approvedBy, approverName }` (`approverName` = the one person who runs the project, else null → "a project manager’s").
19. **Activity actions:** `APPROVAL_REQUESTED` ("finished this task and asked for approval"), `APPROVED` ("approved this task", status path), `SENT_BACK` ("sent this task back: <reason>"), `APPROVAL_WITHDRAWN` ("withdrew the approval request"), COMPLETED + `meta.approved` ("completed this task (approved)"), UPDATED change `needsApproval` ("turned on Needs approval" / "turned off Needs approval"). No new timeline kinds (the Android copy has a closed kind list): the new actions are `other` lines, APPROVED is a `completed` line.
20. **Board feedback:** after a move that ends waiting, the board/My Tasks/panel say "KEY needs approval — it’s waiting for a project manager." (`lib/approvals.ts`).

### Rulings added after the code review (30 Oct)
21. **Moves of waiting tasks are version-guarded:** a move that asks for approval, approves, or moves a waiting task is saved only from the version just read (VERSION_CONFLICT otherwise), so a drag-back racing an approval can't leave a "done" task in To do. Other moves are unchanged. [low]
22. **Turning approval off on a waiting repeating task applies to that copy only:** the next copy still needs approval. [if wrong: the series keeps needing approval — one click per copy]
23. **No Done column while tasks wait:** a column holding waiting tasks can't be changed to the Done category (409 TASKS_WAITING); a ticked task can't be created into a project that has only Done columns (409 NO_OPEN_COLUMN). [rare]
24. **Steps after a decision never fail it:** a failing comment/notice after Approve or Send back is logged; the saved decision is answered as saved. The web form sends the tick and a new status in one request when both change.
25. **Kept as the spec says (flagged to the owner):** anyone who can edit a task may untick "Needs approval" while it is NOT waiting (owner decision 1: "each task can still be unticked"), so an assignee can untick and then finish. One-line change to limit unticking to approvers if the owner wants.

## Review Focus

1. Two approvers press Approve at the same moment → one approval, the other gets "isn’t waiting any more" (expectedVersion + NOT_WAITING).
2. Approve on a repeating task makes exactly one next copy, which keeps the tick and isn't waiting.
3. Send back with a blank/space-only reason → 400 and nothing changes.
4. A project without a REVIEW column: finishing keeps the column, the badge shows, approve still lands in Done.
5. A non-approver drags a waiting card to Done again → no change, no new notices.

---

### Task 1: Schema + migration
**Files:** `prisma/schema.prisma`, `prisma/migrations/20261030120000_task_approvals/migration.sql`
- [ ] Add the fields above (+ `User` back-relations `approvalsRequested`, `approvalsGiven`), `prisma migrate dev --create-only` on `mico360_t_ap_ci`, check the SQL is additive, `prisma generate`.
- [ ] Commit.

### Task 2: The rule — `tasks/task-approval.ts`
**Interfaces (produces):**
```ts
export interface ApprovalFields { needsApproval?: boolean; approvalRequestedAt?: Date | null; approvalRequestedById?: string | null; approvedAt?: Date | null; approvedById?: string | null }
export type ApprovalEvent = 'REQUESTED' | 'APPROVED' | 'APPROVED_ON_FINISH' | 'WITHDRAWN' | 'SENT_BACK' | 'SWITCHED_OFF';
export function approvalOnEntry(task: { columnId; completedAt; needsApproval?; approvalRequestedAt? }, target: { columnId; category }, ctx: { canApprove: boolean; actorId?: string; at: Date; waitColumnId: string | null }): { columnId: string; patch: ApprovalFields; event: ApprovalEvent | null; unchanged?: boolean }
export const isAwaitingApproval = (t: { approvalRequestedAt?: Date | string | null }) => boolean
```
- [ ] Tests (`task-approval.test.ts`): not ticked → no event; ticked + non-approver + DONE → REQUESTED, column = wait column or current, requestedAt/By; already waiting + non-approver + DONE → `unchanged`; waiting + approver + DONE → APPROVED (clears request, sets approvedAt/By); not waiting + approver + DONE → APPROVED_ON_FINISH; waiting + other non-DONE column → WITHDRAWN; waiting + same column → nothing; leaving DONE → approvedAt/By cleared; no actor → treated as non-approver.
- [ ] Implement, pass, commit.

### Task 3: Task service applies it + approve / send back
**Files:** `tasks/task-service.ts`, `task-repository.ts` (types), `task-service.test.ts`
**Interfaces:** `TaskServiceDeps.approvals?: { canApprove(userId, projectId): Promise<boolean>; firstColumn(projectId, categories: string[]): Promise<{ id: string; category: string } | null> }`; `onMoved(task, prevColumnId, actorId?, extra?: { approval?: ApprovalEvent; reason?: string })`; `getTaskSettings` returns `newTasksNeedApproval`; new `approveTask(id, actorId, { expectedVersion? })`, `sendBackTask(id, actorId, reason, { expectedVersion? })` → `TaskRecord`; errors `ForbiddenError`, `ConflictError('…', 'NOT_WAITING')`.
- [ ] Tests: move/edit paths per Task 2; create default from project; create into Done (ruling 4); unticking while waiting (ruling 9); approve/send back happy paths, NOT_WAITING, version conflict, 403, blank reason, no Done column.
- [ ] Implement, pass, commit.

### Task 4: Prisma repository + recurrence copy
**Files:** `prisma-task-repository.ts`, `prisma-recurrence-port.ts`, `tests/integration/task-approvals.test.ts`
- [ ] DB test: fields round-trip in create/update/findById/list; the next copy of a repeating ticked task keeps `needsApproval` and isn't waiting; approve on MySQL with expectedVersion makes one copy; older rows read `needsApproval false`.
- [ ] Implement (listScalars, toRecord, create data, project lookup), pass, commit.

### Task 5: Status effects — activity + notices
**Files:** `task-status-effects.ts` (+test)
**Interfaces:** deps add `approvers(task, actorId): Promise<string[]>`, `approvalAudience(task, actorId): Promise<string[]>`, `sentBackComment(task, actorId, reason): Promise<unknown>`; `statusChanged(task, prev, actor, { notify?, approval?, reason? })`.
- [ ] Tests for each event (ruling 12, 19): the right action/meta, the right recipients, next copy only on APPROVED/APPROVED_ON_FINISH, no TASK_STATUS for REQUESTED/APPROVED/SENT_BACK, events handled even when the column didn't change.
- [ ] Implement, pass, commit.

### Task 6: Routes
**Files:** `tasks/task-approval-routes.ts` (+test), `task-routes.ts` (needsApproval in schemas; `approval` on GET /tasks/:id), `app.ts`
**Interfaces:** `ApprovalSource { list(viewer: { id; roles }): Promise<ApprovalRow[]>; canApproveAny(viewer): Promise<boolean>; details(viewer, task): Promise<TaskApprovalDetails> }`.
- [ ] Route tests: list scope; approve/send-back 200/403/404/409/400; audit lines; broadcast `task:moved`.
- [ ] Implement, pass, commit.

### Task 7: Project setting
**Files:** project repository/service/routes (+tests), `prisma-starting-content.ts`
- [ ] Tests: create/update/read `newTasksNeedApproval`; only managers can change it (existing project update rule); template starting tasks take it.
- [ ] Implement, commit.

### Task 8: Other paths — project move, inspections, MICO AI, client page
**Files:** `task-move-service.ts`, `task-move-repository.ts`, `prisma-task-move-repository.ts`, `inspections/inspection-service.ts`, `prisma-inspection-ports.ts`, `mico-ai-actions-port.ts`, `client-view-payload.ts`, `client-view-source.ts` (+tests each)
- [ ] Tests per rulings 8, 15, 16, 17. Implement, commit.

### Task 9: Daily email + Management
**Files:** `daily-email-content.ts`, `daily-email-service.ts`, `prisma-daily-email-sources.ts`, `management-service.ts`, `management-source.ts`, `prisma-management-source.ts`, fixture (+tests)
**Interfaces:** daily `tasks.awaitingApproval?(userId): Promise<number>`; `pendingEmail({…, awaitingApproval})`; management `source.awaitingApproval(projectIds): Promise<{ projectId; count }[]>`, metric `'awaiting-approval'`, overview `approvals: { total; projects: { id; code; name; count }[] }`.
- [ ] Tests per ruling 14 and the Management list. Implement, commit.

### Task 10: Server wiring
**Files:** `server.ts`
- [ ] Wire `approvals` deps, status-effect deps, approval source, daily email + management sources; build; start a server on 4421 against a seeded DB and try the API by hand. Commit.

### Task 11: Web — API, helpers, activity wording
**Files:** `api/tasks.ts`, new `api/approvals.ts`, new `lib/approvals.ts` (+test), `lib/activity-feed.ts` (+test, copied to backend + Android)
- [ ] Tests, implement, drift tests green, commit.

### Task 12: Web — badge, panel, send-back dialog, task form, project form
**Files:** new `components/approvals/ApprovalChip.tsx`, `TaskApproval.tsx`, `SendBackDialog.tsx` (+tests); small insertions in `TaskCard.tsx`, `lib/board.ts`, `TaskDrawer.tsx` (an `approval` slot), `TaskDrawerContainer.tsx`, `TaskFormDialog.tsx`, `ProjectFormDialog.tsx`, `api/projects.ts`, My Tasks rows.
- [ ] Tests (render, approve, send back requires a reason, keyboard: Esc cancels, Enter in reason doesn't submit empty), implement, commit.

### Task 13: Web — To approve, Dashboard card, Management, notices
**Files:** new `components/approvals/ToApproveSection.tsx`, `ApprovalsCard.tsx`, `components/management/ApprovalsSection.tsx` (+tests); insertions in `MyTasksPage.tsx`, `DashboardPage.tsx`, `ManagementPage.tsx`, `api/management.ts`, `SettingsPage.tsx` (notification type), `BoardPage.tsx` / `TaskDrawerContainer.tsx` (ruling 20), `InspectionPage.tsx` (ruling 16).
- [ ] Tests, implement, commit.

### Task 14: Verify
- [ ] Backend unit + DB, web, extension, Android lib suites; tsc + eslint both workspaces.
- [ ] Migration rehearsal on a seeded DB with Done/Review tasks: schema diff empty after deploy, no task changes state.
- [ ] Browser e2e `scratchpad/approvals/approvals-e2e.mjs` (spec "Done means"); battery groups task/board/my-tasks/dashboard/management/daily-email/recurring/inspections.
- [ ] CHANGELOG `## [Unreleased]` → `### New features`; drop `mico360_t_ap*` DBs; stop servers.
