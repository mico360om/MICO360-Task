# Learning Hub: one course with role-based modules — design

Date: 13 Nov 2026. Product: MICO360 Tasks (Fastify/Prisma server, React website). Web only: the Android app and Chrome extension have no Learning Hub and are not changed.
Base: the Learning Hub redesign in release **1.23.27** (branch `feat/learning-hub-simple`, merged into `integrate/1.23.27`). This work starts from tag v1.23.27, merges v1.23.28 (batch 4b) before its gate, and ships as its own release after them.

## 1. Intent and why

The owner asked (13 Nov):

> Combine all short courses into one structured, meaningful course with multiple modules, in a logical learning sequence; remove duplicate content and preserve all essential instructions. Show each module only to users whose existing roles and permissions allow the relevant features; course access must not change their permissions. Track progress by module, let users resume where they stopped, preserve existing completed training, include short assessments. Complete the course when a user finishes all modules and assessments required for their role; modules they can't access don't affect completion. Automatically issue a downloadable certificate with the learner's name, course title, completion date, unique certificate number and a QR code to verify. Let administrators monitor training progress and issued certificates.

Why: today a new staff member faces 11 separate short courses with overlapping content and no single finish line or certificate. One course with a clear order, per-role modules and an automatic certificate gives each person one obvious path and gives admins one thing to assign and track.

The same day the owner also accepted an outside review of the Learning Hub screens and answered four questions about it. Those changes are folded in (section 6).

## 2. Owner decisions (13 Nov, asked one at a time)

| # | Question | Decision |
|---|---|---|
| D1 | Clients in the combined course? | **No.** The combined course is for staff. Clients keep their separate "Client portal basics" guide, which now has its own quiz and its own certificate. |
| D2 | People assigned a short course with a due date | They are assigned the combined course instead. Due date: **30 days from the change, or their old due date if later.** Mandatory if any of their old assignments of built-in short courses was mandatory. |
| D3 | Role grows after the certificate (e.g. made admin) | **Keep the certificate.** The new modules appear as "New for your role" to do. Finishing them issues an updated certificate; the old one stays valid. |
| D4 | Must modules be done in order? | **Suggested order, free to jump.** "Continue" goes to the next unfinished module in order; any visible module can be opened. |
| D5 | Course title (printed on certificates) | **"MICO360 Tasks User Training"** |
| R1 | Learning Hub review: buttons on cards | Every course card gets a small Start / Continue / Review button; the whole card stays clickable. |
| R2 | Report dates | A "Dates by" switch: **Got the course** (today) / **Finished the course**. Quizzes keep the hand-in day. |
| R3 | Copying a course | Add **Duplicate** to Manage: an unpublished draft "Copy of …" with lessons, quiz and pictures, no progress, assignments, certificates or feedback; a copy of a built-in course gets no built-in updates. |
| R4 | Assigning | The Assign window lets admins **tick several people** (with search); one action covers them all. |

## 3. Goals

