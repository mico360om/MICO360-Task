# Scheduled inspections — design (approved 27 Oct 2026)

Ships in **1.18.0** (web + server only), together with the Management dashboard (built in parallel in
`D:/mico-release/wt-mgmt-dash`, branch `feat/mgmt-dashboard`, which reads the same two task fields).

## Why

Inspections (1.17.0) are started by hand. Field teams do the same checks on a rhythm ("daily rig check
every working morning", "weekly fire-extinguisher check"). Today nobody is reminded, and a missed check
is invisible. A schedule makes each check arrive on its day, assigned to the inspector, and makes a
missed one visible as late.

## Owner decisions (verbatim intent — do not change)

1. **Each scheduled check is a TASK that carries the form.** e.g. "Daily rig check – Rig 3", due that
   day, assigned to the inspector. It therefore shows in My Tasks, the Calendar (incl. projected future
   repeats), reminders and the morning task email with no extra work. Opening it starts the checklist.
2. **The next one is created ON SCHEDULE, always** — Monday's check appears on Monday even if Friday's
   wasn't done (`recurrenceRule.createNext = 'ON_SCHEDULE'`).
3. **A missed check STAYS OPEN as an overdue task and can be done late.** Finishing it later records it
   as **done late**. Nothing is auto-closed.
4. **The same inspector(s) every time** (the task's assignees; no rotation). Changing them on the
   schedule changes future checks.
5. **Anyone on the project team** (plus admins) can set up, change or stop a schedule on that project.
6. My calls the owner approved: finishing the checklist **completes the task automatically**; deleting a
   form **stops the schedules that use it**, but checks already created can still be done; the New/Edit
   task form gets an optional **"Inspection form"** field, so a one-off task can carry a form too.

## Data (already committed in 39e4a4d — do not change the migration)

`tasks.inspectionFormId` (nullable FK → `inspection_forms.id`, ON DELETE SET NULL, indexed) and
`tasks.inspectionPlace` (VARCHAR(200), nullable). Migration `20261028120000_task_inspection_form`.
Prisma relation `Task.inspectionForm` / `InspectionForm.tasks` (name `"TaskInspectionForm"`).
Forms are soft-deleted (`deletedAt`), so the FK normally stays set after a delete.

Definitions used everywhere (server is the source of truth; the dashboard uses the same rules):
- **check** = a non-deleted task with `inspectionFormId` not null.
- **schedule** = the newest copy of a repeating series that carries a form (`recurrenceRule` not null
  AND `inspectionFormId` not null). Only the newest copy carries the rule (existing model).
- **done** = the task is completed (in a Done-category column, `completedAt` set).
- **done late** = `completedAt` is after the end of the task's due day in the company time zone
  (`COMPANY_TIMEZONE`) — exactly `completedOnTime(due, completedAt, tz) === false` from
  `backend/src/lib/due-date.ts` (reuse it; do not write a second rule).
- **missing / late (open)** = not done and `isOverdue(due, tz, now)` from the same file.
- **closed without a report** = done, but no finished inspection is linked to the task.

Put these rules in ONE small exported module (e.g. `backend/src/modules/inspections/inspection-checks.ts`
with pure functions such as `checkState(task, nowZoned) → 'DUE' | 'LATE' | 'DONE' | 'DONE_LATE'`), so the
dashboard branch can import the same file at integration. Keep its name and exports stable and document
them at the top of the file.

## Server

1. **Task create/update** (`modules/tasks/validation.ts`, `task-service.ts`, `task-routes.ts`): accept
   `inspectionFormId` (string | null) and `inspectionPlace` (string | null, trimmed, empty → null, ≤200).
   A form id must name an existing, non-deleted form (404/400 with a plain message otherwise). Clearing
   the form on a task is allowed. Changing it only affects inspections started afterwards (a started
   inspection has its own copy of the checklist). Record changes in task history the way other fields are
   (if a new activity wording is needed, all 4 copies of the wording must change — web
   `frontend/src/lib/activity-feed.ts`, Android `Android App/src/lib/activity-feed.ts`, extension
   `Extension/src/activity-feed.js`, server — the drift tests enforce it; prefer reusing the generic
   "updated" wording).
2. **Task reads**: task list/board payloads include `inspectionFormId` and `inspectionPlace`;
   `GET /tasks/:id` also returns `inspectionForm: { id, title, deleted } | null`.
3. **Repeat copies keep the form**: `modules/tasks/prisma-recurrence-port.ts` copies `inspectionFormId`
   and `inspectionPlace` like `isMilestone`/`meetingId`. The on-schedule sweep must not make a copy for a
   series whose form is deleted (belt and braces — deleting a form already stops them, item 6).
   Check every other place a task is copied/duplicated (templates "Save as template" excluded — out of
   scope) and keep the fields where a copy is meant to be the same task (e.g. move between projects keeps
   them; forms are company-wide).
4. **Schedules list**: `GET /projects/:id/inspection-schedules` (project team + admins) → the project's
   schedules: newest-copy task id + key, title, form `{id,title,deleted}`, place, assignees, a plain
   repeat summary (reuse `recurrence-summary.ts`), next due date, last done date, open checks count and
   late (open past due) count for the series (`recurrenceParentId`).
5. **Due checks list**: `GET /projects/:id/inspection-checks?state=open` (team + admins) → open checks
   (one-off or scheduled), late first then by due date, each with state (`DUE`/`LATE`), days late,
   assignees, form, place, and whether an inspection is in progress for it (and by whom). Cap the list
   (e.g. 200) with a total count.
6. **Deleting a form** (`DELETE /inspection-forms/:id`): also stops every schedule using it — set
   `recurrenceRule` to null on those newest copies through the same path a person stopping a repeat uses
   (so history/notifications behave the same), in one transaction with the soft delete. Add
   `GET /inspection-forms/:id/usage → { schedules, openChecks }` for the confirm dialog. Starting an
   inspection from a task whose form was deleted must still work (the checks already created can be
   done): `inspection-service` start must accept a soft-deleted form **only** when the start is for a
   task that carries that form; a fresh start from a deleted form stays refused.
7. **Finishing completes the task**: when a finished inspection's task carries a form and the task isn't
   done, the server completes it in the same request — moved to the project's first Done column (there is
   already a helper for "the project's first Done column"), as the finishing person, through the normal
   status path so every side effect runs (history, notifications, watchers, ON_COMPLETE repeats, sockets).
   If the project has no Done column, leave it and keep today's offer. It must be idempotent with the
   finish replay (`finishId`) and work for finishes that arrive from the offline outbox. The finish
   response says what happened (e.g. `taskCompleted: { id, key, title } | null`) so the page can show
   "Task KEY completed" instead of the "mark the task done too?" offer. Tasks WITHOUT a form keep today's
   offer unchanged. Reopening an inspection does NOT reopen the task (my call).
8. **Permissions**: creating, editing and stopping a scheduled check uses the normal task rules; make
   sure any project team member (and admins) can create a repeating task with a form, edit its repeat,
   inspectors, place and form, and stop it — matching the owner's decision. Non-members get 403/404 as
   elsewhere. The new GET endpoints follow project visibility.

## Website

1. **Project › Inspections tab** (`frontend/src/components/inspections/ProjectInspectionsTab.tsx`): two
   new sections above the existing inspections list:
   - **Due checks** — open checks, late ones first with "2 days late" in the danger colour, then due
     today, then upcoming. Each row opens the task (drawer) and has **Start** / **Continue**.
   - **Schedules** — each schedule: title, form, place, inspectors (avatars), repeat summary, next due,
     last done, late count; actions **Edit** and **Stop** (confirm: "Stop scheduling? Checks already
     created stay."). Header button **Schedule an inspection**.
   - The existing finished-inspections list shows **Done late** (with how late) where it applies.
2. **Schedule dialog** (new + edit): Form (required, searchable, forms listed by the forms API), Name
   (defaults to "<form title> – <place>" or the form title, editable, follows the form/place until the
   person types their own), Place (optional), Inspector(s) (≥1, from the project team — reuse the task
   form's `AssigneeSelect`), Starts on (date, default today), Repeat (reuse `RecurrenceEditor`; presets
   Every day / Every working day (the company's working days, as Workload uses) / Weekly on… / Monthly /
   Custom; ends Never / On a date / After N), always `createNext: 'ON_SCHEDULE'` (not shown). Save
   creates/updates the task through the normal task API. A plain-English line under Repeat says what will
   happen ("A check is created every working day, due that day, for Ali and Sara.").
3. **Task form** (`components/task-form/TaskFormDialog.tsx`, New + Edit): optional **Inspection form**
   picker and, when a form is chosen, **Place**. When a form is chosen and the person turns on Repeat,
   default `createNext` to on-schedule (they can still change it in the editor).
4. **Task drawer** (`components/inspections/TaskInspections.tsx` and the drawer header): when the task
   carries a form — a primary **Start inspection** button (pre-filled form + place + task) if none is
   started; **Continue inspection** when one is in progress; **View report** when finished. Show the form
   name, and "Form deleted — this check can still be done" when it was deleted.
5. **Badge**: a small "Inspection" chip (clipboard icon) on task cards wherever task cards/rows already
   show chips (board card, My Tasks row, drawer header) — keep it light and accessible (text, not icon
   alone).
6. **Inspection page** (`pages/InspectionPage.tsx`): after a finish that completed the task, show
   "Task KEY completed" (no offer). Keep the offer for tasks without a form, and the existing fallback
   when the project has no Done column.
7. **Forms manager delete** (`InspectionFormsManager.tsx`): the confirm shows the usage — "2 schedules use
   this form; they'll stop. 3 checks already created can still be done."

Follow the existing design system (tokens in `rgb(var(--c-…))`, Tailwind em breakpoints, `PageHeader`,
`EmptyState`, `SearchableSelect`, dark mode, 44px touch targets on coarse pointers, `dir="auto"` on user
text, Arabic text safe). Phone width 375 must work (the tab is used in the field).

## Out of scope

Rotation between inspectors; auto-closing missed checks; photos; Android app and Chrome extension
changes (they show checks as ordinary tasks; a check closed there counts as "closed without a report");
project/task templates carrying a schedule; time tracking.

## Tests (test-first)

Backend unit + route tests for every rule above, DB tests (`TEST_DATABASE_URL`) for: repeat copies keep
the form/place; on-schedule sweep skips a deleted form; form delete stops schedules in one transaction;
finish completes the task once (replay + outbox) through the normal status path; done-late uses the
company time zone at the day boundary (Asia/Muscat, 23:59 vs 00:01); team member allowed / non-member
refused. Web component tests for the dialog, the two lists, the drawer buttons, the task-form field and
the forms-manager confirm. A browser e2e (Playwright, see the brief) on a throwaway database.
