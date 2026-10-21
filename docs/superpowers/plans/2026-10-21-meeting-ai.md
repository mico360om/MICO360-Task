# Meeting AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI and calendar help in Schedule meeting — fill the form from a sentence, people and agenda in the new-meeting form (saved in one go), free times (3 suggestions, clash warning, busy strip) inside company working hours, Draft agenda (form and meeting page) and Write description — released as 1.6.0 (website only).

**Architecture:** Server: a `meetings.workingHours` setting; a pure free-time module plus `POST /meetings/free-times` that reads busy meetings with privacy filtering; `POST /meetings` accepts `attendees` and `agendaItems` (validated before anything is created, rolled back on failure); three AI features in `ai-feature-service.ts` (`parseMeeting`, `draftAgenda`, `writeMeetingDescription`) behind bounded routes, with the server choosing every id. Web: new `components/meeting-form/*` parts wired into `MeetingFormModal.tsx`, a Draft agenda review on the meeting page, a Meeting hours card in System Settings.

**Tech Stack:** Fastify 5 + Prisma (MySQL) + zod; React + TanStack Query + Tailwind; Vitest; Playwright e2e in `D:/mico-release/audit-tools`.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-ai-design.md` (approved 20 Oct 2026).

## Global Constraints

- Review first: nothing in the form changes before Apply; suggestions that would replace what the person set start unticked (as `components/task-form/DescribeTask.tsx`).
- AI calls go through `run()` in `ai-feature-service.ts` (per-user limits, concurrency gate, JSON mode); the model is told "Reply with ONLY JSON" and the server validates every field.
- People candidates: ACTIVE, not deleted users; only first name, last name and username go in the prompt (never email, phone, roles). Every returned id is checked against the list; >1 match → a choice; 0 → "not found".
- Emails in the sentence become outside guests (`externalEmail`; name = part before the @ unless given).
- Times are company time (Asia/Muscat); "today" is the company-local date. No end time = 60 minutes. Slots start on 30-minute boundaries.
- Working hours default `{ days: [0,1,2,3,4], start: "08:00", end: "17:00" }`.
- Busy = another non-cancelled, non-deleted meeting where the user is organizer or attendee. A title is shown only if the requester may view that meeting, else "Busy". Outside guests are not checked.
- Repeats: suggestions only on the repeat's days (weekly weekdays, monthly day, daily → working days); clashes checked on the first 4 meetings, naming the date.
- Agenda sources: typed text; the project's open tasks (overdue, BLOCKED-kind column, or due ≤ 7 days after the meeting); the previous meeting's leftovers (open action items = not COMPLETED/CANCELLED, unfinished agenda items) — previous in the same series, else the project's last meeting before this one; only from projects/meetings the requester can see. Minutes fit the meeting length; leads are invited portal users (organizer included).
- Saving never sends invitations. No Teams/Zoom links are created (only copied from the sentence). No Android change.
- AI not configured / failing: free times, clashes, busy strip and manual People/Agenda keep working; AI buttons show the existing "AI is not configured — ask an admin" message.
- Quality bar: axe-clean, keyboard reachable, phone width (no sideways scroll), dark mode, `dir="auto"` for user text.
- Do not touch `Web Portal/frontend/src/api/client.ts` / `client.test.ts` (another session's uncommitted work).

## Review Focus

1. An Arabic or misspelled name that fits two users ("Omar" with two Omars) → a choice, never a guess. (Task 5 test `offers a choice when a name fits two people`.)
2. A meeting the requester can't see overlapping the chosen time → listed as "Busy" with no title, in the strip and the clash warning. (Task 3 test `hides titles of meetings the requester can't see`.)
3. Creating a meeting where one attendee id is unknown/inactive → nothing is created at all. (Task 4 test `creates nothing when a person can't be added`.)
4. Draft agenda minutes that the model returns adding to more than the meeting length → scaled to fit; leads not invited → dropped. (Task 6 test `fits the minutes to the meeting and keeps only invited leads`.)
5. Working hours where no slot exists in 14 days (everyone busy / tiny window) → "No free time found in the next two weeks", not an endless search. (Task 2 test `stops after 14 days`.)

---

### Task 1: Working hours setting

