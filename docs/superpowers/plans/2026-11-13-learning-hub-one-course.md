# Learning Hub as one course — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 11 built-in short courses with one built-in staff course, "MICO360 Tasks User Training", made of modules shown per role, with module progress, resume, automatic QR certificates, a one-time safe conversion of existing sites, and the folded-in Learning Hub review fixes (card buttons, reports, Duplicate, assigning several people, editable modules).

**Architecture:** A new module layer (`training_modules`, lessons get a nullable `moduleId`) checked with the existing access rules (`training-access.ts`). Every learner read already goes through `loadStates` (`training-read.ts`); it becomes person-aware so lessons of modules a person can't see vanish everywhere at once (lists, %, completion, reports). Module completion is recorded (`training_module_done`) as well as computed. The conversion runs once inside the starter update (revision 2 → 3) under the existing `training-starter` job lock and its own record `training.oneCourse`.

**Tech Stack:** Fastify + Prisma (MySQL 8 / MariaDB 11.8.9) server in `Web Portal/backend`; React + TanStack Query + Tailwind website in `Web Portal/frontend`; vitest; Playwright e2e scripts in `.superpowers/lh1/`.

**Spec:** `docs/superpowers/specs/2026-11-13-learning-hub-one-course-design.md` (sections 2, 3, 6, 7 are requirements; 9a and 9b are owner/coordinator rulings). Lane rulings: `.superpowers/lh1/progress.md`.

## Global Constraints

