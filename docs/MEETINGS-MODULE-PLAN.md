# Meeting Management & Meeting Notes — Implementation Plan

> **Progress (2026-09-13):** ✅ **Phase 0 (Foundations/schema)**, ✅ **Phase 1 (Meeting CRUD + Attendees)**,
> ✅ **Phase 2 (Agenda Management)**, and ✅ **Phase 3 (Live Meeting Notes — core)** are COMPLETE, wired
> end-to-end, and live-verified in the browser. Backend meetings module = 50 tests (meeting service/access/routes
> + attendees + agenda + notes), full backend suite 623 green; frontend 275 green; tsc/lint clean. Shipped:
> schema (13 models, both Prisma files + MySQL migration), meeting + attendee + agenda + note ports/adapters/
> services/routes, object-level `canViewMeeting`, and the web UI (sidebar entry, list page with filters,
> create/edit modal with **optional project**, detail page with status lifecycle + attendee management +
> attendance tracking + agenda (add / reorder / complete / presenter+minutes) + **Live Notes: typed blocks
> (Discussion/Decision/Action Item/Issue/Question/Information), color-coded, author+timestamp, highlight,
> ⌘/Ctrl+Enter capture, type filter, inline edit, delete**). Note→Task link field (`note.taskId`) is in place for Phase 4.
> **Also ✅ Phase 4 (⭐ Create Task from Note) 2026-09-13:** any note promotes into a board Task — a ⭐ action on
> each note opens a modal auto-populating title (from the note), project (defaults to the meeting's; required for a
> standalone meeting), priority, due date and assignee; creating lands the task in the project's first column with a
> description back-referencing the meeting, back-links the note (`note.taskId`), swaps the ⭐ for a clickable
> "✓ Task created" badge, and offers "Open task" (global task drawer). Backend `note-task-service` + `POST
> /meetings/:id/notes/:noteId/task` (canView-gated, target-project access-checked). Verified live end-to-end.
>
> **Also ✅ Phase 5 (Action Items register) + "My Action Items" 2026-09-15:** first-class action items
> (Open→In Progress→Pending→Completed→Cancelled) with assignee, due date, priority, progress and **overdue**
> highlighting — a register on each meeting plus a cross-meeting **`/my-action-items`** view (`GET /me/action-items`).
> **Also ✅ Unified search + Meeting Knowledge Base 2026-09-15:** search now indexes meetings and their
> agenda/notes/decisions (access-scoped), returning matched **snippets**; global search shows a "Meetings" group.
>
> **Next: Phase 3 sub-features (note attachments/comments/checklists, @mentions, autosave/undo) as needed, then Phase 6 (Decisions register) → …** per the phases below.
>
> **Also shipped (Phase 7 slice) 2026-09-13:** ✅ **Minutes of Meeting PDF export** — a proper, dependency-free
> multi-page PDF (`lib/pdf-document.ts` layout engine + `modules/meetings/minutes.ts` composer) served at
> `GET /meetings/:id/minutes.pdf` (auth-gated) with masthead, meeting metadata, summary, attendees (with
> attendance), numbered agenda, and Decisions / Action Items / Discussion pulled from the notes — plus an
> "Export minutes (PDF)" button on the meeting detail page. **Enhanced with complete system branding** (vector
> MICO360 logo mark drawn as a gradient tile + white check, brand-colored headings/rules driven by the configured
> `Brand` palette, 3-line branded footer with company · website · support · address, all from `resolveBrand()`)
> and a **Project details** section (code, client, owner, status, timeline) for project-linked meetings. 17 tests; live-rendered and verified.
>
> **Also shipped 2026-09-15:** ✅ **Meeting invitations, reminders & calendar (.ics) sync** — a dependency-free
> RFC-5545 `.ics` builder (`lib/ics.ts`, REQUEST/CANCEL + RRULE), email attachments on the Mailjet mailer,
> meeting invite/reminder/cancellation/minutes email templates, and a `meeting-notify-service` that resolves the
> organizer + internal/external attendees and sends. Endpoints: `POST /meetings/:id/invites` (send/re-send
> calendar invites), auto-cancellation notice on `POST /:id/cancel`, and `POST /meetings/:id/minutes/send`
> (email the branded PDF). A **reminder sweep** (lease-locked, every 15 min, 60-min lead) emails attendees before
> the meeting, tracked by new `Meeting.invitesSentAt`/`reminderSentAt` columns. UI: **Send invites / Email minutes**
> buttons + "✉ Invites sent" status on the meeting detail page. 16 backend tests; live-verified end-to-end.

A complete Meetings module for MICO360 Tasks, supporting **both project-linked and standalone**
meetings. Built on the existing architecture: backend ports/adapters + Prisma (dev Postgres via
`db push`, prod MySQL migration), React + TanStack Query + Zustand frontend, TDD throughout.
The flagship flow is **Meeting → Agenda → Live Notes → Action/Decision → Create Task → Follow-Up**,
with a note convertible to a task in one–two clicks.

---

## Key architectural decisions (confirm before Phase 1)