**Files:**
- Modify: `Web Portal/backend/src/modules/settings/settings-service.ts` (add key), `settings-service.test.ts`
- Create: `Web Portal/frontend/src/components/admin/MeetingHoursSettings.tsx` (+ `.test.tsx`)
- Modify: `Web Portal/frontend/src/pages/SystemSettingsPage.tsx` (render the card)

**Interfaces:**
- Produces: setting key `'meetings.workingHours'` with zod `z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), start: HHMM, end: HHMM }).refine(end > start)`; `export const DEFAULT_WORKING_HOURS = { days: [0,1,2,3,4], start: '08:00', end: '17:00' }`; `settingsService.workingHours(): Promise<WorkingHours>` (stored value or the default).

- [ ] **Step 1: Failing tests** — `settings-service.test.ts`: `workingHours() returns the default when unset`; `accepts Sun–Thu 07:30–16:00`; `refuses an end before the start and an empty day list` (400). `MeetingHoursSettings.test.tsx`: shows the days as toggles and the two times; saving sends `PUT /settings/meetings.workingHours` with the edited value; an end before start shows "The day has to end after it starts." and sends nothing.
- [ ] **Step 2: Run** `npx vitest run src/modules/settings` (backend) and the card test (frontend) — FAIL.
- [ ] **Step 3: Implement** the key, `workingHours()`, the card (days as seven pressed/unpressed buttons Sun…Sat, two `type="time"` inputs, Save), and render it in System Settings.
- [ ] **Step 4: Run** both — PASS. **Step 5: Commit** "Meeting hours setting (System Settings)".

### Task 2: Free-time calculation (pure)

**Files:**
- Create: `Web Portal/backend/src/modules/meetings/free-times.ts`, `free-times.test.ts`

