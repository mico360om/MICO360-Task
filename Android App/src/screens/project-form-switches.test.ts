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
