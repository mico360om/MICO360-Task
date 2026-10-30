# Task approvals — design (approved by the owner 30 Oct 2026)

Ships in **1.19.0** (web portal + server; minor release, web-only — the Android app keeps 1.11.0 and the
Chrome extension is unchanged, but the SERVER enforces the rules for every client).

## Why
MICO360 is an oil & gas / engineering services company in Oman. Some work — a report, a drawing, an
inspection write-up, a client deliverable — must be checked by the person who runs the project before
it counts as finished. Today anyone who moves a task to a Done column finishes it. The owner wants
"some tasks need a manager's OK before they count as done", with a clear list for managers.

## Owner's decisions (question box, 30 Oct)
1. **Which tasks:** the ones someone ticks — a **"Needs approval"** tick on the task (New task / Edit
   task form, and the task panel), **plus a project setting** "New tasks in this project need approval"
   that pre-ticks the box for new tasks in that project (each task can still be unticked/ticked).
2. **Who approves:** **whoever runs the project** — the project's manager/owner (the same people
   `projectAuthz.canManageProject` already allows: admins, the named manager/owner, project MANAGER
   members) — and **administrators can always approve**.
3. **On finish:** the task **waits**. Moving/marking it done puts it in **"Waiting for approval"** — it
   is NOT done (not counted in completion %, done counts, "completed yesterday", reports, the
   recurring "next copy" trigger, etc.). The approver can **Approve** → it becomes done (completedAt =
   approval time, it moves to the first Done column) — or **Send back** with a **required reason** →
   it returns to **In progress** (first IN_PROGRESS column, else TODO), the reason is added as a
   comment from the approver, and the assignees are notified.
4. **Where approvers see what's waiting:** all four —
   - **My Tasks: a "To approve" list** (tab or section) with Approve / Send back on each row;
   - **a notification** when a task starts waiting (to its approvers) and when it is approved / sent
     back (to its assignees and whoever finished it), **and a line in the morning daily task email**
     ("3 tasks waiting for your approval");
   - **a Dashboard card** "Waiting for your approval (N)" (hidden or a one-line "nothing waiting" when
     zero — follow the Dashboard's existing pattern);
   - **the Management page**: approvals waiting per project (and a total), clickable to the list.

## Rules (lead's calls — the builder follows these; flag any that turn out impossible)
- **Who can tick "Needs approval"**: anyone who can edit the task. **Who can untick it** (owner, 30 Oct):
  only the people who run the project (`canManageProject`) and administrators — waiting or not; the
  server refuses anyone else (403), and in a project with the setting below their new tasks keep the
  tick even if they send it off. For them the web shows the tick on but locked, with the reason. Who
  can change the project setting: whoever can manage the project.
- **Waiting state**: model it so the board shows it naturally. Preferred: when a task that needs
  approval is moved to a DONE-category column (board drag, status picker, quick "complete", MICO AI
  action, the Chrome extension, the Android app, inspection finish — EVERY path that completes a task
  goes through the server), the server instead puts it in the project's first **REVIEW**-category
  column if the project has one, else keeps its current column, and marks it `awaitingApproval`
  (a timestamp + who finished it). The UI shows a "Waiting for approval" badge everywhere the task
  appears (card, list row, panel). Choose the exact model (fields on Task, e.g. `needsApproval Boolean`,
  `approvalRequestedAt DateTime?`, `approvalRequestedById String?`, plus `approvedAt/approvedById`
  for history) — keep it minimal; record decisions in the plan.
- **Approver finishes it themselves**: if a person who can approve completes the task, it's done at once
  (no self-approval round trip). Record this in the activity as "completed (approved)".
- **Activity/history**: "asked for approval", "approved", "sent back: <reason>" entries in the task's
  activity, and the audit log for approve/send back.
- **Unticking "Needs approval" while waiting**: allowed for approvers only (as at any other time); the
  task then completes normally (log it). Re-opening an approved task clears the approval (it must be approved again when
  finished again).
- **Repeating tasks**: the next copy keeps "Needs approval"; the next copy is created when the task is
  APPROVED (i.e. when it actually becomes done), not when it starts waiting.
- **Inspection checks** (tasks carrying an inspection form): finishing the inspection completes the
  task today — if the task needs approval it waits instead, like any other path.
- **Daily/weekly emails, reports, Management, Calendar, Timeline, Workload, client view**: a waiting
  task is not done. The client page shows it as in progress (no approval details to clients).
- **Permissions on the API**: approve / send back only for approvers (403 otherwise, plain message);
  version/conflict handling like other task updates (expectedVersion where the task API uses it).
- **Android app 1.11 / Chrome extension**: no UI changes now; they must keep working — a completion
  from them simply lands in "Waiting for approval" (their next fetch shows the task in its new column).
  Note any client that would show something misleading. (30 Oct follow-up: the extension's My Tasks
  "Mark done" and board now say "waiting for approval" and show the task where the server put it.)

## UI (keep the brand and design system; reuse components/ui/*; 44px touch targets on coarse pointers)
- Task form + task panel: a "Needs approval" tick with a one-line hint ("A project manager must
  approve it before it counts as done"). Waiting tasks: a badge plus, for approvers, Approve / Send back
  buttons in the panel; for others, "Waiting for <name>'s approval" (or "a project manager's").
- Send back: a small dialog with a required reason (and Cancel), keyboard friendly.
- Project settings (project form / project page settings): "New tasks in this project need approval".
- My Tasks "To approve" list, Dashboard card, Management column/section, notifications, daily email
  line — as in the decisions above.
- Plain, short English copy; no jargon. Arabic names/titles in `<bdi>`.

## Out of scope
Multi-step approvals, approval of documents/attachments separately, approval deadlines/escalation,
Android/extension UI.

## Done means
Test-first throughout (unit + DB integration + web tests), a migration rehearsed on a populated
database, all suites green (backend unit, DB, web, extension, Android lib drift tests if shared code
changes), tsc/eslint clean, and a browser e2e script covering: tick + finish → waiting; approver
approves → done (completion % changes, recurring next copy appears); send back → in progress with the
reason comment and notifications; approver finishes own task → done at once; the To-approve list,
Dashboard card, Management count and daily email line; permission refusal for a non-approver.