**Interfaces:**
- Consumes: `WorkingHours` (Task 1); `RecurrenceRule` and the occurrence generator already used by `meeting-series.ts` (use its function that lists a rule's dates).
- Produces:
  - `interface BusyBlock { userId: string; start: Date; end: Date; meetingId: string; title: string | null }`
  - `suggestTimes(input: { from: Date; minutes: number; busy: BusyBlock[]; hours: WorkingHours; timeZone: string; rule?: RecurrenceRule | null; count?: number /* 3 */; searchDays?: number /* 14 */ }): Date[]`
  - `findClashes(input: { start: Date; minutes: number; busy: BusyBlock[]; rule?: RecurrenceRule | null; timeZone: string; occurrences?: number /* 4 */ }): Array<{ userId: string; date: string /* YYYY-MM-DD */; start: Date; end: Date; title: string | null }>`

- [ ] **Step 1: Failing tests** (`free-times.test.ts`, company zone Asia/Muscat):
  - `suggests the three nearest free 30-minute-aligned slots inside working hours` (a Monday; one user busy 08:30–10:00; 60 minutes from 08:10 → expect 10:00, 10:30, 11:00 that day — 08:30 and 09:00 overlap the busy block)
  - `never offers a time on a non-working day or ending after the day ends` (Fri/Sat skipped; 16:30 + 60 min refused)
  - `keeps a weekly repeat on its weekdays` (rule weekdays [1] → only Mondays)
  - `stops after 14 days` (all busy → `[]`)
  - `findClashes names the person and the date, checking the first 4 meetings of a repeat`
- [ ] **Step 2: Run** `npx vitest run src/modules/meetings/free-times.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** with day-by-day stepping in the company zone (`zonedStartOfDay`), candidate starts every 30 minutes from max(from rounded up to :00/:30, day start) while start+minutes ≤ day end; a candidate is free when no busy block overlaps `[start, start+minutes)`. For a repeat, a candidate day must be one of the rule's days.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** "Free times: suggestions and clashes".

### Task 3: `POST /meetings/free-times`

**Files:**
- Modify: `Web Portal/backend/src/modules/meetings/meeting-repository.ts` (add `BusyMeetingsStore` interface), `prisma-meeting-repository.ts` (implement), `meeting-routes.ts` (route), `Web Portal/backend/src/server.ts` (wire settings + store)
- Test: `meeting-routes.test.ts` (route), `tests/integration/busy-meetings.test.ts` (query)

**Interfaces:**
- Consumes: `suggestTimes`, `findClashes`, `BusyBlock` (Task 2); `settingsService.workingHours()` (Task 1); route dep `canViewMeeting`.
- Produces:
  - `interface BusyMeetingsStore { busyBetween(userIds: string[], from: Date, to: Date, excludeMeetingId?: string): Promise<Array<{ meetingId: string; start: Date; end: Date; title: string; userIds: string[] }>> }` (non-cancelled, not deleted, organizer or attendee among `userIds`; no end → +60 min)
  - Route body `{ userIds: string[] (max 50), startAt: ISO, minutes: 5..720, recurrenceRule?: rule|null, excludeMeetingId?: string }` → `{ data: { suggestions: string[] /* ISO */, clashes: Array<{ userId; name; date; start; end; title: string | null }>, day: Array<{ userId; name; blocks: Array<{ start; end; title: string | null }> }>, workingHours: WorkingHours } }`. Titles are null unless `canViewMeeting(requester, meetingId)`.

- [ ] **Step 1: Failing tests** — integration: `busyBetween finds meetings a user organizes or attends, not cancelled or deleted ones, and treats a missing end as an hour`. Route: `suggests times and names clashes for the invited people`; `hides titles of meetings the requester can't see` (stub `canViewMeeting` → false for one meeting: clash and day block show `title: null`); `refuses more than 50 people` (400).
- [ ] **Step 2: Run** unit + `TEST_DATABASE_URL=… npx vitest run --config vitest.integration.config.ts tests/integration/busy-meetings.test.ts` — FAIL.
- [ ] **Step 3: Implement** the store query, the route (busy window = startAt's day start → +14 days, or to the 4th occurrence for a repeat, whichever is later; names from the user ids), the wiring.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** "Free times endpoint with private busy blocks".

### Task 4: Create a meeting with its people and agenda

**Files:**
- Modify: `Web Portal/backend/src/modules/meetings/meeting-routes.ts` (createSchema + POST handler), `Web Portal/backend/src/app.ts` (pass `attendeeService`, `agendaService`, `isActiveUser` to meeting routes)
- Test: `meeting-routes.test.ts`

**Interfaces:**
- Consumes: `AttendeeService.addAttendee(meetingId, AddAttendeeInput)`, `AgendaService.addItem(meetingId, AddAgendaInput)`, `MeetingService.deleteMeeting(id)`.
- Produces: `POST /meetings` accepts `attendees?: Array<{ userId?: string; externalName?: string; externalEmail?: string; role?: 'REQUIRED'|'OPTIONAL' }>` (max 100) and `agendaItems?: Array<{ title: string (1..300); ownerId?: string|null; expectedMinutes?: number|null (1..600) }>` (max 50); the reply includes them as the meeting page reads them.

- [ ] **Step 1: Failing tests** — `saves the people and agenda with the meeting, before a repeat copies the people`; `creates nothing when a person can't be added` (an inactive user id → 400, no meeting row); `an agenda lead must be one of the meeting's people or the organizer` (400); `a guest needs a valid email`.
- [ ] **Step 2: Run** `npx vitest run src/modules/meetings/meeting-routes.test.ts` — FAIL.
- [ ] **Step 3: Implement**: validate everything first (users exist and are active via `isActiveUser`, emails, leads); then create the meeting, add attendees then agenda, then `series.start` (so series copies the people); if any add fails, `deleteMeeting` and rethrow.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** "Schedule a meeting with its people and agenda in one go".

### Task 5: AI — fill the meeting form from a sentence

**Files:**
- Modify: `Web Portal/backend/src/modules/ai/ai-feature-service.ts`, `ai-feature-routes.ts`, `Web Portal/backend/src/server.ts` (dep `listPeople`)
- Test: `ai-feature-service.test.ts`, `ai-feature-routes.test.ts`

**Interfaces:**
- Consumes: `run`, `matchProject`, `toRepeatRule`, `parseJsonObject`, `listProjectsFor` (existing).
- Produces:
  - dep `listPeople?: () => Promise<Array<{ id: string; firstName: string; lastName: string; username: string }>>` (active users)
  - `parseMeeting(input: { text: string; today?: string }, requester): Promise<DescribedMeeting>`
  - `interface DescribedMeeting { title: string; description: string | null; date: string | null; startTime: string | null; minutes: number | null; recurrence: RecurrenceRule | null; project: { id; code; number; name } | null; location: string | null; onlineLink: string | null; people: { found: Array<{ id: string; name: string }>; choices: Array<{ said: string; options: Array<{ id: string; name: string }> }>; notFound: string[] }; guests: Array<{ email: string; name: string }>; agenda: string[] }`
  - `POST /ai/parse-meeting` body `{ text (1..1000), today? }` → `{ data: DescribedMeeting }`

- [ ] **Step 1: Failing tests** (fake provider answers, as existing `parseTask` tests do):
  - `reads title, day, time, length, repeat, project, place and link` ("Weekly site review every Monday 10am for 90 minutes at RIG1 for PUMP, https://meet.example/x")
  - `matches names to people, by the ids the model gives, checked against active users`
  - `offers a choice when a name fits two people` (two "Omar"s → `choices`, nobody in `found`)
  - `lists a name nobody has as not found, and never an id outside the list`
  - `turns emails into guests named from before the @` (and only emails present in the text)
  - `keeps an online link only if the sentence has it`
  - route: `refuses text over 1000 characters`
- [ ] **Step 2: Run** `npx vitest run src/modules/ai` — FAIL.
- [ ] **Step 3: Implement**: prompt lists people as `id | first last | username` (max 300, sorted) and projects as `parseTask` does; model returns `{ title, description, date, startTime, minutes, repeat, project, location, onlineLink, people: [{ said, ids: [] }], guests: [{ email, name }], agenda: [] }`; the server keeps ids in the list, emails that occur in the text, links that occur in the text, `HH:MM` times, minutes 5..720.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** "AI: fill the meeting form from a sentence".

### Task 6: AI — draft the agenda, write the description

**Files:**
- Create: `Web Portal/backend/src/modules/meetings/agenda-sources.ts` (+ `.test.ts`) — gathers tasks and leftovers with access checks
- Modify: `ai-feature-service.ts`, `ai-feature-routes.ts`, `server.ts`
- Test: `ai-feature-service.test.ts`, `ai-feature-routes.test.ts`

**Interfaces:**
- Produces:
  - `draftAgenda(input: { title: string; description?: string; text?: string; minutes: number; people: Array<{ id: string; name: string }>; tasks: Array<{ key: string; title: string; reason: 'overdue'|'blocked'|'due' }>; leftovers: Array<{ title: string; kind: 'action'|'agenda' }> }, requester): Promise<Array<{ title: string; ownerId: string | null; minutes: number }>>` — at most 12 items; leads ∉ people dropped (null); minutes scaled so the sum ≤ `minutes`, each ≥ 1.
  - `writeMeetingDescription(input: { title: string; agenda?: string[]; text?: string }, requester): Promise<string>` (≤ 2000 chars, in the language the person wrote in)
  - `gatherAgendaSources(deps, input: { requester; projectId: string | null; startAt: Date; meetingId?: string }): Promise<{ tasks; leftovers }>` — tasks only from a project the requester can use; leftovers from the previous meeting in the series (if `meetingId`), else the project's last meeting before `startAt`, only if the requester can view it.
  - `POST /ai/draft-agenda` body `{ title, description?, text?, projectId?: string|null, startAt: ISO, minutes: 5..720, peopleIds: string[] (max 100), meetingId?: string }` → `{ data: { items } }`; `POST /ai/write-meeting-description` body `{ title, agenda?: string[] (max 30), text? }` → `{ data: { description } }`.
- [ ] **Step 1: Failing tests** — `fits the minutes to the meeting and keeps only invited leads`; `draws on open tasks and the previous meeting's leftovers` (prompt contains them); sources: `takes leftovers from the previous meeting of the series, else the project's last meeting`, `nothing from a project or meeting the person can't see`; `writes a description and refuses an empty answer`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** "AI: draft the agenda and write the meeting description".

### Task 7: Web — People and Agenda in the new-meeting form

**Files:**
- Create: `Web Portal/frontend/src/components/meeting-form/PeopleField.tsx`, `AgendaField.tsx` (+ tests)
- Modify: `Web Portal/frontend/src/components/MeetingFormModal.tsx`, `Web Portal/frontend/src/api/meetings.ts` (`NewMeetingInput.attendees`, `.agendaItems`)

**Interfaces:**
- Produces: `PeopleField({ value: MeetingPerson[], onChange, organizerId })` with `type MeetingPerson = { kind: 'user'; id: string; name: string } | { kind: 'guest'; email: string; name: string }`; `AgendaField({ value: AgendaDraft[], onChange, leads: Array<{ id; name }>, minutes: number, onDraft?: () => Promise<AgendaDraft[]> })` with `type AgendaDraft = { key: string; title: string; ownerId: string | null; minutes: number | null }`.
- [ ] **Step 1: Failing tests** — PeopleField: add a user from the directory search, add a guest by email (invalid email refused with a message), remove a person (keyboard). AgendaField: add, edit, reorder (Move up/down buttons), remove; shows "Total 75 of 60 minutes" in warning colour when over. MeetingFormModal (new): saves one `POST /meetings` with `attendees` and `agendaItems`; the edit form shows neither section.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** "New meeting form: People and Agenda".

### Task 8: Web — free times, clash warning, busy strip

**Files:**
- Create: `Web Portal/frontend/src/components/meeting-form/FreeTimes.tsx` (+ test)
- Modify: `MeetingFormModal.tsx`, `api/meetings.ts` (`freeTimes(body)`)

**Interfaces:**
- Consumes: `POST /meetings/free-times` (Task 3).
- Produces: `FreeTimes({ userIds, startAt, minutes, rule, excludeMeetingId?, onPick(startAt: string) })` — "Suggest 3 times" button → three buttons; a clash warning naming who and when (re-checked when the time or people change, debounced 400 ms); the chosen day's busy strip (one row per person, blocks labelled with the title or "Busy").
- [ ] **Step 1: Failing tests** — `offers three times and uses one on click`; `warns who clashes and when`; `shows "Busy" for a meeting the person can't see`; `says when no free time was found in the next two weeks`; works with no AI configured.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (in both new and edit forms; in edit, `excludeMeetingId` = the meeting). **Step 4: Run** — PASS. **Step 5: Commit** "Meeting form: free times, clashes and the day's busy strip".

### Task 9: Web — Describe, Draft agenda, Write description

**Files:**
- Create: `Web Portal/frontend/src/components/meeting-form/DescribeMeeting.tsx` (+ test)
- Modify: `MeetingFormModal.tsx`, `components/meeting/AgendaSection.tsx` (Draft agenda review), `api/ai.ts` (`parseMeeting`, `draftAgenda`, `writeMeetingDescription`)

**Interfaces:**
- Consumes: Tasks 5–7 endpoints and fields.
- Produces: `DescribeMeeting({ onParse, current, onApply, withPeopleAndAgenda: boolean })` — lists suggestions (title, day/time, length, repeat, project, place, link, and in the new form people, guests and agenda points) with ticks; a name with choices shows a small picker; Apply patches the form only with ticked items. The edit form also shows it (with `withPeopleAndAgenda={false}`) plus Write description.
- [ ] **Step 1: Failing tests** — `nothing changes before Apply`; `a suggestion that would replace your own value starts unticked`; `a name with two matches asks which person`; `Write description offers a replacement you can decline`; meeting page: `Draft agenda proposes items and adds only the ticked ones`; AI not configured → the existing message, the rest of the form works.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** "Meeting form: describe it, draft the agenda, write the description".

### Task 10: End to end and release

**Files:**
- Create: `D:/mico-release/audit-tools/meeting-ai-e2e.mjs` (local AI stand-in, as `drawer-ai-e2e.mjs`)
- Modify: `CHANGELOG.md` ([Unreleased] → New features)

- [ ] **Step 1:** e2e: the sentence fills the form after Apply only; a two-match name asks; free times suggest three and a clash is named; a private meeting shows "Busy"; Draft agenda fills the agenda with leads and minutes that fit; Save creates the meeting with people and agenda (checked via API) and sends no invitation; edit form has Describe/free times but no People/Agenda; meeting page Draft agenda adds reviewed items; System Settings Meeting hours change moves the suggestions; axe; phone width; AI provider removed afterwards.
- [ ] **Step 2:** Run the full backend and web suites, lint and typecheck; `TEST_DATABASE_URL=… npm run test:db`.
- [ ] **Step 3:** CHANGELOG entry; `node tools/release/release.mjs minor --web-only --commit` (1.6.0); push `HEAD:main HEAD:fix/audit-findings v1.6.0`; verify `/build-info.json` and `/api/v1/health` on task.mico360.com.
