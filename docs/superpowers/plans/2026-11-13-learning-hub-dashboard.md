# Learning Hub new look (learning dashboard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Learning Hub's learner pages (My learning, course page, lessons/quizzes, All courses, on-screen certificate, client portal guide) into a learning dashboard: progress, Continue, every module as a tile and the certificate on one screen; Manage and Reports only take the module icons.

**Architecture:** Website only. A few shared, pure-presentational pieces (`ModuleIcon`, `ProgressRing`, `ModuleTile`, `CertificatePanel`, time-left and action helpers) built from data the website already reads (`useMyTraining`, `useCourse`); the existing learner components are reworked in place. No server change, no new package.

**Tech Stack:** React + TanStack Query + Tailwind (existing tokens), vitest + Testing Library; Playwright e2e in `.superpowers/lh1/lh1-e2e.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-13-learning-hub-dashboard-design.md` (owner L1–L3 + the coordinator's calls). It sits on top of `docs/superpowers/specs/2026-11-13-learning-hub-one-course-design.md`.

## Global Constraints
- No change to visibility, completion, certificates, the conversion, reports, permissions or the API's existing fields; hidden or switched-off modules never appear as tiles and never count (the server already leaves them out of `CourseDetail.modules`/`lessons` — never add anything that reads other data).
- No new packages; website only (`Web Portal/frontend`); nothing under `Android App/` or `Extension/`; `Sidebar.tsx` keeps its `I` icon object with the same keys and order (the Android drift test `Android App/src/lib/icons.test.ts` loads it from there).
- Existing tokens only (brand red for the current module and main buttons, the existing Done green, the existing overdue red, neutral for not started); light + dark; RTL via logical properties; 44 px targets on coarse pointers (`TOUCH_MIN`); keyboard; axe clean; no sideways scroll at 375 px; no nested interactive elements (a tile is ONE link).
- Words: "Your training, one part at a time." (staff subtitle; the portal keeps its own); "UP NEXT · Module 2 of 8"; "About 1 h 10 min left" / "Under 5 min left"; "Finish N more modules to get it"; "Certificate ready"; "Finish the new modules for an updated certificate"; "All done, well done"; one main button Start (nothing done) / Continue (part done) / Review (finished). Dates "16 Nov" / "16 Nov 2026".
- The PDF certificate is unchanged.
- Commits: subjects end "(1.23.32)", body `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, explicit paths, never `git stash`.

## Review Focus
1. A person who sees only some modules (employee vs admin): tiles, "N of M", ring and "minutes left" must count only their modules — test with fixtures where an admin-only module is absent from the employee's `CourseDetail`.
2. A plain course (no modules) and a course with only "Other lessons" as Up next: the grid shows one "Other lessons" unit / its lessons sensibly, never an empty grid.
3. Everything finished, and finished-then-"New for your role": the Up next card, certificate card and tiles say the right thing.
4. Phone 375 px, RTL and dark: no sideways scroll, ring and tiles readable, 44 px targets.
5. The client portal: same pieces, portal words, no staff links (no Manage/Reports, no "Check it online" link where the portal hides it today).

## Rulings settled here (ledger: .superpowers/lh1/progress.md)
- Icons: `Sidebar.tsx` keeps `I` (Android drift test); it exports it (`export const NAV_ICONS = I` style, same object) and the new `components/training/ModuleIcon.tsx` maps a module key to it: tasks→tasks, board→board, projects→projects, calendar→calendar, meetings→meetings, chat→chat, mico-ai→ai, reports→reports, management→management, admin→settings, training→the Learning Hub icon, general/Getting started→the brand mark (`components/ui/BrandLogo` mark, or the Learning Hub icon if the mark can't render at 20 px), portal→clients, anything else/admin-added module with no feature→a neutral book (`BookIcon` in training-ui.tsx).
- The dashboard reads the Up next course's detail with the existing `useCourse(id)` (one request, cached, the same the course page uses) — no new endpoint, no request per tile.
- "Minutes left" = sum of `minutes` of the course's visible lessons not done (`CourseDetail.lessons`), shown as "About 1 h 10 min left" (rounded to 5 min), "Under 5 min left" below 5, nothing when 0.
- "Module N of M" in Up next = the position (1-based) of the module that `resumeLessonId` belongs to among the person's modules.

---

### Task D1: Shared pieces and the My learning dashboard
**Files:** create `components/training/ModuleIcon.tsx`, `ProgressRing.tsx`, `ModuleTile.tsx`, `CertificatePanel.tsx`, `dashboard-rules.ts` (+ a test file each); modify `components/Sidebar.tsx` (export only), `components/training/TrainingLists.tsx` (MyLearningSections → dashboard), `pages/training/MyTrainingPage.tsx` (subtitle), `components/training/training-fixtures.tsx`.
**Interfaces (produces):**
```ts
export function ModuleIcon(p: { moduleKey: string | null; size?: number; className?: string }): JSX.Element; // aria-hidden svg
export function ProgressRing(p: { done: number; total: number; size?: number; label: string }): JSX.Element; // role="img" aria-label=label; shows "done / total"
export function ModuleTile(p: { module: ModuleOutline; index: number; moduleKey: string | null; to: string }): JSX.Element; // ONE <a>
export function CertificatePanel(p: { course: CourseDetail; onView?: () => void }): JSX.Element; // before / ready / updated states
export function minutesLeftText(lessons: readonly { minutes: number; done: boolean }[]): string | null;
export function mainAction(mine: MyCourseState): 'start' | 'continue' | 'review';
export function upNextModule(course: CourseDetail): { index: number; total: number; module: ModuleOutline } | null;
```
- [ ] Tests first (each piece; the hidden-module rule with employee/admin fixtures; plain course; all done; new for role); run, see them fail.
- [ ] Build the pieces and the two-column dashboard (≥1024 px: main ~2/3 + side ~1/3; 4 tiles per row ≥1280, 3 at 1024, 2 at 768, a stacked list on phones; phone order: Up next, progress, modules, certificate, other courses); "Other courses" side list; Done list folds after 6 as built; empty state as built; subtitle.
- [ ] `npx vitest run src/components/training src/pages/training`, typecheck, eslint; commit.

### Task D2: Course page, lessons and quizzes
**Files:** `CourseView.tsx`, `ModuleList.tsx`, `LessonPlayer.tsx`, `GuideLesson.tsx`, `VideoLesson.tsx`, `DocumentLesson.tsx`, `QuizLesson.tsx` (+ tests).
- [ ] Tests first: course page two columns at ≥1024 (left: module accordion with icons; right: sticky panel with ring, Due, main button, `CertificatePanel`, Questions moved there); phone: compact progress row + button above the list; header line with module count and "Certificate when you finish"; lesson header "Module 2 · Tasks — Lesson 2 of 3" with a thin module bar and a link back; one consistent Previous/Next footer bar for every lesson kind; quiz result small ring with score and pass mark, existing actions kept.
- [ ] Build; run tests/typecheck/eslint; commit.

### Task D3: All courses, the framed certificate, the portal guide, Manage/Reports icons
**Files:** `training-ui.tsx` (CourseCardView), `TrainingLists.tsx` (CourseGrid only), `CertificateView.tsx`, portal Learning Hub pages under `pages/portal/` and `components/portal/` that render the guide, `manage/CoursesTab.tsx`, `manage/ModulesEditor.tsx`, `manage/ReportsTab.tsx` (+ tests).
- [ ] Tests first: cards with a coloured top band and the course icon (the one course uses the brand mark), "1 of 8 modules" + mini bar, one button, equal heights; framed certificate (brand border, logo, name large, course, completion date, code, QR) — PDF untouched; the portal guide uses Up next / progress / certificate pieces with portal words and no staff links; module rows/filters in Manage and Reports show `ModuleIcon`.
- [ ] Build; run tests/typecheck/eslint; commit.

### Task D4: e2e, screenshots, CHANGELOG
- [ ] Extend `.superpowers/lh1/lh1-e2e.mjs`: the new look for employee, admin, project runner, Training manager and the client portal; screenshots at 1440, 1024, 768 and 375, light and dark, RTL at 375, in `.superpowers/lh1/after-look/`; axe clean (axe-core from `D:/mico-release/audit-tools` if present); every interactive element ≥44 px on coarse pointers; `document.documentElement.scrollWidth <= innerWidth` at every size; hidden modules never as tiles. Run on a fresh build; look at every screenshot.
- [ ] CHANGELOG [Unreleased] Improvements: "The Learning Hub has a new look: your progress, every module and your certificate on one screen."

### Task D5: Review
- [ ] One fresh reviewer (opus) over the new-look commits; fix Critical/Important test-first; re-run D4.
