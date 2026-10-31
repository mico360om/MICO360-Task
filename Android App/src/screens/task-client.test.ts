import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { tasksTabRowLabel } from '../lib/project-dashboard';
import type { ApiTask } from '../lib/types';

/** Show a task to the client, and the eye mark (Stage 4 Task 18; the board's mark is Stage 2's). */
const HINT = 'its title, status and due date appear on the project’s client page. Never people, comments, files or the description.';

it('the eye is a drawn icon with its words, on cards and project task rows', () => {
  for (const f of ['components/board/BoardCard.tsx', 'components/project/TasksTab.tsx']) expect(src(f), f).toMatch(/<Icon name="misc\.eye"[^>]*label="Visible to client"/);
});

it('a project task row tells TalkBack it is shown to the client', () => {
  const t = { id: 't1', key: 'RIG-1', title: 'Check pumps', priority: 'NORMAL', progress: 0, clientVisible: true, assignees: [] } as unknown as ApiTask;
  expect(tasksTabRowLabel(t, { statusName: 'To do', phase: 'pending', dueText: null })).toContain('visible to client');
  expect(tasksTabRowLabel({ ...t, clientVisible: false }, { statusName: 'To do', phase: 'pending', dueText: null })).not.toContain('client');
});

it('the people who run the project switch it, with the website’s words', () => {
  expect(src('screens/TaskDetailScreen.tsx')).toMatch(/<TaskClientCard[^>]*canChange=\{canDeleteTask\(user, project, members\)\}/);
  const card = src('components/client-share/TaskClientCard.tsx');
  expect(card).toContain(HINT);
  expect(card).toMatch(/<Toggle[^>]*label="Show to client"/);
  expect(card).toContain('Client view');
  // No preview for a task (the website has none): the switch changes it at once.
  expect(card).not.toMatch(/ClientPreviewSheet/);
});

it('the answer is laid over the task shown, and the lists holding it are read again', () => {
  const q = src('core/client-share-queries.ts');
  expect(q).toMatch(/useTaskClientVisible[^]*setTaskVisible\(taskId, visible\)/);
  expect(q).toMatch(/setQueryData<ApiTask>\(\['task', taskId\][^]*clientVisible: answer\.clientVisible \?\? visible/);
  expect(q).toMatch(/listsHolding: taskId/);
});

describe.skipIf(!hasWeb('frontend/src/components/TaskDrawer.tsx'))('the website’s', () => {
  it('uses the same hint', () => expect(readWeb('frontend/src/components/TaskDrawer.tsx')).toContain(HINT));
});
