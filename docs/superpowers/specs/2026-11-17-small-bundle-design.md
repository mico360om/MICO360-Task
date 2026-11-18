# 1.23.37: one New task button, AI detail level, better Columns section (short design)

17 Nov 2026. Website, plus one small optional server parameter. Owner requests (screenshots), scheduled "one after another".

## 1. One "New task" button (owner: "duplicate New task buttons — keep the top header one")
- **Remove** the page's own "+ New task" on:
  - the Kanban board (`components/board/Board.tsx` ~644): the top bar's New task already starts in the board's project (BoardPage);
  - a project's **Tasks** tab (`project-dashboard/TasksTab.tsx` ~210): the top bar already defaults to the current project.
- **Keep:**
  - a column's own "+", which adds into that column;
  - empty-state "add" links;
  - Manage columns.
- **The keyboard shortcut N** keeps opening New task through the top bar, with the same project.
- **Calendar (my call):** its button starts the task on the day you picked, so it stays but is renamed **"Add on 16 Nov"** (the selected day). It is no longer a second "New task".
- Update tests, battery checks and Learning Hub lesson text that mention the board's own New task button. Check starter-courses and the Kanban lesson; a content revision is needed only if the text changes.

## 2. AI "Describe it in plain English": detail level
- What exists: the assistant suggests title, description, due date, repeat, priority and project. Each suggestion has a tick-box and "Use selected details" applies only the ticked ones. That stays exactly as it is.
- **New: a three-way choice above "Fill task details": Short · Default · Detailed.** Default is preselected every time the form opens.
  - **Short:** a title of 3–6 words and a one-sentence description.
  - **Default:** today's behaviour.
  - **Detailed:** a fuller description with a short "what to do" list (3–6 points) and any details from the sentence.
  - In all three, due date, repeat, priority and project are suggested the same way.
- **Changing the level after a result:** press "Fill task details" again to get new suggestions. Nothing is applied until you tick and press "Use selected details".
- **Server:** the describe request gains an optional `detail: 'short' | 'default' | 'detailed'`; missing means default. The Android app and extension don't send it, so they're unaffected. The prompt changes only the title and description length guidance. JSON mode and limits stay.

## 3. Board "Manage columns": a better Columns section
Problems: on wide screens each row stretches to about 1,900 px, with a giant name box and the controls far away at the right edge. There is no task count, and a new column's status can only be set after adding it.
- **Compact table** with a maximum width of about 960 px and aligned columns: ⠿ drag · colour dot (follows its status, as today) · **Name** (inline edit, up to about 28 rem) · **Status** (select) · **Tasks** (count) · **Visible** (switch) · ↑ ↓ · Delete.
- **Header row** with the same labels; small grey hints under the header:
  - "Colours follow the status";
  - "Hidden columns keep their tasks".
- **Delete:** disabled with a reason when the column has tasks ("Move its 3 tasks first"), and when it's the last column of its status if the rules need one (today's rules are kept).
- **Add a column:** name and **status chosen at once**, then **Add column**.
- **Phone:** each column becomes a small card (name and status on top; switch, arrows and delete below), all 44 px targets.
- Same look for the template editor's columns (`templates/ProjectTemplateEditor.tsx`) if it shares the component; otherwise leave it as is.

## Constraints and proof
- No migration. No new packages. Never real client names. Android app and extension unchanged.
- **Test-first:**
  - board and project Tasks tab without their own button, the header button and N still working;
  - Calendar "Add on <day>";
  - AI detail level sent and honoured (server prompt tests for each level), with Default preselected;
  - Columns: widths at 1440 and 1920, task counts, delete guard, add with status, phone cards; axe; 44 px.
- **Then:** suites, one fresh reviewer, the battery groups for board, tasks and calendar, el-check.