1. **Structured typed notes, not a monolithic rich-text doc.** Each note is an addressable entity
   `{ type, body, timestamp, author, mentions, highlight, attachments, taskId? }` with `type` one of
   Discussion/Decision/Action/Issue/Question/Information. Rich text = constrained inline markdown
   (bold/italic/lists/@mention/link) rendered via the existing safe tokenizer (no
   `dangerouslySetInnerHTML`). **Why:** convert-to-task, action items, decisions, and search all fall
   out of typed blocks naturally; avoids a heavy ProseMirror/TipTap dependency and CSP friction.
   Undo/redo, autosave, and keyboard shortcuts operate at the note-list level.
2. **Action Items are first-class and distinct from Tasks.** ActionItems are meeting-native,
   lightweight (Open→In Progress→Pending→Completed→Cancelled). A note or action can be *promoted* to a
   board **Task** via the ⭐ Create-Task flow; links are kept both ways (`note.taskId`,
   `actionItem.taskId`). This honors both "Action Items as a major feature" and "Create Task from note".
3. **`projectId` is nullable everywhere** (Meeting, AgendaItem inherits, ActionItem, Decision,
   Task-from-note). Standalone meetings keep everything project-independent.
4. **Object-level authz — new `canViewMeeting`**: admin OR organizer OR attendee OR (project meeting
   AND project member). Mirrors the existing `projectAccess` pattern; standalone meetings are scoped to
   organizer + attendees.
5. **Recurring meetings reuse the task `RecurrenceRule`** shape + the pure recurrence logic; occurrences
   are materialized like task recurrence (`recurrenceParentId`).
6. **Reuse, don't reinvent:** `AttachmentStorage` + magic-mime for note/decision files; `Activity` for
   the meeting feed; `Notification` + the existing sweep/dispatch pattern for reminders/minutes; the
   `?task=` global drawer for note→task navigation; the report-service aggregation pattern for the
   dashboard; the search data source for global search.
7. **Transcripts = an optional free-text field + uploaded transcript doc, made searchable.** No
   audio→text pipeline in this module (flag as future).
8. **Minutes email** uses the existing `emailService` (best-effort) — full deliverability still needs
   the Mailjet key rotated (see [[mico360-tasks-build]]); in-app minutes/notifications always work.

---

## Data model (new Prisma models — both schema.prisma + schema.postgres.prisma, in lockstep)

- **Meeting** — `id, title, description?, category?, status(DRAFT|SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED),
  projectId? (null=standalone), organizerId, location?, onlineLink?, startAt, endAt?, timeZone?,
  recurrenceRule Json?, recurrenceParentId?, templateId?, transcript? @db.Text, createdById,
  createdAt/updatedAt/deletedAt`.
- **MeetingAttendee** — `id, meetingId, userId? (internal) | externalName?/externalEmail? (external),
  role(REQUIRED|OPTIONAL), attendance(INVITED|PRESENT|ABSENT|LATE|EXCUSED), departmentSnapshot?`.
- **AgendaItem** — `id, meetingId, title, ownerId?, expectedMinutes?, position, completed,
  linkedPrevActionId?`.
- **MeetingNote** — `id, meetingId, agendaItemId?, authorId, type(DISCUSSION|DECISION|ACTION|ISSUE|
  QUESTION|INFORMATION), body @db.Text, highlighted, createdAt, editedAt?, taskId? (convert link),
  actionItemId?, decisionId?`. Mentions parsed like chat.
- **MeetingNoteAttachment**, **MeetingNoteComment**, **MeetingNoteChecklistItem** — note sub-entities
  (mirror existing task attachment/comment/checklist patterns).
- **ActionItem** — `id, meetingId?, agendaItemId?, sourceNoteId?, projectId?, description, assigneeId?,
  priority, status(OPEN|IN_PROGRESS|PENDING|COMPLETED|CANCELLED), dueDate?, progress Int, completedAt?,
  taskId?, createdById, timestamps` + comments/attachments.
- **Decision** — `id, title, description?, decidedOn, meetingId?, projectId?, ownerId?, status,
  createdById, timestamps` + `DecisionParticipant`, supporting docs (attachments), and an append-only
  history (reuse Activity or a `DecisionHistory` row).
- **MeetingMinutes** — `id, meetingId @unique, content @db.Text, status(DRAFT|IN_REVIEW|APPROVED|SENT),
  generatedAt, approvedById?, approvedAt?, sentAt?`.
- **MeetingTemplate** — `id, name, projectId?, defaults Json (category, agenda items, default attendees)`.

Migration flow (per session convention): edit **both** schema files → stop backend (Dropbox EPERM) →
`prisma generate --schema schema.postgres.prisma` → `prisma db push --schema …postgres…` →
hand-author the MySQL migration → rebuild dist → restart.

---

## Backend module layout (`src/modules/meetings/`)

Follow the four-file ports/adapters shape per aggregate: `*-repository.ts` (port), `prisma-*-repository.ts`
(adapter), `*-service.ts` (pure factory), `*-routes.ts` (HTTP + Zod). Aggregates: `meeting`, `attendee`,
`agenda`, `note`, `action-item`, `decision`, `minutes`, `template`, `meeting-access` (authz), plus a
`meeting-dashboard`/reports aggregation. Wire each conditionally in `app.ts` and compose in `server.ts`.

