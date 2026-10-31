import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The project form's Tasks switches and a new project's team (Stage 2 Task 11), checked by source text. */

it('three switches, and the team only when creating', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s.match(/<Toggle/g)?.length).toBeGreaterThanOrEqual(3);
  expect(s).toMatch(/!editing \? \(?\s*<AssigneeField[^>]*label=\{TEAM_TEXT\.label\}/);
});

it('each switch has its label and hint, under the "Tasks" heading', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s).toContain('PROJECT_TASK_TEXT.legend');
  for (const k of ['carryForward', 'defaultDueToday', 'newTasksNeedApproval']) {
    expect(s, k).toMatch(new RegExp(`on=\\{draft\\.${k}\\}[^]*?label=\\{PROJECT_TASK_TEXT\\.${k}\\.label\\}`));
    expect(s, k).toContain(`PROJECT_TASK_TEXT.${k}.hint`);
  }
});

it('the team: everyone active (an employee not themself), the website’s words, the role’s note', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s).toMatch(/teamPool\(activePeople\(dirQ\.data\), \{ id: user\?\.id \?\? '', isAdmin \}\)/);
  for (const m of ['addLabel={TEAM_TEXT.add}', 'emptyText={TEAM_TEXT.none}', 'allChosenText={TEAM_TEXT.all}', 'note={isAdmin ? TEAM_TEXT.adminNote : TEAM_TEXT.otherNote}']) expect(s, m).toContain(m);
  const field = src('components/task-form/AssigneeField.tsx');
  for (const m of ["label = 'Assignees (optional)'", "addLabel = 'Add people'", "emptyText = 'No one is on this project yet'", "allChosenText = 'Everyone on this project is assigned.'"]) expect(field, m).toContain(m);
});

// Stage 2 fix pass B3: the form starts a new project with its creator as owner (both roles), and offers
// "No owner" to an administrator or on an edit only.
it('B3: a new project is owned by its creator; "No owner" only for an administrator or an edit', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s).toMatch(/useState<ProjectDraft>\(\(\) => draftOf\(project, user\?\.id \?\? ''\)\)/g);
  expect(s.match(/draftOf\(project, user\?\.id \?\? ''\)/g)).toHaveLength(2);
  expect(s).toMatch(/ownerOptions\(dirQ\.data \?\? \[\], draft\.ownerId, \{ allowNone: isAdmin \|\| editing \}\)/);
});

// Stage 2 fix pass B8: while the directory loads, or when it couldn't load, the team field says so —
// not "There’s no one else to add yet".
it('B8: the team field says when its people are loading or couldn’t load', () => {
  const s = src('screens/ProjectFormScreen.tsx');
  expect(s).toMatch(/<AssigneeField[^]*?status=\{teamStatus\}/);
  expect(s).toMatch(/const teamStatus = dirQ\.isLoading \? 'loading' : dirQ\.isError && !dirQ\.data \? 'failed' : null;/);
  expect(s).toMatch(/failedText=\{TEAM_TEXT\.failed\}/);
  const field = src('components/task-form/AssigneeField.tsx');
  expect(field).toMatch(/failedText = 'Couldn’t load the project’s people — you can still create the task, and assign people from it later\.'/);
  expect(field).toMatch(/\{status === 'failed' \? <Text style=\{\[styles\.note, \{ color: c\.ink2 \}\]\}>\{failedText\}<\/Text> : null\}/);
});