- Course title printed on certificates: exactly **"MICO360 Tasks User Training"**.
- Module order: Getting started → Tasks → Kanban board → Projects → Calendar → Meetings & minutes → Chat → MICO AI → Reports (admins) → Admin settings (admins).
- Each module: "Video: …" lesson first (hidden until linked), guide lessons, then one quiz of 3–5 single-choice questions (ORDER questions kept from 1.23.27 may stay), pass mark 70, unlimited retries.
- Visibility never exceeds feature access: modules use `moduleVisible`, `groupsMatch`, `companiesMatch` from `training-access.ts`; hidden modules' lessons, quizzes, progress and pictures never reach that browser; the server refuses lesson/quiz/progress calls for them.
- Completion: every module the person can see is done; hidden or switched-off modules and unlinked videos never count; a module appearing later never undoes completion (D3).
- Conversion: nobody loses a completed lesson, module, quiz pass or certificate; no burst of emails or reminders on the day of the change; a second start changes nothing; a half-way failure leaves the site usable and finishes on the next start.
- Database: never pass `isolationLevel`, never send isolation statements; take the lock first (`withSentinelLock` / `withRowLock` in `src/lib/sentinel-lock.ts`); retry on deadlock, P2034 and error 1020 (`isRetryableTxError`); raw SQL must pass `portabilityProblems` (`src/lib/sql-portability.ts`); migrations add-only, folder `20261119010000_learning_hub_modules`.
- Every DB test and the conversion rehearsal run on MySQL 8 (127.0.0.1:3306) AND MariaDB 11.8.9 (127.0.0.1:3307), user mico/mico, databases `mico360_t_lh1_*` only.
- QR: `qrcode-generator@1.4.4` (exact, MIT, zero dependencies, registry.npmjs.org, no install scripts) in backend and frontend.
- Words: short, plain English, the site's exact labels as of 1.23.28 (Recycle Bin, Error Log, Audit Logs in the account menu under your name; "Third Party" holds Clients and Guest contacts; Companies inside System Settings). Dates "3 Nov" / "3 Nov 2026".
- Never "OXY" or any real client/company name; sample data Contoso Engineering / Fabrikam Logistics / Northwind Trading; code examples Acme.
- Change nothing under `Android App/` or `Extension/` (owner rule 13 Nov); their suites must stay green.
- New routes: authenticated, listed in `src/modules/companies/route-classes.ts` (and the client route table test must stay green); server API changes additive.
- Website: existing tokens/components, light + dark, RTL, 44 px touch targets on coarse pointers, accessible names, no nested interactive elements.
- Commits: `git -c user.name=mico360om -c user.email=mico360om@gmail.com commit …`, subject in plain English ending "(1.23.30)", body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Add files by explicit path (never `git add -A`, `commit -a`, stash, reset or checkout of others' files).
- Test commands (backend dir `Web Portal/backend`): unit `npx vitest run <files>`; DB `TEST_DATABASE_URL=mysql://mico:mico@127.0.0.1:3306/mico360_t_lh1_tdb npx vitest run --config vitest.integration.config.ts <files>` and the same with `127.0.0.1:3307/mico360_t_lh1_tdbm`. Website dir `Web Portal/frontend`: `npx vitest run <files>`. Never run the backend and website full suites at the same time.

## Review Focus

1. **A person whose role changes after the conversion** (employee made admin; admin demoted) — expect D3: course stays Completed, new modules show "New for your role", finishing them issues a second certificate, the first stays valid; a demoted admin's admin modules vanish and never block anything. Test: Task 4 "D3 role growth" and "role shrink".
2. **A built-in short course an admin both edited AND assigned with a due date** — expect its assignments to move to the combined course with D2 dates, the course itself kept (not archived), its completions before the change counted as the module done, later completions not. Test: Task 10 "edited short course (C1)".
3. **A module whose only visible lesson is an unlinked video, or a module switched off** — expect it not shown, not counted, and the course still completable. Test: Task 4 "unlinked-only module" and "switched-off module".
4. **Two server instances starting at once / a crash mid-conversion** — expect one conversion, no duplicate assignments/certificates, and a second run that finishes the job. Test: Task 10 "half-way failure" and "second start changes nothing".
5. **Old bookmarks and notifications pointing at a short course or one of its lessons** — expect them to open the combined course at the matching module/lesson, never "not found". Test: Task 5 "COURSE_MOVED" and Task 12 "old links".

---

## File Structure

Backend (`Web Portal/backend`):
- `prisma/schema.prisma`, `prisma/migrations/20261119010000_learning_hub_modules/migration.sql` — tables `training_modules`, `training_module_done`; columns `training_lessons.moduleId`, `training_certificates.completedAt`, `training_certificates.moduleIds`, `training_assignments.batchId`.
- `src/modules/training/training-modules.ts` (new) — pure module rules: visibility, units, unit state, course completion over units, continue target, certificate coverage, plain visibility words.
- `src/modules/training/training-access.ts` — export `groupsMatch`, `companiesMatch`; add `moduleShown`.
- `src/modules/training/training-read.ts` — person-aware `loadStates` (units, per-person lessons).
- `src/modules/training/training-state.ts` — module-course status/progress.
- `src/modules/training/training-finish.ts` — record module done, complete with units, D3 re-issue, certificate `completedAt`/`moduleIds`, `completeAt` for the conversion.
- `src/modules/training/training-learner.ts` — modules in course detail/cards/lesson view, hidden-module refusal, learn(), COURSE_MOVED, certificate refs.
- `src/modules/training/training-qr.ts` (new) — QR matrix from a text (wraps qrcode-generator).
- `src/modules/training/training-certificate-pdf.ts` — QR + completion date.
- `src/modules/training/training-manage.ts` + `training-manage-modules.ts` (new) + `training-duplicate.ts` (new) — module editor API, Duplicate, row facts, notices, several-people assigning.
- `src/modules/training/training-report-service.ts`, `training-reports.ts`, `training-export.ts` — report fixes and module views.
- `src/modules/training/starter/starter-types.ts`, `starter/starter-courses.ts` — revision 3 content (combined course + client guide).
- `src/modules/training/training-starter.ts` — modules when loading/updating; conversion hook.
- `src/modules/training/training-one-course.ts` (new) — the one-time conversion.
- `src/modules/training/training-types.ts`, `training-wiring.ts`, `training-manage-routes.ts`, `training-routes.ts`, `portal-training-routes.ts`, `src/modules/companies/route-classes.ts`, `src/server.ts`.

Website (`Web Portal/frontend/src`):
- `api/training.ts` (+ `api/training-types-copy.test.ts`), `api/portal.ts` (portal learner types only if they re-declare).
- `components/training/QrCode.tsx` (new), `CertificateView.tsx` (new, on-screen certificate), `ModuleList.tsx` (new, course page modules), `training-ui.tsx` (card button), `TrainingLists.tsx`, `CourseView.tsx`, `LessonPlayer.tsx`, `LearnLink.tsx`, `training-words.ts`.
- `components/training/manage/CourseRowMenu.tsx` (new), `ModulesEditor.tsx` (new), `CoursesTab.tsx`, `LessonsEditor.tsx`, `AssignDialog.tsx`, `targets.tsx`, `AssignmentsTab.tsx`, `ReportsTab.tsx`, `CertificatesTab.tsx`.
- `pages/training/VerifyPage.tsx`, `pages/training/CourseEditorPage.tsx`.

Lane (untracked, `.superpowers/lh1/`): `progress.md` ledger with the coverage table, `lh1-e2e.mjs`, `run-e2e.sh`, `lh1-rehearsal.mjs`, `build-gate.sh`, `el-check.sh`, screenshots.

---

## Task 1: Schema, migration and the QR package

**Files:**
- Modify: `Web Portal/backend/prisma/schema.prisma` (Training section, ~2732–3075)
- Create: `Web Portal/backend/prisma/migrations/20261119010000_learning_hub_modules/migration.sql`
- Modify: `Web Portal/backend/package.json`, `Web Portal/frontend/package.json`, root `package-lock.json`
- Test: `Web Portal/backend/tests/integration/training-modules-schema.test.ts`

**Interfaces — Produces (Prisma):**
```prisma
model TrainingModule {            // @@map("training_modules")
  id String @id @default(cuid())
  courseId String @db.VarChar(191)          // relation to TrainingCourse, onDelete: Cascade; TrainingCourse.modules TrainingModule[]
  position Int @default(0)
  title String @db.VarChar(160)
  moduleKey String @default("general") @db.VarChar(24)   // the feature it teaches (visibility)
  roleKeys Json?                            // staff groups; null/empty: everyone
  companyIds Json?                          // null/empty: every company
  enabled Boolean @default(true)            // off: hidden from learners, not needed
  offReason String? @db.VarChar(16)         // 'REMOVED' (C2)
  starterKey String? @db.VarChar(64)        // 'module:tasks' … (built-in modules)
  fromCourseId String? @db.VarChar(191)     // the built-in short course it replaced
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([courseId, starterKey]) @@index([courseId, position])
}
model TrainingModuleDone {        // @@map("training_module_done")
  id String @id @default(cuid())
  userId String @db.VarChar(191)
  courseId String @db.VarChar(191)
  moduleId String @db.VarChar(191)
  doneAt DateTime
  via String @default("LEARNED") @db.VarChar(12)   // 'LEARNED' | 'CONVERTED'
  createdAt DateTime @default(now())
  @@unique([userId, moduleId]) @@index([userId, courseId]) @@index([courseId])
}
// TrainingLesson:      moduleId String? @db.VarChar(191)   + @@index([moduleId])
// TrainingCertificate: completedAt DateTime?   moduleIds Json?
// TrainingAssignment:  batchId String? @db.VarChar(191)    + @@index([batchId])
```

- [ ] **Step 1:** Write `training-modules-schema.test.ts`: creates a course, two modules (same `starterKey` twice on one course must throw P2002; `null` twice is allowed), a lesson with `moduleId`, a `TrainingModuleDone` row (second row for the same user × module throws P2002), a certificate with `completedAt` + `moduleIds: ['m1']`, an assignment with `batchId`; deleting the course deletes its modules. Cleans up after itself.
- [ ] **Step 2:** Run it on a fresh MySQL test DB (`node <t1181>/mkdb.mjs mico360_t_lh1_tdb "<wt-lh1>/Web Portal/backend" --empty` then the DB command) — expect FAIL (unknown model).
- [ ] **Step 3:** Edit the schema; write the migration by hand (CREATE TABLE … with `utf8mb4_unicode_ci`, ALTER TABLE … ADD COLUMN, CREATE INDEX, the FK `training_modules.courseId → training_courses.id ON DELETE CASCADE`), matching `prisma migrate diff` output; `npx prisma generate`. Check `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` reports no difference.
- [ ] **Step 4:** Apply with `npx prisma migrate deploy` on the MySQL test DB and on MariaDB (`DATABASE_URL=mysql://mico:mico@127.0.0.1:3307/mico360_t_lh1_tdbm`, DB created first with the mariadb client); run the test on both — PASS.
- [ ] **Step 5:** `npm install qrcode-generator@1.4.4 --save-exact --ignore-scripts -w "Web Portal/backend" -w "Web Portal/frontend"` from the repo root; confirm the lockfile entry resolves to `https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-1.4.4.tgz` with a sha512 integrity and no `hasInstallScript`.
- [ ] **Step 6:** Commit schema, migration, test, package files: "Learning Hub: modules, recorded module completion, certificate completion day and QR package (1.23.30)".

---

## Task 2: Pure module rules and the shared API shapes

**Files:**
- Create: `Web Portal/backend/src/modules/training/training-modules.ts`, `training-modules.test.ts`
- Modify: `training-access.ts` (export `groupsMatch`, `companiesMatch`; add `moduleShown`), `training-access.test.ts`
- Modify: `training-types.ts` (shapes below), `Web Portal/frontend/src/api/training.ts` (same shapes, copied), `Web Portal/frontend/src/api/training-types-copy.test.ts`

**Interfaces — Produces:**
```ts
// training-access.ts
export interface ModuleFacts { moduleKey: string; roleKeys: readonly string[]; companyIds: readonly string[]; enabled: boolean }
export function groupsMatch(roleKeys: readonly string[], p: LearnerFacts): boolean;
export function companiesMatch(companyIds: readonly string[], p: LearnerFacts): boolean;
/** enabled && moduleVisible(moduleKey) && groupsMatch && companiesMatch — never more than the person's feature access. */
export function moduleShown(m: ModuleFacts, p: LearnerFacts): boolean;

// training-modules.ts
export const OTHER_UNIT = 'other';   // id of the "Other lessons" unit (lessons with no module in a course that has modules)
export interface UnitLesson { id: string; kind: LessonKind; moduleId: string | null }
export interface Unit { id: string; title: string; position: number; lessonIds: string[] }
/** Modules shown to the person (with ≥1 visible lesson), in position order, then OTHER_UNIT when loose lessons exist. Plain course (no modules): []. */
export function unitsFor(modules: readonly (ModuleFacts & { id: string; title: string; position: number })[], lessons: readonly UnitLesson[], p: LearnerFacts): Unit[];
/** The lessons of `units` in course order (module order, then position) — the person's visible lessons. */
export function orderedLessonIds(units: readonly Unit[]): string[];
export interface UnitProgress { unitId: string; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE'; lessonsDone: number; lessonCount: number; doneAt: Date | null }
/** Done when recorded (doneAt ≥ since) or every needed lesson done under the completion rule (isCourseComplete on the unit's lessons). */
export function unitProgress(u: Unit, rule: CompletionRule | string, lessons: readonly LessonFacts[], doneIds: ReadonlySet<string>, lessonDoneAt: ReadonlyMap<string, Date>, recorded: Date | null, since: Date | null): UnitProgress;
export function allUnitsDone(list: readonly UnitProgress[]): boolean;   // false for an empty list
/** Continue: first unit not done (in order) → its lesson the person last opened if not done there, else its first not-done lesson; null when all done. */
export function continueTarget(units: readonly Unit[], progress: readonly UnitProgress[], doneIds: ReadonlySet<string>, lastLessonId: string | null): { unitId: string; lessonId: string } | null;
/** D3: a valid certificate already covers these done units (ids ⊆ certificate moduleIds). */
export function certificateCovers(moduleIds: readonly string[] | null, doneUnitIds: readonly string[]): boolean;
/** "All staff" · "Admins only" · "Employees only" · "People who run a project" · "Training managers only" · "Admins and people who run a project" (management) — groups joined with " or ", then " · <company names>" when limited; switched off: "Off — the old course was removed" (offReason REMOVED) or "Off". */
export function visibilityWords(m: ModuleFacts & { offReason?: string | null }, companyNames: ReadonlyMap<string, string>): string;
```
API shapes to add (backend `training-types.ts` AND frontend `api/training.ts`, identical):
```ts
export const MODULE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE'] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];
export interface ModuleOutline { id: string; title: string; position: number; status: ModuleStatus; lessonsDone: number; lessonCount: number; minutes: number; doneAt: string | null; newForRole: boolean; nextLessonId: string | null; lessonIds: string[] }
// LessonOutline += moduleId: string | null
// CourseDetail  += modules: ModuleOutline[]          ([] for a course without modules)
// MyCourseState += lessonsDone: number; modules: { done: number; total: number } | null; newForRole: number;
//                  next: { lessonId: string; lessonTitle: string; moduleTitle: string | null } | null
// CertificateRef += completedAt: string; learnerName: string; verifyUrl: string
// VerifyResult  += completedAt: string
// LessonView    += module: { id: string; title: string; lessonIndex: number; lessonCount: number } | null
// LessonDone    += moduleDone: { id: string; title: string } | null
export interface ManageModule { id: string; title: string; position: number; moduleKey: TrainingModule; roleKeys: RoleKey[]; companyIds: string[]; enabled: boolean; offReason: 'REMOVED' | null; starter: boolean; visibility: string }
export interface ModuleInput { title: string; moduleKey?: TrainingModule; roleKeys?: RoleKey[]; companyIds?: string[]; enabled?: boolean }
// ManageCourse  += modules: ManageModule[]; notice: string | null
// ManageLesson  += moduleId: string | null
// ManageCourseRow += notice: string | null; limitedTo: string | null; everPublished: boolean; moduleCount: number
// LIMITS        += moduleTitle: 160, modulesPerCourse: 30, peoplePerAssignment: 200
export const ASSIGN_TARGET_KINDS = ['USER', 'GROUP', 'DEPARTMENT', 'COMPANY', 'PROJECT', 'PEOPLE'] as const;   // PEOPLE: several ticked people (R4), stored as USER rows sharing a batchId
// AssignmentRow.targetKind becomes TargetKind | 'PEOPLE'; AssignmentRow += batchId: string | null; members: { assignmentId: string; userId: string; name: string }[]
export const REPORT_DATES = ['got', 'finished'] as const;          // R2 "Dates by"
// ReportRow     += enrolments: number; selfStarted: number        (people = distinct persons)
// TrainingReport += dates: ReportDates; modules: ModuleReportRow[] | null; learners: ModuleLearnerRow[] | null
//                   quizzes[i] += people: number; moduleTitle: string | null; questions: number
export interface ModuleReportRow { moduleId: string; title: string; people: number; done: number; inProgress: number; notStarted: number }
export interface ModuleLearnerRow { userId: string; name: string; modulesDone: number; modulesRequired: number; lastActivityAt: string | null; certificate: { id: string; code: string } | null }
```

- [ ] **Step 1:** Write `training-modules.test.ts` and extend `training-access.test.ts` with these cases (people built from `LearnerFacts`: admin, employee, project runner, training manager, client, employee of company B):
  - `moduleShown` — a `reports`/`admin` module: admin true, employee/runner/TM false, client false; `management`: admin and runner true; roleKeys `['training-managers']` on `tasks`: TM true, employee false; companyIds `['A']`: employee of B false, admin true; `enabled:false`: false for everyone.
  - `unitsFor` — modules [Tasks(pos 1), Reports(pos 2, reports), Empty(pos 3: only an unlinked video so no visible lesson)] + one loose lesson → employee gets `[Tasks, other]`, admin gets `[Tasks, Reports, other]`; a course with no modules → `[]`.
  - `unitProgress` — 0 done → NOT_STARTED; 2 of 3 → IN_PROGRESS with lessonsDone 2; all done + quiz passed → DONE with doneAt = latest lesson doneAt; recorded row with doneAt before `since` (retake) and nothing done → NOT_STARTED; recorded row after `since` → DONE with that date even when lessonCount grew.
  - `continueTarget` — units [A done, B in progress, C not started], last opened lesson in B not done → that lesson; last opened in C → B's first not-done (order wins); all done → null.
  - `certificateCovers(null, ['a'])` false; `(['a','b'], ['a'])` true; `(['a'], ['a','b'])` false.
  - `visibilityWords` — `{tasks, [], []}` "All staff"; `{reports}` "Admins only"; `{tasks, ['employees']}` "Employees only"; `{tasks, ['admins','project-runners']}` "Admins or people who run a project"; companies → "All staff · Contoso Engineering"; `{enabled:false, offReason:'REMOVED'}` "Off — the old course was removed".
- [ ] **Step 2:** Run `npx vitest run src/modules/training/training-modules.test.ts src/modules/training/training-access.test.ts` — FAIL.
- [ ] **Step 3:** Implement; add the shapes to `training-types.ts` and `api/training.ts`; extend `training-types-copy.test.ts` to compare `MODULE_STATUSES`, `ASSIGN_TARGET_KINDS`, `REPORT_DATES` and the new LIMITS keys.
- [ ] **Step 4:** Run backend tests above + `npx tsc -p tsconfig.json --noEmit` (backend) and website `npx vitest run src/api/training-types-copy.test.ts` + `npm run typecheck` — PASS (fill new fields with placeholders where existing code builds these shapes only if typecheck forces it; the real values come in Tasks 3–9).
- [ ] **Step 5:** Commit: "Learning Hub: module rules — who sees a module, its progress, Continue and certificate coverage (1.23.30)".

---

## Task 3: Person-aware reads and finishing with modules

**Files:**
- Modify: `training-read.ts`, `training-state.ts`, `training-finish.ts`, `training-certificates.ts` (none expected), `training-sync.ts` (`applyExpiry` unchanged)
- Test: `tests/integration/training-modules.test.ts` (new), existing `training-*.test.ts` must stay green

**Interfaces:**
- Consumes: Task 2 (`unitsFor`, `unitProgress`, `allUnitsDone`, `continueTarget`, `certificateCovers`, `moduleShown`).
- Produces:
```ts
// training-read.ts
export interface UnitState extends UnitProgress { unit: Unit; minutes: number; newForRole: boolean }
export interface PairState { /* existing fields */ units: UnitState[] /* [] for plain courses */; continueAt: { unitId: string; lessonId: string } | null; modules: { id: string; title: string; position: number; moduleKey: string; roleKeys: string[]; companyIds: string[]; enabled: boolean; offReason: string | null }[] /* all of the course's modules */ }
/** lessons: the person's visible lessons in course order; people: optional preloaded records (else read via ctx.people). */
export async function loadStates(ctx: TrainingContext, pairs: readonly { userId: string; courseId: string }[], people?: ReadonlyMap<string, PersonRecord>): Promise<Map<string, PairState>>;
// training-finish.ts
settle(userId, course, state, o?: { person?: PersonRecord | null; touch?: boolean }): Promise<{ courseCompleted: boolean; certificateId: string | null; moduleDone: { id: string; title: string } | null }>;
issueCertificate(p: PersonRecord, course: CourseRow, state: PairState, o?: { keepOld?: boolean; completedAt?: Date }): Promise<string>;   // writes completedAt (default now) and moduleIds (done unit ids, OTHER_UNIT excluded) for module courses
/** Conversion: finish a person's module course at `completedAt` quietly (no notice), with its certificate; no-op when already finished. */
completeAt(userId: string, course: CourseRow, state: PairState, completedAt: Date, person: PersonRecord): Promise<{ completed: boolean; certificateId: string | null }>;
```
Rules: for a course with modules, `courseState` uses units: `progressPct = floor(doneUnits / units × 100)`; IN_PROGRESS when started or any lesson done; completion = `allUnitsDone`. `newForRole` = course COMPLETED and unit not DONE. `settle` (a) upserts a `training_module_done` row (`via: 'LEARNED'`, doneAt = unit doneAt) for each unit newly DONE in this cycle (`OTHER_UNIT` never recorded) — on a retake, an older row is updated (`updateMany where doneAt < retakeFrom`); (b) completes the course when all units are done (as today, `completedAt = now`, certificate when `certificateOn`); (c) D3: when already COMPLETED (not REVIEW/RETAKE), all units done, `certificateOn`, and the person's newest valid certificate for the course exists and `!certificateCovers(its moduleIds, doneUnitIds)` → `issueCertificate(…, { keepOld: true })`; (d) returns `moduleDone` = the unit this call newly recorded (first one). Plain courses behave exactly as today (all existing tests stay green). Review (R11) and retake (R10) keep working over the person's visible lessons only.

- [ ] **Step 1:** Write `tests/integration/training-modules.test.ts` (company world from `company-world.ts`, a module course made in the DB: Getting started (all), Tasks (all), Reports (moduleKey reports), Admin (moduleKey admin), each with a guide + a quiz; certificateOn) with:
  - "employee sees two modules, admin four" — `loadStates` units for ana (employee) = 2, for the admin = 4; lessons of Reports/Admin absent from ana's `lessons`.
  - "finishing the employee's modules completes the course and issues one certificate with moduleIds of both" — complete guides via `learner.complete`, pass quizzes via attempt/submit; check enrolment completedAt, certificate `completedAt` set, `moduleIds` length 2; `training_module_done` rows 2 with via LEARNED.
  - "D3 role growth" — make ana admin after completion: status stays COMPLETED, Reports/Admin `newForRole`; finishing them issues a second certificate, the first still valid (revokedAt null), second's moduleIds length 4.
  - "role shrink" — admin with all 4 done, demoted: still COMPLETED; no new certificate.
  - "unlinked-only module" — a module whose only lesson is an unlinked VIDEO: not in units, course completes without it.
  - "switched-off module" — enabled false: not in units, not needed.
  - "retake" — certificateMonths 1, expire it (`applyExpiry`): every module must be done again (recorded rows ignored), finishing again issues a new certificate.
  - "recorded module stays done after a lesson is added" — add a guide to a done module: unit stays DONE (recorded), course stays COMPLETED.
- [ ] **Step 2:** Run on MySQL — FAIL.
- [ ] **Step 3:** Implement in `training-read.ts` (load modules for the courses and the people once; per pair compute units, filter + order lessons, unit progress with recorded rows, `continueAt`), `training-state.ts` (unit-aware `courseState` input `units?: UnitProgress[]`), `training-finish.ts` (rules above). Keep `hiddenLesson` and every 1.23.27 rule.
- [ ] **Step 4:** Run the new file and every `tests/integration/training*.test.ts` on MySQL and MariaDB; run `npx vitest run src/modules/training` — PASS.
- [ ] **Step 5:** Commit: "Learning Hub: modules each person can see, their progress, finishing and the updated certificate for a grown role (1.23.30)".

---

## Task 4: Learner API with modules, redirects and certificate details

**Files:**
- Modify: `training-learner.ts`, `training-routes.ts`, `portal-training-routes.ts` (only if shapes pass through), `training-certificates.ts` (none expected)
- Test: `tests/integration/training-modules-learner.test.ts` (new); `training-learner.test.ts`, `training-simple.test.ts` stay green

**Interfaces:**
- Consumes: Task 3 `PairState.units`, `continueAt`; Task 2 shapes.
- Produces: `CourseDetail.modules` (ModuleOutline per unit; `OTHER_UNIT` titled "Other lessons"), `lessons[].moduleId`, `resumeLessonId` = `continueAt.lessonId` for module courses; card `mine.lessonsDone`, `mine.modules`, `mine.newForRole`, `mine.next` (lesson + module title of `continueAt` / `nextLessonId`); `LessonView.module`, `prev/nextLessonId` across the person's visible lessons in order; `LessonDone.moduleDone`; `learn(module)` → `{ courseId, moduleId, module, count }` (a module course counts when one of its visible modules has that `moduleKey`; `moduleId` set then); catalogue `module` filter matches such courses too; `CertificateRef.completedAt` (`completedAt ?? issuedAt`), `learnerName`, `verifyUrl` (`verifyLink(ctx.appUrl, code)`); `verify()` adds `completedAt`.
- Errors: lesson/progress/complete/startAttempt for a lesson of a module the person can't see → 404 `notFound('Lesson')` for learners; managers → read allowed (preview), learn calls 409 `NOT_FOR_YOU`. `course(id)` of a course listed in the conversion record's `moved` map → `HttpError('This course is now part of MICO360 Tasks User Training.', 'COURSE_MOVED', 404, { courseId, moduleId })`; `lesson(id)` not found but listed in `removedLessons` → the same error. Read the record via `readSetting(prisma, 'training.oneCourse')` (shape owned by Task 10: `{ moved: Record<string, { courseId: string; moduleId: string | null }>; removedLessons: Record<string, { courseId: string; moduleId: string | null }> }`).

- [ ] **Step 1:** Write `training-modules-learner.test.ts`:
  - "course detail lists only the person's modules, in order, with states" — employee: 2 modules, statuses NOT_STARTED → after one guide IN_PROGRESS "1 of 2", after all + quiz DONE with doneAt; `mine.modules` `{done:1,total:2}`.
  - "Continue opens the next unfinished module where they stopped" — open lesson 2 of module 2 (saveProgress stepIndex 1), detail `resumeLessonId` = that lesson; the lesson view's `progress.stepIndex` = 1.
  - "a hidden module's lesson is refused" — employee `lesson(reportsLessonId)` → 404; `saveProgress`/`complete`/`startAttempt` → 404; a Training manager (not admin) `lesson()` → 200, `complete()` → 409 NOT_FOR_YOU.
  - "next lesson skips hidden modules" — employee on the last lesson of Tasks: `nextLessonId` is the next visible lesson (not Reports').
  - "learn('tasks') points at the module" — `{ courseId: moduleCourse, moduleId: tasksModule }`.
  - "old short-course links" — write `training.oneCourse` `{ moved: { [oldId]: { courseId, moduleId } }, removedLessons: { [goneLessonId]: {...} } }`; `course(oldId)` → COURSE_MOVED with details; `lesson(goneLessonId)` → COURSE_MOVED. Restore the setting after.
  - "certificate refs carry the completion day, name and link" and "verify shows the completion day".
- [ ] **Step 2:** Run on MySQL — FAIL.
- [ ] **Step 3:** Implement in `training-learner.ts`.
- [ ] **Step 4:** Run the new file + all `tests/integration/training*.test.ts` on both engines, and backend `npx vitest run src/modules/training` — PASS.
- [ ] **Step 5:** Commit: "Learning Hub: the course page by module, Continue where you stopped, and old course links open the right module (1.23.30)".

---

## Task 5: Certificate PDF with a QR code and the completion day

**Files:**
- Create: `src/modules/training/training-qr.ts`, `training-qr.test.ts`
- Modify: `training-certificate-pdf.ts`, `training-certificate-pdf.test.ts`, `training-learner.ts` (pass `completedAt`), `src/lib/pdf-document.ts` only if a square-drawing helper is missing (add `qr(matrix: boolean[][], size: number)` drawing filled rects, no text)

**Interfaces:**
```ts
// training-qr.ts
/** The QR code of `text` as rows of dark (true) / light modules; error correction M, smallest type that fits. */
export function qrMatrix(text: string): boolean[][];
// training-certificate-pdf.ts: CertificatePdf += completedAt: Date   ("has completed … on <completedAt>"; "Completed" row = completedAt; "Issued" row = issuedAt only when a different day)
```
- [ ] **Step 1:** Tests: `qrMatrix('https://acme.example/verify/TC-2345-6789-ABCD')` is square, side ≥ 21, side % 4 === 1, three finder patterns (top-left 7×7 dark border); same input → same matrix. PDF test: the text layer contains "Completed", the completion day ("3 Nov 2026" style via `formatDay`), the code, and the verify URL; the built PDF is larger than without QR (`qr` drawn) and still one page.
- [ ] **Step 2:** Run `npx vitest run src/modules/training/training-qr.test.ts src/modules/training/training-certificate-pdf.test.ts` — FAIL.
- [ ] **Step 3:** Implement with `qrcode-generator` (`import qrcode from 'qrcode-generator'`; `qrcode(0, 'M')`, `addData`, `make`, `isDark`); draw the QR (about 96 pt square, quiet zone 4 modules) beside "Check this certificate at <link>", with alt-free vector squares; certificate PDF passes `completedAt`.
- [ ] **Step 4:** Run — PASS; plus backend `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: "Learning Hub: certificates show the completion day and a QR code that opens the check page (1.23.30)".

---

## Task 6: Module editor API, Duplicate and the Manage list facts

**Files:**
- Create: `src/modules/training/training-manage-modules.ts` (module operations, called from `training-manage.ts`), `src/modules/training/training-duplicate.ts`
- Modify: `training-manage.ts` (manageCourse/listCourses fields, lesson `moduleId` in `lessonPatchSchema`, audience filter), `training-manage-routes.ts`, `src/modules/companies/route-classes.ts`
- Test: `tests/integration/training-modules-manage.test.ts` (new); `training-manage.test.ts` stays green; unit tests for any pure helper

**Interfaces — Produces (routes, all `auth` + `managerOf`, class `shared` in route-classes):**
- `POST /training/manage/courses/:id/modules` body `ModuleInput` → 201 `ManageCourse` (appended last; position = max+1; `LIMITS.modulesPerCourse`)
- `PATCH /training/manage/modules/:id` body `Partial<ModuleInput>` → `ManageCourse`
- `POST /training/manage/modules/:id/remove` body `{ moveTo: string | null }` → `ManageCourse` (lessons moved to `moveTo` (same course, else 400) or to no module, appended after its lessons; then the module row deleted; never deletes a lesson)
- `PUT /training/manage/courses/:id/module-order` body `{ moduleIds: string[] }` (every module once, else 400) → `ManageCourse`
- `PATCH /training/manage/lessons/:id` accepts `moduleId: string | null` (module of the same course, else 400; lesson goes last in its new module)
- `POST /training/manage/courses/:id/duplicate` → 201 `ManageCourse` (draft "Copy of <title>" cut to 160; summary, moduleKey, audience, roleKeys, difficulty, completionRule, inOrder, certificateOn/Months, issuer fields, companyIds, modules (starterKey/fromCourseId null), lessons with steps, quiz + questions + options, video links, documents, step pictures and downloads as NEW stored copies; `starterKey` null; nothing of progress, enrolments, assignments, certificates, feedback; audited `training.course.duplicate`)
- `GET /training/manage/courses?audience=STAFF|CLIENTS` filter.
- Every module change: `touchCourse` (so a built-in course counts as edited, D6/9b), audit `training.module.create|update|remove|reorder`, `assertStillPublishable` kept, then `recheck(courseId)` (switching off / hiding can finish people).
- `ManageCourse.modules` with `visibility = visibilityWords(…)`; `ManageCourse.notice` and `ManageCourseRow.notice` = "This built-in course was edited, so it wasn't merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you're ready." when the course id is in the record's `notMerged` list and the course isn't ARCHIVED; `limitedTo` = `visibilityWords` of the course facts when not "All staff"/"Clients" (else null); `everPublished = publishedAt !== null`; `moduleCount`.
- Batch 4b's "warn before deleting a certificate course's quiz" stays as it arrives with v1.23.28.

- [ ] **Step 1:** Write `training-modules-manage.test.ts`: add/rename/reorder modules; module visibility saved and its words; remove with `moveTo` moves lessons (none deleted) and with `null` leaves them loose; a lesson moved between modules; a built-in (starterKey) course after a module change is no longer `untouchedStarter`; switching a module off finishes a person who had done every other module (recheck) and issues the certificate; a Training manager can do all of this, an employee gets 403; Duplicate copies modules/lessons/quiz/pictures (new storage keys, files readable), resets status to DRAFT, copies no enrolments/assignments/certificates/feedback, `starterKey` null; list filter by audience; `notice`/`limitedTo`/`everPublished`.
- [ ] **Step 2:** Run on MySQL — FAIL.
- [ ] **Step 3:** Implement; add the route-class lines; keep `client-route-table.test.ts` and the route-class scan test green.
- [ ] **Step 4:** Run the new file, `training-manage.test.ts`, all training integration tests on both engines; backend `npx vitest run src/modules/companies src/modules/clients src/modules/training` — PASS.
- [ ] **Step 5:** Commit: "Learning Hub: editable modules in any course, Duplicate a course, and plain visibility words in Manage (1.23.30)".

---

## Task 7: Assigning several people at once (R4)

**Files:**
- Modify: `training-manage.ts` (`assignmentInputSchema`, `previewAssignment`, `assign`, `listAssignments`/`assignmentRows`), `training-manage-routes.ts`, `route-classes.ts`
- Test: `tests/integration/training-assign-people.test.ts` (new)

**Interfaces:**
- Input: `{ courseIds, targetKind: 'PEOPLE', userIds: string[] (1..LIMITS.peoplePerAssignment, distinct), mandatory, dueDay?, dueDays? }` (`targetId` omitted for PEOPLE; `newStaffOnly` refused for PEOPLE). Each person checked like a USER target (`checkTarget`). Creates, per course, one USER assignment per person, all sharing one new `batchId` (cuid); one sync.
- `listAssignments` groups rows with the same `batchId` and course into one `AssignmentRow` (`targetKind: 'PEOPLE'`, `targetLabel: '<n> people'`, `members` sorted by name, counts summed); single-person/other rows unchanged (`batchId: null`, `members: []`).
- `DELETE /training/manage/assignment-batches/:batchId` (class `people`) withdraws every member a Training manager may change (`mayChange`); per person: the existing `DELETE /training/manage/assignments/:id`.

- [ ] **Step 1:** Tests: preview with three people → reach 3; assign → three USER rows with one batchId, one TRAINING_ASSIGNED notice each; list shows one row "3 people" with 3 members; withdraw one member → row "2 people"; withdraw the batch → gone; a Training manager can't include a person outside her companies (400); 201 people → 400.
- [ ] **Step 2:** Run on MySQL — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it + `training-manage.test.ts` on both engines — PASS.
- [ ] **Step 5:** Commit: "Learning Hub: assign a course to several people at once, shown as one entry (1.23.30)".

---

## Task 8: Reports — people once, Started themselves, Dates by, quiz table, module views

**Files:**
- Modify: `training-reports.ts`, `training-reports.test.ts`, `training-report-service.ts`, `training-report-service.test.ts`, `training-export.ts`, `training-export.test.ts`, `training-report-routes.ts` (query `dates`)
- Test: `tests/integration/training-reports.test.ts` (extend)

**Interfaces:**
- Query `?dates=got|finished` (default `got`): `got` filters enrolments by `createdAt` (as today); `finished` by `completedAt` (only finished ones). Quizzes keep `submittedAt`.
- `ReportRow.people` = distinct persons; `enrolments` = rows counted; `completionRate = completed / enrolments`; `selfStarted` = enrolments with `selfStarted` and no active assignment.
- `quizzes[]` include no-attempt quizzes (website hides them behind "Show all quizzes"), with `people` (distinct persons with an attempt), `moduleTitle`, `questions` (count).
- When `courseId` is a course with modules: `modules` = per module the persons who can see it (`moduleShown`) among the course's enrolments in scope: done / inProgress / notStarted; `learners` = per person modulesDone / modulesRequired / lastActivityAt / newest valid certificate. Else both `null`.
- Exports: a header line "Dates by: Got the course" or "Dates by: Finished the course"; a "Started themselves" column; when `modules`/`learners` present, two more sheets/sections "By module" and "By person".

- [ ] **Step 1:** Unit tests (`aggregateReport`): two enrolments of one person → totals.people 1, enrolments 2; selfStarted counted only when not assigned; completionRate uses enrolments. Service/export tests for `dates=finished` filter and header words. Integration: module course with an employee and an admin → `modules` Reports row counts only the admin; `learners` rows `modulesRequired` 2 vs 4; certificate code listed.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run unit + integration (both engines) — PASS.
- [ ] **Step 5:** Commit: "Learning Hub reports: people counted once, Started themselves, Dates by, and progress by module and by person (1.23.30)".

---

## Task 9: Built-in content revision 3 — the combined course and the client guide's certificate

**Files:**
- Modify: `starter/starter-types.ts`, `starter/starter-courses.ts`, `starter/starter-courses.test.ts`, `training-starter.ts` (load + update with modules), `tests/integration/training-starter.test.ts`
- Lane: coverage table in `.superpowers/lh1/progress.md`

**Interfaces — Produces:**
```ts
// starter-types.ts
export interface StarterModule { key: string /* 'module:getting-started' … */; title: string; moduleKey: TrainingModule; roleKeys?: RoleKey[]; /** the 1.23.27 short course it replaces */ from: string }
// StarterLesson gains `module?: string` (a StarterModule key); StarterCourse gains `modules?: StarterModule[]`
// starter-courses.ts
export const STARTER_REVISION = 3;
export const USER_TRAINING_KEY = 'starter:user-training';
/** Revision 2's short courses, in the old order: key → module key (the conversion's map). */
export const SHORT_COURSE_MODULES: readonly { courseKey: string; module: string }[];   // { courseKey: 'starter:tasks', module: 'module:tasks' } — module = a StarterModule key
export const STARTER_COURSES: StarterCourse[] = [userTraining, portal];   // userTraining: title 'MICO360 Tasks User Training', moduleKey 'general', STAFF, position -1, certificateOn true, certificateMonths null; portal: certificateOn true
// training-starter.ts
/** Writes the course's lessons (and their modules) to match `course` — used by bringUpToDate and the conversion. */
export async function applyStarterLessons(tx: Prisma.TransactionClient, courseId: string, course: StarterCourse, rows: LessonRowWithQuiz[], fileIds: ReadonlyMap<string, string>, at: Date): Promise<{ removedLessonIds: string[] }>;
// TrainingStarterDeps += convert?: () => Promise<{ courseId: string } | null>   (called in update() when the noted revision < 3, before the loop; the loop then skips USER_TRAINING_KEY)
```
Module list (key → title, moduleKey, roleKeys, from): `module:getting-started` Getting started, general, —, starter:getting-started; `module:tasks` Tasks, tasks, starter:tasks; `module:board` Kanban board, board, starter:board; `module:projects` Projects, projects, starter:projects; `module:calendar` Calendar, calendar, starter:calendar; `module:meetings` Meetings & minutes, meetings, starter:meetings; `module:chat` Chat, chat, starter:chat; `module:mico-ai` MICO AI, mico-ai, starter:mico-ai; `module:reports` Reports, reports, ['admins'], starter:reports; `module:admin` Admin settings, admin, ['admins'], starter:admin.

Content decisions (the coverage table records each old lesson/step → new place or "removed as a duplicate of X"):
- Every module keeps its 1.23.27 lessons with the SAME titles (so a moved lesson keeps its id): its Video lesson, its guides, "Quiz: <name>".
- Removed as duplicates: Calendar step "Your week and time zone" (→ Getting started "Your settings", which now names **Calendar & dates**); Kanban "Add a task to a column" loses "or click + New task at the top of the page" (→ Tasks "Start a new task"); Reports guide intro "Reports is for administrators." (→ the module is shown to administrators only).
- Rewritten: Getting started "The side menu" (1.23.28 menu), "The Learning Hub" (one course "MICO360 Tasks User Training", modules for your role, Continue picks up where you stopped, certificate with a QR code when you finish); Admin settings "Company settings" (System Settings includes Companies; **Third Party** holds Clients and Guest contacts; **Audit Logs**, **Error Log** and **Recycle Bin** are in the account menu under your name; AI Management unchanged) and its quiz questions that name those places.
- Quizzes: 3–5 questions, all SINGLE except the two ORDER questions (Meetings & minutes, Admin settings); every TRUE_FALSE and MULTIPLE becomes a SINGLE question testing the same fact; Calendar's "Where do you choose the day your week starts on?" moves to the Getting started quiz.
- Pictures: the existing 48 WebP files; no new pictures; no step references a missing file.
- Course summary: "Everything you need to use MICO360 Tasks, one part at a time. You see the parts for your role; finish them all for your certificate."

- [ ] **Step 1:** Extend `starter-courses.test.ts`: `STARTER_REVISION === 3`; two courses; the combined course has 10 modules in the order above with the moduleKeys/roleKeys above; every module starts with a VIDEO lesson titled "Video: …", has ≥1 GUIDE, ends with one QUIZ of 3–5 questions all SINGLE or ORDER, ≤1 ORDER, passMark 70, maxAttempts null; every lesson has a `module`; each lesson title of each 1.23.27 module course (revision 2 titles, from a frozen list in the test) exists in its module; every image exists in `assets/training/starter`; no text contains "OXY" (case-insensitive, word) or the words "short course"; the strings "Third Party", "Audit Logs", "Error Log", "Recycle Bin", "Calendar & dates" appear; the portal course has certificateOn true. Extend `training-starter.test.ts` (fixture with modules): a fresh load creates the modules and sets each lesson's moduleId; an untouched course with modules is brought up to date keeping lesson ids and moving a lesson to its new module; a course whose module was edited is not updated.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Write the content; implement modules in `create`/`bringUpToDate` via `applyStarterLessons` (module rows matched by `starterKey`, created when missing, positions from the content; untouched check unchanged — module edits touch the course).
- [ ] **Step 4:** Run unit + `training-starter.test.ts` on both engines — PASS. Fill the coverage table in the ledger.
- [ ] **Step 5:** Commit: "Learning Hub: one built-in course, MICO360 Tasks User Training, with a module for each part of the site; the client guide gives a certificate (1.23.30)".

---

## Task 10: The one-time conversion of existing sites

**Files:**
- Create: `src/modules/training/training-one-course.ts`, `tests/integration/training-one-course.test.ts`
- Modify: `training-starter.ts` (call `deps.convert` in `update()`), `training-wiring.ts`, `src/server.ts` (no new job; the conversion runs inside `training.starter.run()`)

**Interfaces:**
```ts
export const ONE_COURSE_KEY = 'training.oneCourse';
export interface OneCourseRecord { phase: 'content' | 'people' | 'assignments' | 'finish' | 'done'; at: string; courseId: string; moved: Record<string, { courseId: string; moduleId: string | null }>; removedLessons: Record<string, { courseId: string; moduleId: string | null }>; notMerged: string[]; noticesAt: string | null }
export interface OneCourseDeps { prisma; files; ctx: TrainingContext; finish: TrainingFinish; content?: StarterCourse /* the combined course */; portalKey?: string; shortCourses?: readonly { courseKey: string; module: string }[]; assetsDir?: string | null; recordKey?: string; failAfter?: OneCourseRecord['phase'] /* tests: throw after this phase */ }
export function createOneCourseConversion(d: OneCourseDeps): { run(): Promise<{ courseId: string } | null> };
```
Phases (each re-runnable; the record is written after each; `run()` returns at once when `phase === 'done'`; returns null when the site never loaded short courses):
1. **content** — in ONE `withSentinelLock(prisma, 'training-one-course', tx => …)` transaction (pictures for fresh lessons copied to storage BEFORE it, removed again if it fails): create the course (`starterKey` USER_TRAINING_KEY, PUBLISHED, version 1, publishedAt = now, certificateOn, no expiry) and its 10 modules. For each short course: **untouched** (`untouchedStarter`) and PUBLISHED → move its lessons, files, progress rows, attempts and QUESTION/OUTDATED feedback to the course (`courseId` updated, lesson `moduleId` set), then `applyStarterLessons` for that module's lessons; archive the short course; `moved[shortId] = { courseId, moduleId }`; deleted duplicate lessons → `removedLessons`. **Edited** and PUBLISHED → module gets fresh lessons from content (C1a); `notMerged.push(id)`; `fromCourseId` set. **Missing / ARCHIVED / DRAFT** → fresh lessons, module `enabled: false`, `offReason: 'REMOVED'` (C2). Stamp every row as published with nothing changed since (course and lessons `updatedAt = publishedAt`).
2. **people** — for everyone with an enrolment (any state) in a short course or a progress row on a moved lesson: upsert one enrolment on the course (`createdAt`/`startedAt` = earliest, `lastActivityAt` = latest, `lastLessonId` = the latest moved one, `selfStarted` = any, `withdrawnAt` = null unless every source enrolment was withdrawn); for every source enrolment finished (completedAt set, no active retake) — untouched, edited (C1b: completions up to now) or removed (C2) — upsert `training_module_done` `{ via: 'CONVERTED', doneAt: completedAt }` (keep the earlier doneAt if a row exists). Then hide merged courses' enrolments (`withdrawnAt = now`).
3. **assignments** — every active assignment of a PUBLISHED short course (untouched or edited): group by target (`targetKind`, `targetId`, `ruleId`, `newAccountsOnly`, `scopeCompanyIds`); per group in one sentinel-locked transaction: create one course assignment (mandatory = any; due per D2 ruling: none only if all none; fixed = max(today+30, latest old fixed day); relative = max(30, largest dueDays); `createdAt` = now, or the rule's createdAt for rule assignments; `ruleId` kept), create its assignees directly for every person the old rows reached (mandatory = any of theirs, dueDay = max(their old dueDay, today+30) or null when all theirs were null and the assignment has no due; `assignedAt` = their earliest) AND for anyone else the new assignment reaches today (`reaches()` with its D2 due) — so the next sync sends no TRAINING_ASSIGNED notice; withdraw the old assignments and assignee rows (`withdrawnAt` now) in the same transaction. Rules: `courseIds` short ids → the course id (deduped), `dueDays` → max(30, dueDays) when set. Afterwards `sync.settleEnrolments` for the touched pairs.
4. **finish** — `loadStates` for every enrolment on the course: whoever has all units done → `finish.completeAt(userId, course, state, latest unit doneAt, person)` (certificate with that `completedAt`, quietly). Client guide (C3): if the portal course is untouched → `certificateOn = true` keeping its stamps, then certificates (with `completedAt` = their completion) for clients who finished it and have none.
5. **done** — bell-only notices once (`noticesAt`): `prisma.notification.createMany` for active staff with a non-withdrawn enrolment on the course: type `TRAINING_ASSIGNED`, title "Your training is now one course: MICO360 Tasks User Training", body "Open it from My learning in the Learning Hub.", entityType `training-course`, entityId the course id. Record `phase: 'done'`.

- [ ] **Step 1:** Write `training-one-course.test.ts` (tagged fixture content: a 3-module combined course built from three tagged short courses, keys injected through deps; settings key injected as `recordKey`) with:
  - "untouched short courses move with their ids" — lesson ids unchanged, `courseId` = new course, progress and attempts follow; old course ARCHIVED with no lessons; `moved` map written.
  - "finished training is kept" — person finished short course A → module A DONE with that date (`via` CONVERTED), even though the module gained a lesson; in-progress lesson keeps `stepIndex`; quiz attempts listed under the new course.
  - "people whose modules are all done are finished with a certificate dated the latest completion" — and no notification through `ctx.notify` (spy: zero calls).
  - "edited short course (C1)" — stays PUBLISHED with its lessons; module gets fresh lessons; its completion counts; its assignment moves (old withdrawn); `notMerged` lists it; a completion of it AFTER the conversion does not create a module-done row.
  - "removed short course (C2)" — archived before: module `enabled:false`, `offReason:'REMOVED'`; switching it on (manage API) makes its earlier completions count.
  - "assignments and rules (D2)" — fixed due day 10 days out → today+30; 60 days out → kept; relative 7 → 30; two short-course assignments to the same group merge into one (mandatory if any); a rule's courseIds become the course; the next `sync.all()` sends zero TRAINING_ASSIGNED notices; reminders sweep sends nothing today.
  - "client guide (C3)" — untouched: certificateOn true, a client who finished gets a certificate, no notify; edited: untouched.
  - "bell-only notice once" — one `notifications` row per enrolled staff member; second run adds none.
  - "second start changes nothing" — snapshot of course/lesson/module/enrolment/assignment/certificate/notification counts and stamps equal after a second `run()`.
  - "half-way failure" — `failAfter: 'content'` then `failAfter: 'people'` then a clean run → same end state as a single clean run on a twin fixture; between the runs the site answers `learner.me` and `learner.course` for an employee without error.
  - "a fresh site needs no conversion" — `run()` returns null and writes nothing when no short course key was ever loaded.
- [ ] **Step 2:** Run on MySQL — FAIL.
- [ ] **Step 3:** Implement `training-one-course.ts`; wire `convert` in `training-wiring.ts` into `createTrainingStarter`; in `update()`: `if (prev.revision < 3 && deps.convert)` call it first (a throw counts as failed: revision not noted, retried at the next start; the loop skips USER_TRAINING_KEY then too).
- [ ] **Step 4:** Run the file + `training-starter.test.ts` + all training integration tests on MySQL AND MariaDB — PASS. Check `git grep -n isolationLevel -- "Web Portal/backend/src/modules/training"` finds nothing and any raw SQL passes `portabilityProblems`.
- [ ] **Step 5:** Commit: "Learning Hub: existing sites move to the one course once, keeping everyone's progress, finished training and certificates (1.23.30)".

---

## Task 11: Website — the learner side

**Files:**
- Create: `components/training/QrCode.tsx` (+ test), `components/training/CertificateView.tsx` (+ test), `components/training/ModuleList.tsx` (+ test)
- Modify: `components/training/training-ui.tsx` (`CourseCardView` button), `TrainingLists.tsx` (Up next words, Done fold), `CourseView.tsx`, `LessonPlayer.tsx`, `LearnLink.tsx`, `training-words.ts`, `pages/training/VerifyPage.tsx`, `components/training/training-fixtures.tsx`; their tests

**Interfaces:**
- Consumes: Task 2 shapes (frontend copies), Task 4 behaviour (`COURSE_MOVED` details, `learn()` moduleId).
- Produces: `<QrCode value={string} size={number} label={string} />` (SVG via qrcode-generator, `role="img"`, `aria-label`); `<CertificateView certificate={CertificateRef} />` (learner name, course title, "Completed <day>", code, valid/revoked/expired, QR of `verifyUrl`, Download PDF, "Check it online" link on staff side only); `coursePath(base, id, module?, moduleId?)` adds `moduleId=` to open a module.
Behaviour:
- Cards (All courses, To do, Done, portal): whole card stays one stretched link; a separate small button (sibling, not nested) "Start" / "Continue" / "Review" (`courseAction`) going where the card's `mine.next.lessonId` (or `nextLessonId`) points; progress words "0 of 3 lessons" / "4 of 8 modules"; "New for your role: 2" chip when `mine.newForRole > 0`.
- Up next: names the next lesson and module ("Next: Tasks · Work on a task").
- Done: first 6 cards, then "Show all N" toggle (aria-expanded).
- Course page with modules: "4 of 8 modules"; one Continue button → `resumeLessonId`; module list in order, each with status words "Not started" / "In progress · 2 of 5 lessons" / "Done · 3 Nov 2026" and "New for your role"; expanding a module lists its lessons (ticks); `?moduleId=` opens and scrolls to it. Plain courses unchanged.
- Certificate: `CertificateView` replaces the course page's certificate card (staff and portal); My learning's Done cards keep "Certificate (PDF)".
- Lesson player: crumbs "Learning Hub › <course> › <module>"; "Lesson 2 of 5 in Tasks"; one "Module done: Tasks" note when `moduleDone`; Next skips to the next visible lesson (server `nextLessonId`).
- Old links: CourseView on `ApiError` code `COURSE_MOVED` → `navigate(coursePath(base, details.courseId, null, details.moduleId), { replace: true })`; LessonPlayer when `lesson.courseId !== courseId` → replace to `lessonPath(base, lesson.courseId, lesson.id)`; lesson `COURSE_MOVED` → the course/module.
- LearnLink: uses `moduleId` when given.
- Verify page: shows "Completed <day>" from `completedAt`.

- [ ] **Step 1:** Tests (React Testing Library, existing fixtures extended with a module course): card has a link and a separate button with the right words, no `a button`/`button a` nesting (`container.querySelector('a button, button a')` null); "0 of 3 lessons" and "4 of 8 modules"; Done folds at 7 cards; course page lists modules with the three status words and New for your role; Continue goes to `resumeLessonId`; CertificateView shows name, course, completion day, code and an SVG with `aria-label` containing "QR code"; COURSE_MOVED navigates to the course with `moduleId`; a lesson opened under the wrong course id is redirected; Verify page shows the completion day.
- [ ] **Step 2:** Run `npx vitest run src/components/training src/pages/training` — FAIL.
- [ ] **Step 3:** Implement (dark mode tokens, RTL logical properties, 44 px coarse-pointer targets, `bdi` for titles).
- [ ] **Step 4:** Run the files + `npm run typecheck` + `npm run lint` — PASS.
- [ ] **Step 5:** Commit: "Learning Hub website: modules on the course page, Continue, card buttons and the certificate with its QR code (1.23.30)".

---

## Task 12: Website — Manage: row menu, Duplicate, Audience filter and the module editor

**Files:**
- Create: `components/training/manage/CourseRowMenu.tsx` (+ test), `components/training/manage/ModulesEditor.tsx` (+ test)
- Modify: `CoursesTab.tsx` (+ test), `LessonsEditor.tsx` (+ test: lesson's module select), `pages/training/CourseEditorPage.tsx` (+ test: notice, `?publish=1` opens the publish panel), `manage-queries.ts`, `api/training.ts` (methods below)

**Interfaces — api methods:** `addModule(courseId, input: ModuleInput)`, `updateModule(id, patch: Partial<ModuleInput>)`, `removeModule(id, moveTo: string | null)`, `reorderModules(courseId, moduleIds)`, `duplicateCourse(id)`, `courses({ …, audience })`; `updateLesson(id, { moduleId })`.
Behaviour:
- Courses tab: Audience filter (All / Staff / Clients); facts line adds `limitedTo` ("Admins only") and "8 modules"; notice line (warning tone) when `notice`; per-row ⋯ menu button (`aria-label="More for <title>"`, menu role, keyboard: arrows, Escape) with items: Edit; Preview as learner (`/training/courses/:id`); Assign (only PUBLISHED; opens AssignDialog with the course); Publish (never published) / Publish changes (`unpublishedChanges` → editor `?publish=1`) / Unpublish (PUBLISHED, confirm); Archive (not ARCHIVED, confirm); Delete (only `!everPublished && status === 'DRAFT'`, confirm); Duplicate (then go to the copy's editor).
- Editor: a "Modules" section above Lessons: list in order with title, visibility words, Off badge ("Off — the old course was removed" when offReason); Add module (title); per module: Rename, Move up/down, Who sees it (feature select = TRAINING module labels, groups checkboxes All staff / Administrators / Employees / People who run a project / Training managers, companies), Switch on/off, Remove (confirm dialog: "Move its lessons to:" select of other modules + "No module"; "Lessons are never deleted."). Each lesson row gets a "Module" select. A course with no modules shows only "Add module" and the plain lesson list as today.

- [ ] **Step 1:** Tests: menu items per status (Delete only for a never-published draft; Assign only published), Escape closes and focus returns to the button; Duplicate calls the API then navigates; Audience filter passes `audience`; ModulesEditor add/rename/reorder/visibility/switch/remove-with-move calls the API with the right bodies; the remove dialog lists the other modules and "No module"; lesson module select calls `updateLesson(id, { moduleId })`; the editor shows the notice.
- [ ] **Step 2:** Run `npx vitest run src/components/training/manage src/pages/training` — FAIL.
- [ ] **Step 3:** Implement (reuse `ManageDialog`, `ChoiceGroup`, `Notice`, existing menu patterns in the site for the ⋯ menu).
- [ ] **Step 4:** Run + typecheck + lint — PASS.
- [ ] **Step 5:** Commit: "Learning Hub Manage: a menu on every course, Duplicate, an Audience filter and the module editor (1.23.30)".

---

## Task 13: Website — Assign several people and the reports

**Files:**
- Modify: `components/training/manage/AssignDialog.tsx`, `targets.tsx`, `AssignmentsTab.tsx`, `ReportsTab.tsx`, `CertificatesTab.tsx` (completion day column), their tests; `api/training.ts` (`withdrawBatch(batchId)`, report `dates`)

Behaviour:
- Assign: target choice "People" (first) with a searchable checklist of people from `options().people` (name + email; staff and, for client courses, clients), ticked chips with remove buttons, "n people chosen"; preview and Assign send `targetKind: 'PEOPLE', userIds`. Single-target choices unchanged.
- Assigned tab: a grouped row "5 people" with a toggle listing members, each with Withdraw; the row's Withdraw withdraws all (confirm).
- Reports: tiles "People" (distinct) and "Completion" with its denominator words ("2 of 3 enrolments"); table column "Started themselves" next to "Assigned"; a "Dates by" switch (Got the course / Finished the course) sent as `dates`; quiz results as a compact table (Quiz · Course/Module · Attempts · People · Pass rate · Average · Questions) with no-attempt quizzes hidden behind "Show all quizzes"; when a module course is chosen: "By module" and "By person" tables (person rows link the certificate code to its PDF).
- Certificates tab: a "Completed" column (`completedAt`).

- [ ] **Step 1:** Tests for each behaviour above (API mocked via `test-api.ts`).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run + typecheck + lint — PASS.
- [ ] **Step 5:** Commit: "Learning Hub: assign several people from one window, and clearer reports (1.23.30)".

---

## Task 14: Conversion rehearsal on both engines

**Files (lane, untracked):** `.superpowers/lh1/lh1-rehearsal.mjs` (from `D:/mico-release/wt-lhs/.superpowers/lhs/lhs-rehearsal.mjs`), `.superpowers/lh1/base128/` (`git archive v1.23.28` compiled; until the tag exists, `integrate/1.23.27`), `.superpowers/lh1/rehearsal-{mysql,mariadb}/`.

- [ ] **Step 1:** Adapt the script: `--engine mysql|mariadb` (port 3306/3307; DB `mico360_t_lh1_reh_<engine>`), ports 5304/5305. On the base build (its own API): demo seed; employee nadia finishes Getting started + Tasks + half of Kanban (guide step 2), passes the Tasks quiz after one failed try; admin finishes Reports; project runner omar finishes Meetings; an admin edits Chat (lesson title) and assigns it to employees with a due day in 10 days; Projects assigned to everyone mandatory with due in 60 days; a "New staff only" rule for Calendar (7 days); an admin archives MICO AI; an admin-made course "Acme site safety" with a certificate, finished by sara (certificate issued); a client finishes the client guide.
- [ ] **Step 2:** Copy the DB, start the new build on the copy, wait for "Learning Hub" conversion log, then check (each a numbered check line, total printed): the combined course exists once, published, 10 modules (MICO AI module Off — removed); nadia's Getting started + Tasks modules Done with their old days, Kanban In progress at step 2, quiz attempts (2) listed in reports; her lesson ids unchanged; admin's Reports module Done; omar's Meetings Done; Chat short course still published with its edit, a notice in Manage, its assignment moved (due ≥ change+30), its old assignment withdrawn; Projects assignment kept 60-day day; rule now names the combined course with 30 days; zero new emails in the outbox and zero TRAINING push/email jobs; one bell row per enrolled staff member; sara's "Acme site safety" certificate still verifies (`/training/verify/<code>` VALID); the client has a client-guide certificate with a QR in its PDF; nobody completed the combined course unless all their visible modules were done; a second start changes nothing (counts + stamps compared); old short-course and lesson links answer COURSE_MOVED.
- [ ] **Step 3:** Run on MySQL and on MariaDB; both print "REHEARSAL OK"; dumps saved; ledger lines added.

---

## Task 15: Learning Hub e2e (extend the 78-check script) and screenshots

**Files (lane):** `.superpowers/lh1/lh1-e2e.mjs` (from `wt-lhs/.superpowers/lhs/lhs-e2e.mjs`), `run-e2e.sh` (port 5301, DB `mico360_t_lh1_e2e`), screenshots in `.superpowers/lh1/after/`.

- [ ] **Step 1:** Update the 78 checks for the one course (My learning shows MICO360 Tasks User Training; module chips; the client guide in the portal) and add: employee sees 8 modules, admin 10, project runner 8, Training manager 8, client none (only the client guide); resume mid-module (leave at step 2, Continue reopens step 2); finish every module → "Course completed" → certificate on the course page with a QR (SVG) → PDF downloads; decoding the QR target is `/verify/<code>` and that page says Valid with the completion day; Manage ⋯ menu (keyboard), Duplicate makes "Copy of …" draft; module editor add/rename/switch off/remove with move; assign three people → one "3 people" row; reports "Dates by" switch and "Started themselves" column; each at 1440×900 and 375×812, light + dark, and one RTL pass (`dir=rtl`) of the course page and certificate.
- [ ] **Step 2:** Build lane dists (`npx tsc -p tsconfig.json --outDir dist-lh1`, release.json; `npx vite build --outDir dist-lh1`), run `bash run-e2e.sh` — all checks pass; screenshots reviewed by eye (Read tool) for overlap, contrast, truncation.

---

## Task 16: CHANGELOG, merges, gate, review, battery, el-check, clean-up

- [ ] **Step 1:** CHANGELOG `## [Unreleased]` → Improvements, plain words (exact first three lines from the brief; one line each: card buttons; reports fixes (people counted once, Started themselves, Dates by); Duplicate course; assigning several people; editable modules).
- [ ] **Step 2:** Merge tags v1.23.27, v1.23.28, v1.23.29 as they exist (`git tag -l "v1.23.*"`), keeping both sides (batch 4b quiz-delete warning dialog kept; menu moves → re-check the content labels in Getting started and Admin settings against `Sidebar.tsx`/`ProfileMenu.tsx`; fix and re-run Task 9 tests if they differ). `npx prisma generate` after each merge.
- [ ] **Step 3:** Suites (one at a time): backend `npx vitest run`, `npx tsc -p tsconfig.json --noEmit`, `npm run lint`; DB suite on fresh `mico360_t_lh1_tdb` (MySQL) and `mico360_t_lh1_tdbm` (MariaDB); website `npx vitest run`, `npm run typecheck`, `npm run lint`; Extension `npm test` + lint; Android App (`npm ci` there if no node_modules) `npx tsc --noEmit`, `npm test`, lint.
- [ ] **Step 4:** One fresh reviewer (most capable model) on `git diff e7219ed1..HEAD` with the design, this plan and the ledger; focus: no lost progress/certificates in the conversion; module visibility never above feature access; completion with hidden modules and unlinked videos; certificates + QR + verify; the module editor. Fix Critical/Important test-first; ledger the minors.
- [ ] **Step 5:** Re-run Task 14 (both engines) and Task 15 on the final code.
- [ ] **Step 6:** Gate builds (`build-gate.sh`: backend `dist-gate` + release.json, website `dist-gate` with the extension zip in `downloads/`); wait for no `BATTERY.lock`/`RECORDING.lock`, write `BATTERY.lock` = "lh1" (06:30–21:30 Muscat only); `node <t1181>/run-all.mjs <backend dist-gate> <web dist-gate> --parallel 3` (Friday/Saturday: 4 known daily-emails failures); el-browser-check (`el-check.sh`); delete the lock.
- [ ] **Step 7:** Stop servers; drop `mico360_t_lh1_*` on both engines (named, never `--drop-all`); delete `dist-lh1`/`dist-gate` folders not needed; ledger final lines. No release, tag or push.