---

## Phased delivery (each phase: TDD → tsc/lint → rebuild+restart → live-verify)

### Phase 0 — Foundations & schema
- [ ] New Prisma models + enums in both schema files; `db push` (dev) + MySQL migration; regenerate client.
- [ ] `meetings/` module skeleton + `meeting-access` (`canViewMeeting`, `accessibleMeetingIds`).
- [ ] DI wiring in `app.ts`/`server.ts`; `/meetings` route + sidebar entry ("Workspace" group); empty page.
- [ ] Frontend `api/meetings.ts` client scaffold; query-key conventions.

### Phase 1 — Meeting CRUD + attendees + calendar + standalone/project
- [ ] Create / edit / **duplicate** / **cancel** meetings; status transitions; category; location/online link.
- [ ] Organizer + attendees (internal via directory, external by name/email; required/optional).
- [ ] **Optional Project** selection (No Project = standalone); recurrence (reuse `RecurrenceRule`).
- [ ] Meetings list + Meeting detail pages; basic templates (create-from-template).
- [ ] **Calendar integration** — meetings on `CalendarPage` alongside task due dates.
- [ ] Meeting reminders via the existing notification sweep.

### Phase 2 — Agenda management
- [ ] Agenda items CRUD; owner/presenter; expected duration; drag-reorder; mark completed.
- [ ] Link previous-meeting actions to agenda items.

### Phase 3 — Live Meeting Notes (the core screen)
- [ ] Typed note blocks (Discussion/Decision/Action/Issue/Question/Information); timestamped; per-author.
- [ ] @mention employees; highlight important; attach files/images; per-note comments; per-note checklists.
- [ ] Autosave; undo/redo; keyboard shortcuts; realtime co-presence (reuse socket where cheap).

### Phase 4 — ⭐ Create Task from Note  +  Attendance
- [ ] "Create Task" on any note → prefilled, **editable** NewTask modal (title/desc, assignee, project if
      linked, related meeting/agenda/note, priority, due date, status, attachments) → creates a real Task.
- [ ] "Task Created" indicator/link on the note (navigate via `?task=` drawer); multi-note → multi-task.
- [ ] Attendance tracking: Present/Absent/Late/Excused + attendance history; **suggest attendees** from
      previous meetings (same project or same organizer).

### Phase 5 — Action Items (first-class)
- [ ] Full lifecycle (Open→In Progress→Pending→Completed→Cancelled); priority; due date; progress;
      completion date; comments; attachments; links to meeting/agenda/note/task; **overdue highlighting**.
- [ ] "My Action Items" view + per-meeting action list.

### Phase 6 — Decisions & Resolutions register
- [ ] Decision CRUD; register view; owner + participants; supporting docs; status; decision history;
      standalone/project; answers "what did we decide?".

### Phase 7 — Follow-up management
- [ ] Auto-generate meeting minutes from notes/decisions/actions; review + **approval workflow**;
      send minutes to attendees (email, best-effort); action-item reminders + overdue reminders (sweep);
      create follow-up meeting; **carry unfinished actions** into the next meeting.

### Phase 8 — Dashboard + Search & Knowledge Base
- [ ] Meetings dashboard KPIs (meetings upcoming/completed/cancelled/recurring; actions
      open/in-progress/completed/overdue; recent/pending decisions; attendance rate/frequent absences).
- [ ] Extend global search across meetings, notes, attendees, actions, decisions, agenda, transcripts,
      attachments — e.g. "decisions related to Duqm in the last 3 months" (project + date filters).

### Phase 9 — Parity & docs (optional)
- [ ] Android/Extension read parity for meetings/actions; OpenAPI + docs; final E2E sweep.

---

## Integration touch-points (existing code to extend)
- `App.tsx` routes + `Sidebar` nav; `CalendarPage` (meetings); global `?task=` drawer host (note→task nav).
- `search` data source + service (index meeting entities, scoped by `accessibleMeetingIds`).
- `notifications` sweeps (`server.ts`) for meeting/minutes/action reminders + overdue; `Activity` feed.
- `AttachmentStorage` + magic-mime for note/decision files; `report-service` pattern for the dashboard.
- `projectAccess` pattern → new `meeting-access`.

## Effort & sequencing note
This is large (≈10 new models, ~9 backend aggregates, ~6 new pages). Recommend shipping **Phase 0+1**
first (usable meetings end-to-end), then **Phase 3+4** (the core notes screen + the ⭐ task flow — the
highest-value slice), then the rest. Each phase stays green (backend + frontend suites) before the next.

## Open questions to confirm
1. Editor: OK with **structured typed note blocks** (recommended) vs a single free-form rich-text doc?
2. Action Items vs Tasks: OK keeping them **distinct but linkable** (recommended)?
3. Transcripts: **field + uploaded doc, searchable** for now (no audio transcription)?
4. Minutes email: acceptable that it's **best-effort** until the Mailjet key is rotated?
5. Start with **Phase 0+1** now?