### 3.1 The combined course
- One built-in staff course, **"MICO360 Tasks User Training"**, published, certificate on, audience Staff.
- Modules in this order (the builder may merge or split a module if it removes duplication, keeping the order "system basics → daily work → advanced features"):
  1. Getting started (all staff)
  2. Tasks (all staff)
  3. Kanban board (all staff)
  4. Projects (all staff)
  5. Calendar (all staff)
  6. Meetings & minutes (all staff)
  7. Chat (all staff)
  8. MICO AI (all staff)
  9. Reports (admins — same rule as today's `moduleVisible('reports')`)
  10. Admin settings (admins — `moduleVisible('admin')`)
- Each module: a short "Video: …" lesson first (hidden from learners until an admin pastes its link, exactly as the 1.23.27 rule for video lessons), then its guide lessons, then **a short quiz** (3–5 single-choice questions, pass mark 70%, unlimited retries, explanations shown after hand-in). The order-type questions kept in 1.23.27 may stay.
- **Content:** built from the 11 built-in short courses of 1.23.27 (starter revision 2). Remove repeated material (e.g. the same "add a task" or "notifications" steps taught in several courses); keep every essential instruction. The builder produces a **coverage table** (in the lane ledger and the PR/release notes): every lesson and step of the old courses → where it lives now, or "removed as a duplicate of X". Screenshots are reused where still correct (1.23.27's 48 WebP pictures). Text style as 1.23.27: short, plain, the site's exact labels. No real client names (owner rule): sample data Contoso Engineering / Fabrikam Logistics / Northwind Trading.

### 3.2 Visibility (never a permission change)
- A module is shown to a person only if the existing rule for its feature allows it: the module carries the same facts a course carries today (`moduleKey`, role groups, companies) and is checked with the same functions in `training-access.ts` (`moduleVisible`, `groupsMatch`, `companiesMatch`). The course itself is visible to all staff.
- Training never grants access to a feature; it only follows what the person can already use. A hidden module's lessons, quiz, progress and pictures are not sent to that person's browser, and the server refuses lesson/quiz/progress calls for a hidden module (same as today's course-level refusal).
- The course editor shows each module's visibility in plain words ("Admins only", "All staff").

### 3.3 Progress and resume
- Per module: Not started / In progress ("2 of 5 lessons") / Done (date). Per course: "4 of 8 modules".
- The course page lists the person's modules in order with those states, and one **Continue** button that opens the next unfinished module at the lesson (and guide step) where they stopped (`lastLessonId`, `TrainingProgress.stepIndex`).
- A module is done when all its visible lessons are done and its quiz is passed. Unlinked video lessons don't count (1.23.27 rule).
- **Completion:** the course completes when every module visible to that person is done. Modules they cannot see never count, and a module becoming visible later (D3) doesn't undo completion.

### 3.4 Converting existing sites (one-time, at start-up)
A one-time step, like the 1.23.25 `training-starter-pdfs` and 1.23.27 starter-upgrade steps: run under the job lock, record a done-marker in system settings, and be safe to re-run.
1. Create the combined course and its modules.
2. **Untouched built-in short courses** (the 1.23.27 "nobody edited it" test): their lessons move into the matching module (same lesson ids, so `TrainingProgress` rows keep working, with `courseId` updated), their quiz becomes or feeds the module quiz, duplicate lessons are removed per the coverage table, and the emptied short course is archived (not deleted). Old links to the short course or its lessons open the matching module.
3. **Built-in short courses an admin edited** stay as separate courses, unchanged, and Manage shows admins a notice: "This built-in course was edited, so it wasn't merged into MICO360 Tasks User Training. Archive it when you're ready." A person's completion of such a course still counts as that module done.
4. **Keep finished training:** anyone who completed a built-in short course has the matching module marked done with that completion date, even if the lesson list changed. In-progress lessons keep their progress. Quiz attempts move with their quiz.
5. People whose visible modules are then all done get the course completed (completion date = the latest of those dates) and their certificate issued automatically, quietly: no email burst; one bell notice "Your training is now one course: MICO360 Tasks User Training" may go to people with any Learning Hub enrolment (builder's call on wording).
6. **Assignments (D2):** every active assignment and every "New staff only" rule of a built-in short course points to the combined course instead (one per target; duplicates merged). Fixed due day → the later of (change day + 30 days) and the old due day; relative due days in rules → at least 30. Mandatory if any merged one was. Converted assignments send no "new assignment" emails or reminders on the day of the change.
7. Existing certificates of any course stay valid and verifiable. Courses admins created themselves and the Client portal guide are untouched (apart from D1: client guide certificate on).
8. A second start changes nothing. If the step fails half-way it must leave the site usable and finish on the next run.

### 3.5 Certificates
- Issued automatically when the course completes, and again (a new certificate, the old one stays valid) when new modules for a grown role are finished (D3).
- Shows: learner's name, course title, **completion date**, unique certificate number (today's `code`), issuer details if set, and a **QR code** that opens `/verify/<code>`. The verify page shows name, course, completion date and whether it is valid, revoked or expired.
- Downloadable as PDF from the course page and from My learning; QR on both the PDF and the on-screen certificate.
- The client guide's certificate works the same way.
- No expiry by default (`certificateMonths` empty); admins can still set one.

### 3.6 Admin monitoring
- Reports: for the combined course, a "By module" view (people done / in progress / not started per module, counting only people who can see that module) and "By person" (modules done of required, last activity, certificate number with link).
- The existing Certificates tab lists issued certificates (with the combined course's), with download and revoke as today.
- Folded-in review fixes (section 6) apply to these reports.

## 4. Non-goals
- No change to anyone's permissions, roles or feature access.
- No Android or extension work.
- No ratings on cards, no "recommended courses" section, no extra catalogue filters beyond today's automatic ones (only ~3 courses remain visible to staff after the merge).
- Clients don't get the combined course (D1).
- Admin-made courses are not merged or rewritten.

## 5. Anti-goals (would make this a failure even if it works)
- Anyone losing a completed lesson, module, quiz pass or certificate.
- A module or its content shown to someone whose role can't use that feature — or a role gaining access to a feature through training.
- A burst of emails or reminders to everyone on the day of the change.
- A person stuck unable to complete because of a module they can't see or an unlinked video.

## 6. Folded-in Learning Hub review changes
Learner:
- **R1** card buttons (Start / Continue / Review), whole card still clickable, no nested interactive elements.
- Progress as lessons ("0 of 3 lessons"; for the combined course "4 of 8 modules"); Up next names the next lesson/module.
- Done list folded away when long (builder's threshold).
Manage:
- A per-row ⋯ menu: Edit, Preview as learner, Assign (published only), Publish / Publish changes / Unpublish, Archive, Delete (never-published drafts), **Duplicate (R3)**. Same permissions as the editor.
- An Audience filter (Staff / Clients); the facts line says "Admins only" (or the group) when a course or module is limited.
- **R4** Assign: a "People" target with several ticked people (search); one action; the Assigned tab shows it as one entry ("5 people") that can be withdrawn whole or per person. Existing single-target assignments unchanged.
Reports:
- "People" counts each person once (today it counts enrolments). Completion tile names its denominator ("2 of 3 enrolments").
- A "Started themselves" column (from `TrainingEnrolment.selfStarted`, not currently assigned) next to Assigned; same in Excel/PDF exports.
- **R2** "Dates by: Got the course / Finished the course"; quizzes by hand-in day; exports state the basis in their header.
- Quiz results as a compact table (Quiz · Course/Module · Attempts · People · Pass rate · Average · Questions), quizzes with no attempts hidden behind "Show all quizzes".
- Already met, keep: text contrast (ink-2 #6C625F ≈ 5.9:1 on white, 5.3:1 on page), visible keyboard focus, status words beside colours.
- Separately, batch 4b (1.23.28) adds the "warn before deleting a certificate course's quiz" dialog; this work must keep it.

## 7. Constraints
- Live database: MariaDB 11.8.9, not strict, statement-based binary log, `innodb_snapshot_isolation` ON. Never pass `isolationLevel` / send isolation statements; lock first (`SELECT … FOR UPDATE`, `lib/sentinel-lock.ts`), retry on deadlock / P2034 / 1020. Raw SQL passes `portabilityProblems`. Migrations add-only and MariaDB-safe. DB tests and the conversion rehearsal run on **both** local MySQL 8 (3306) and MariaDB 11.8.9 (3307).
- A QR library, if added, comes from registry.npmjs.org with no install scripts (the release tamper check); a small, widely used, MIT-licensed package or a vendored generator.
- Existing URLs keep working (old course/lesson links redirect; `/verify/<code>` unchanged).
- The 1.23.27 rules stay: video lessons hidden until linked, pasting a link isn't an edit, starter updates reach untouched courses only, finishing re-checked after content changes on published courses.
- Owner rule: never "OXY" or any real client/company name anywhere.

## 8. Approaches considered
1. **Modules inside one course (chosen, my call — the owner described outcomes).** New module layer (e.g. a `training_modules` table: course, position, title, moduleKey, role groups, companies; lessons get a nullable module id). Matches the request exactly: one course, per-role modules, progress by module, one certificate; existing lessons move so progress survives.
2. A learning path grouping the existing short courses. Cheaper, but people still see separate courses and the repetition stays — the opposite of "one structured course, duplicates removed".
3. One long flat course with per-lesson visibility. No modules to show as done/pending; quizzes belong to nothing.

## 9. Left to the builder
- Exact data model for modules (table/column names), how module completion is stored (computed vs recorded), and how per-module visibility is applied in queries.
- Final module split/merge and lesson wording, within section 3.1.
- QR implementation choice (section 7).
- The bell notice wording at conversion, the Done-list fold threshold, menu ordering.
- How the Assigned tab groups a several-people assignment (an add-only column or table is fine).

## 9b. Owner approval (13 Nov): "Approve, modules editable"
**D6 — modules are a general course-editor feature**, available in any course: the built-in one, admin-made ones and duplicates.
- **Who:** admins and training managers, with the same rights they have over the course today.
- **What they can do:** add, rename, reorder and remove modules; move lessons between modules; choose who sees each module, using the same choices as for courses today (all staff, admins, employees, project runners, training managers; companies).
- **A course with no modules** stays a plain list of lessons, exactly as today.
- **Duplicate (R3)** copies the modules.
- **Removing a module** asks first, and its lessons move to a module the admin picks (or to "no module"). Lessons are never deleted silently.
- **Publishing:** changes to a published course's modules follow the existing publish and major-change rules.
- **Built-in course:** an admin changing its modules counts as editing it, so later built-in updates skip it, the same as editing lessons today.

## 9a. Calls made after the builder check (13 Nov; mine, the owner may correct)
- **C1 — an edited built-in short course** (clarifies 3.4 steps 3 and 6):
  - (a) The combined course's matching module still gets the new built-in content. Everyone needs the full course; the edited course is the admin's extra.
  - (b) Only completions of the edited course up to the change count as that module done (recorded once by the conversion). Afterwards it is an ordinary course: finishing it doesn't complete a module, so no lasting link is needed.
  - (c) Its assignments and "New staff only" rules move to the combined course, with the D2 dates, like every built-in short course. The edited course keeps its content, lessons, progress and downloads but is no longer assigned. The Manage notice says so: "This built-in course was edited, so it wasn't merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you're ready."
- **C2 — a built-in short course the admin deleted, archived or unpublished before the change:** respect the removal (the 1.23.27 rule: a removed built-in course never comes back).
  - Its module is added **switched off**: hidden from learners and not required. The editor shows it as "Off — the old course was removed", and the admin can switch it on.
  - No "archive it" notice for such courses.
  - Completions of it before its removal still count if the admin switches the module on.
- **C3 — the client guide (D1):**
  - Untouched: its certificate is switched on, and clients who already finished it get their certificate quietly at the change (like staff step 5), with no email.
  - Edited by an admin: left alone. The admin can switch the certificate on.
- **Builder's own calls, accepted:**
  - "New for your role" modules (D3) leave the course Completed, with no due date and no reminders.
  - Merged assignments with different due days take the latest.
  - A major-change review covers only modules the person can see.
  - When a certificate expires, all of that person's modules must be done again.

## 10. How it will be proven
- Test-first unit and DB tests (both engines) for: visibility per role (admin / employee / project runner / training manager / client / company-limited), module and course completion including hidden modules and unlinked videos, D3 role growth, conversion (untouched vs edited short courses, finished/partial progress kept, attempts moved, assignments and rules converted with D2 dates, no emails, idempotent re-run, half-way failure), certificate issue + QR + verify page, reports counts.
- A **conversion rehearsal** on MariaDB and MySQL: a live-like site on v1.23.28 with progress, certificates, assignments, rules, an edited built-in course and an admin-made course → start the new build → check nothing lost, the coverage table holds, a second start changes nothing.
- Browser checks (1440×900 and 375×812, light/dark, RTL): employee, admin, project runner, training manager, client; resume mid-module; finish → certificate PDF with QR; scan target opens verify; Manage menu, Duplicate, assign several people; reports switches.
- The usual full gate: all suites with typecheck/lint, a fresh reviewer, the battery, el-check.
