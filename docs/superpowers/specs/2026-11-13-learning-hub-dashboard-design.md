# Learning Hub: new look (learning dashboard) — short design

13 Nov 2026, MICO360 Tasks website, folded into **1.23.32** (the one-course Learning Hub, branch `feat/lh-one-course` in `D:/mico-release/wt-lh1`).

## Why
The owner sent a screenshot of the live My learning page and asked to "Improve the Learning Hub design". 1.23.32 has the same problems as that screenshot:
- My learning is one full-width card with a thin progress bar, then mostly empty space.
- You can't see the modules, what's left, or the certificate without opening the course.
- The course page is a narrow column, with the right half empty at 1440 px.
- The subtitle still says "Short courses on the parts of the site you use."
- The cards are plain: no icons, no visual cue of where you are.

**Goal:** someone opening the Learning Hub sees at a glance where they are, what's next, what's left, and their certificate, and is one click from continuing.

**Anti-goals:**
- It must not change who sees which module.
- It must not change completion rules, certificates, the conversion or the reports.
- No new packages. No slower page.

## Owner decisions (13 Nov, one by one)
- **L1, direction: Learning dashboard.** My learning becomes an overview with progress, Continue, every module as a tile, and the certificate, all on one screen.
- **L2, scope: all staff learning pages.**
  - Covered: My learning, the course page, lessons and quizzes, All courses, and the on-screen certificate.
  - The client portal's guide gets the same look.
  - Manage and Reports (admin) keep their 1.23.32 layout and only take the shared module icons and colours.
- **L3, timing: inside 1.23.32.** The idle 1.23.32 builder adds it before the release. 1.23.32 moves about a day later.

## Approaches
- **Chosen: rework the existing learner components in place, with a few shared pieces.** The pieces are a progress ring, module tile, module icon and certificate card. All the data is already there: the course detail has modules, statuses, the next lesson and the certificate.
- **Rejected: a separate new dashboard page beside today's.** That means two versions to keep in step, and old links to manage.
- **Rejected: a UI or chart library for the ring and tiles.** It breaks the no-new-packages rule; an SVG ring is a few lines.

## What it looks like

### 1. My learning (desktop, 1024 px and wider: two columns, main about 2/3 and side about 1/3)
```
WORKSPACE / Learning Hub   Your training, one part at a time
[My learning] [All courses] [Manage] [Reports]

+--------------------------------------+  +------------------+
| UP NEXT · Module 2 of 8              |  |   ( 1 / 8 )      |
| [icon] Tasks                         |  |  modules done    |
| Next: Work on a task · Guide · 5 min |  |  About 1 h left  |
| [Mandatory] [Due 16 Nov]             |  |  Due 16 Nov      |
| [ Continue ]                         |  +------------------+
+--------------------------------------+  +------------------+
Your modules                              | CERTIFICATE      |
+--------+ +--------+ +--------+ +------+ | Finish 7 more    |
|1 [ico] | |2 [ico] | |3 [ico] | |4     | | modules to get it|
|Getting | |Tasks   | |Kanban  | |Proj. | +------------------+
|started | |1 of 3  | |Not     | |      | +------------------+
|Done    | |[==-- ] | |started | |      | | OTHER COURSES    |
|13 Nov  | |        | |12 min  | |      | | Acme induction   |
+--------+ +--------+ +--------+ +------+ |  0 of 1 [Start]  |
(… modules 5–8 …)                         +------------------+
Done (n) — folds after 6, as built
```
- **Header subtitle:** "Your training, one part at a time." This is my wording. The client portal keeps its own.
- **Up next card:**
  - "UP NEXT · Module 2 of 8".
  - The module's icon and name.
  - The next lesson with its kind and minutes.
  - The Mandatory and Due chips. Overdue shows in red, using the existing overdue colour.
  - One main button: **Start** when nothing is done, **Continue** when partly done, **Review** when the course is finished.
  - It opens exactly where 1.23.32 resumes today.
- **Progress card (side):**
  - A ring showing "1 / 8", with "modules done" under it.
  - "About N min left": the visible, unfinished minutes.
  - The due date.
  - Counts follow 1.23.32's rules: hidden modules, switched-off modules and unlinked videos never count.
