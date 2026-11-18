# User Training lesson pages: layout and polish (short design)

14 Nov 2026. The owner sent screenshots of live 1.23.33 lesson pages (video, step-by-step guide, quiz result) and asked: "Analyze and improve the User Training pages". He chose **"Lesson + module outline"**.

## Problems found
1. On a computer the lesson sits in a ~770 px column, and the right half of the screen is empty on every lesson page.
2. There's no "where am I": you can't see the module's lessons while in a lesson; there's only an "All modules" link back.
3. Two unlabelled red progress bars stack up on guide lessons: the module bar under the header and the step bar in the card.
4. Video page:
   - "Watched 4% — the lesson is done at 90%." is technical.
   - The video could be bigger.
   - The bottom bar is a large near-empty card with just "Next lesson".
5. "Next lesson" doesn't say what comes next.
6. Quiz pages:
   - The start page is one line and a button.
   - The result page still shows the previous lesson's "“Find your way around” done." message.
   - The score ring has a small black mark at its start.
   - The answer review is very long.
7. Small things:
   - Some guide steps have no picture (e.g. "The Learning Hub").
   - Titles repeat their kind ("Video: Getting started" with "Video · 2 min" under it).

## Design (owner chose the layout; the rest are my calls)
1. **Desktop, 1024 px and wider: two columns.**
   - **Left:** the lesson, up to about 880 px wide. A video uses the full width at 16:9; text lines stay readable.
   - **Right (about 300 px):** an **"In this module"** panel that stays in view while scrolling.
2. **The "In this module" panel:**
   - The module name with its icon, and "1 of 3 done" with a small bar.
   - The module's lessons, each with:
     - its kind icon, title and minutes;
     - its state: done (tick), current (highlighted, brand edge), or not started.
   - Locked lessons, in in-order courses only, show a lock and can't be opened, as today. Every other lesson is a link, so people can jump freely (D4).
   - A main button **"Next: <lesson title>"**. On a module's last lesson, once done, it becomes **"Next module: <name>"**; after the course's last lesson, **"Back to the course"**.
   - An **"All modules"** link.
   - For a course without modules, the panel lists the course's lessons ("In this course").
3. **Phone and tablet, under 1024 px:**
   - Under the header, a **"Lessons in this module · 2 of 3"** button opens the same list as a sheet.
   - A bottom bar that stays in view holds **Back** and **"Next: <title>"**, in the site's sticky-footer style, with 44 px targets.
4. **Header:**
   - Breadcrumb.
   - The lesson title.
   - **One** line: kind icon · "Module 1 · Getting started — Lesson 1 of 3" · minutes. The separate "Video · 2 min" line goes, so the kind isn't repeated.
   - **One** module progress bar, labelled for screen readers.
5. **Video lessons:**
   - The player at full lesson width.
   - Under it, plain words: **"Watch to the end to finish this lesson"** with a slim bar. When done: **"✓ Done"**. The 90% rule itself is unchanged.
   - "Open the video on YouTube" stays.
   - The near-empty footer card goes; navigation is the panel or bottom bar.
6. **Step-by-step guides:**
   - The step card shows "Step 2 of 5" with **clickable step dots** instead of a second red bar.
   - Back/Next move between steps inside the card. On the last step, the main button is "Next: <lesson>".
   - Missing pictures are added where a real screen exists (e.g. "The Learning Hub" step shows My learning). This is a content update for unedited built-in courses only, as before; progress and lesson ids stay the same.
7. **Quizzes:**
   - **Start page:** an intro card showing the number of questions, pass mark, "try as often as you like", minutes, and "This quiz covers:" with the module's lesson titles, then **Start quiz**.
   - **Result page:**
     - no message left over from another lesson;
     - the score ring fixed (no stray mark);
     - "4 of 4 right · pass mark 70%";
     - **review:** wrong answers first and open; right answers folded under "Show the N you got right" (open them all with one click). Explanations ("Why") stay.
8. **The same layout** for the client guide's lessons in the Client portal.
9. **No change** to completion rules, the 90% video rule, quiz rules, order and locking, permissions, reports, certificates or lesson ids.

## Constraints
- Website only, plus a content-version bump for pictures and words if needed. No migration. No new packages.
- Keep the 1.23.32 look: brand tokens, light and dark, RTL, 44 px touch targets, keyboard, axe clean.
- **The panel that stays in view:** first check how the page frame scrolls. If `position: sticky` works within the page's scroll container, use it. If it truly can't work without changing the whole site's frame, the panel sits at the top of the right column without sticking (lessons are short); record that as a ruling.
- Hidden modules and lessons never appear in the panel or count.

## Proof
- Test-first unit tests:
  - panel states: done, current, locked, hidden;
  - the Next label for mid-module, last-in-module and last-in-course;
  - a course without modules;
  - the quiz review order;
  - the stale message cleared on lesson change.
- Learning Hub e2e extended: at 1440, 1024, 768 and 375, light and dark, RTL at 375, for employee and client portal:
  - jump via the panel;
  - "Next: …" goes to the right lesson;
  - the phone sheet and bottom bar;
  - the quiz start and result pages.
- Screenshots before and after for the owner.
- Suites, a fresh reviewer, the Learning Hub and portal battery groups, el-check.
- Ships as **1.23.36**, after 1.23.34 (Up next + Edit button) and 1.23.35 (certificate). It merges whichever of those is tagged first.