- **Your modules (grid):**
  - 4 per row at 1280 px and wider, 3 at 1024, 2 at 768. On phones it becomes a stacked list.
  - Each tile shows: number, icon, name, and its state. The states are Done with date (green tick), In progress "1 of 3 lessons" with a mini bar, Not started with minutes, and the "New for your role" chip.
  - The whole tile is one link to that module on the course page. There are no buttons inside it, so no nested controls.
  - Jumping is free (D4), so there are no locks.
- **Certificate card (side):**
  - Before finishing: "Finish N more modules to get it", with a faint certificate outline.
  - After finishing: "Certificate ready" with the code, View and Download PDF.
  - When "New for your role" modules appear: "Finish the new modules for an updated certificate".
- **Other courses (side):** other enrolled or assigned courses, such as a company induction, as compact rows with Start, Continue or Review and their due date.
- **Done list:** as built, folding after 6.
- **States:**
  - No training at all: today's empty state.
  - Everything done: the Up next card becomes "All done, well done", with Review and the certificate. The grid stays, all ticked.
- **Phone (375 px):** Up next, then progress (ring inline on the left, text on the right), then modules as a list, then certificate, then other courses.

### 2. Course page
- **Desktop (1024 px and wider):** two columns.
  - Left: the module accordion as built, with each module row getting its icon.
  - Right: a sticky panel with the progress ring, Due, the main Start/Continue/Review button, the certificate card, and "Questions" (moved here).
- **Phone:** a compact progress row and button above the list.
- The course header shows the module count and "Certificate when you finish", as today, on one line.

### 3. Lessons and quizzes
- A header line: "Module 2 · Tasks — Lesson 2 of 3", with a thin bar for module progress and a link back to the course.
- Step progress stays as built.
- Previous and Next sit in one consistent footer bar on every lesson kind.
- The quiz result shows a small ring with the score and pass mark, then the existing actions.

### 4. All courses
- Cards get a coloured top band and the course icon; the one course uses the brand mark.
- Progress shows as "1 of 8 modules" with a mini bar, with one button (Start/Continue/Review).
- Search stays as built. Cards have equal heights.

### 5. On-screen certificate
- A framed certificate look: brand border, logo, the learner's name large, the course, completion date, code, and the QR code.
- It is laid out like the PDF. **The PDF itself is unchanged** (built and tested in 1.23.32).

### 6. Client portal guide
- The same pieces: Up next, progress and certificate. Only the client guide's modules show, with the portal's own words.

### 7. Manage and Reports
- No layout change. Module rows and filters use the same module icons.

## Calls I made (the owner can correct any)
- **Module icons:** the same icon as that feature's left-menu item, with Getting started using the brand mark and Admin settings the settings icon.
  - Extract the menu's inline SVGs into a shared `ModuleIcon` / feature-icon file rather than copying them.
  - A module an admin adds gets a neutral book icon.
- **Colours:** existing tokens only. Brand red for the current module and main buttons, the existing Done green, the existing overdue red, neutral for not started. Light and dark.
- **The ring** is an inline SVG (`stroke-dasharray`), labelled for screen readers as "1 of 8 modules done".
- **Which course fills the dashboard:** the Up next course, by today's rule. If it has modules, the grid shows them. A course without modules shows its lessons as tiles, as one "Other lessons" unit per 1.23.32's ruling. Other courses go in the side list.
- **"About N min left":** the sum of visible, unfinished lesson minutes, rounded: "About 1 h 10 min left", or "Under 5 min left".

## Constraints
- Website only, apart from one additive server field if the dashboard truly lacks data. Prefer the existing course-detail query; no extra request per tile.
- No new packages. No change to visibility, completion, certificates, conversion, reports, permissions or the API's existing fields.
- Android app and extension unchanged (owner rule).
- Keep 1.23.32's accessibility: 44 px touch targets, keyboard, axe clean, RTL pass, light and dark, and phone layout with no sideways scroll.
- Demo data and names: Contoso/Fabrikam/Northwind; code examples use Acme. Never real client names.

## Proof
- Unit tests first for: ProgressRing (label, 0, partial, full), ModuleTile (each state, single link), CertificateCard (before, ready, updated), the Start/Continue/Review choice, "About N min left", and the hidden-module rule (hidden modules never appear as tiles or count).
- Extend the 281-check Learning Hub e2e. Screenshots at 1440, 1024, 768 and 375, light and dark, plus RTL at 375. Cover the employee, admin, project runner, training manager and client portal.
- Then the lane's remaining gate: merge v1.23.31, suites on both databases, conversion rehearsal, battery, el-check, and one fresh reviewer over the new-look commits.
