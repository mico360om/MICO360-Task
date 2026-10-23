import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoveTaskDialog, type MoveTaskDialogProps } from './MoveTaskDialog';
import type { TaskMovePreview } from '../api/tasks';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const project = (id: string, code: string, name: string) => ({ id, code, name, status: 'ACTIVE', color: '#123456', icon: null, imageUrl: null });
const TARGETS = { managesAll: false, managedProjectIds: ['rig', 'ops'], projects: [project('rig', 'RIG', 'Rig Inspection'), project('ops', 'OPS', 'Operations')] };
const COLUMNS = [
  { id: 'o-backlog', name: 'Backlog', category: 'BACKLOG', position: 0, enabled: true },
  { id: 'o-todo', name: 'Next', category: 'TODO', position: 1, enabled: true },
  { id: 'o-doing', name: 'Doing', category: 'IN_PROGRESS', position: 2, enabled: true },
  { id: 'o-done', name: 'Finished', category: 'DONE', position: 3, enabled: true },
];
const SARA = { id: 'sara', name: 'Sara Al Balushi' };
const previewTask = (over: Partial<TaskMovePreview> = {}): TaskMovePreview => ({
  id: 't4', key: 'RIG-4', title: 'Inspect the rig', from: { id: 'rig', code: 'RIG', name: 'Rig Inspection' }, canMove: true, reason: null, newKey: 'OPS-17',
  currentCategory: 'IN_PROGRESS', completed: false, columnId: 'o-doing', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [], ...over,
});

let calls: { method: string; url: string; body: unknown }[] = [];
let previewTasks: TaskMovePreview[] = [];
let moveReply: () => Response = () => json({ data: {} });

beforeEach(() => {
  calls = [];
  previewTasks = [previewTask()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: u, body });
      if (u.endsWith('/tasks/move-targets')) return json({ data: TARGETS });
      if (u.endsWith('/tasks/move-preview')) {
        const outsiders = [...new Map(previewTasks.filter((t) => t.canMove).flatMap((t) => t.outsiders).map((p) => [p.id, p])).values()];
        return json({ data: { project: { ...project('ops', 'OPS', 'Operations'), defaultDueToday: false }, columns: COLUMNS, tasks: previewTasks, outsiders } });
      }
      if (u.includes('move-to-project')) return moveReply();
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

const ONE = [{ id: 't4', key: 'RIG-4', title: 'Inspect the rig', projectId: 'rig' }];
function open(props: Partial<MoveTaskDialogProps> = {}) {
  const onClose = vi.fn();
  const onMoved = vi.fn();
  const onBulkMoved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MoveTaskDialog tasks={ONE} onClose={onClose} onMoved={onMoved} onBulkMoved={onBulkMoved} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onMoved, onBulkMoved };
}
async function chooseProject(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Project' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}
const moves = () => calls.filter((c) => c.method === 'POST' && c.url.includes('move-to-project'));

describe('Move to another project (one task)', () => {
  it('is a dialog named for what it does, about this task, starting on the project', async () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Move to another project' });
    expect(within(dialog).getByText('RIG-4')).toBeInTheDocument();
    expect(within(dialog).getByText('Inspect the rig')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveFocus());
    // Its own project isn't offered.
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByRole('option', { name: /Operations/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Rig Inspection/ })).not.toBeInTheDocument();
  });

  it('says what will change, with the same kind of column chosen', async () => {
    previewTasks = [previewTask({ milestoneCleared: true })];
    open();
    await chooseProject('Operations');
    const changes = await screen.findByRole('list', { name: 'What will change' });
    expect(within(changes).getByText('Becomes OPS-17. Searching for RIG-4 still finds it.')).toBeInTheDocument();
    expect(within(changes).getByText('It stops being a milestone: milestones belong to their project.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Doing');
    expect(calls.find((c) => c.url.endsWith('/tasks/move-preview'))!.body).toEqual({ taskIds: ['t4'], projectId: 'ops' });
  });

  it('when the new project has no column of its stage, says it goes to the first one', async () => {
    previewTasks = [previewTask({ currentCategory: 'REVIEW', columnId: 'o-backlog' })];
    open();
    await chooseProject('Operations');
    expect(await screen.findByText('Operations has no Review column, so it goes to its first one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog');
  });

  it('moves it to the column chosen, and reports what happened', async () => {
    const result = { task: { id: 't4', key: 'OPS-17' }, from: { projectId: 'rig', name: 'Rig Inspection', key: 'RIG-4' }, to: { projectId: 'ops', name: 'Operations', key: 'OPS-17' }, addedToTeam: [], unassigned: [], milestoneCleared: false, dueDateSet: null };
    moveReply = () => json({ data: result });
    const { onMoved } = open();
    await chooseProject('Operations');
    await userEvent.click(await screen.findByRole('button', { name: 'Column' }));
    await userEvent.click(await screen.findByRole('option', { name: /^Next/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Move task/ }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(result));
    expect(moves()).toEqual([{ method: 'POST', url: expect.stringMatching(/\/tasks\/t4\/move-to-project$/), body: { projectId: 'ops', columnId: 'o-todo' } }]);
  });

  it('asks what to do with people not on the new team, and won’t move without an answer', async () => {
    previewTasks = [previewTask({ outsiders: [SARA] })];
    moveReply = () => json({ data: { task: { id: 't4' }, from: { projectId: 'rig', name: 'Rig Inspection', key: 'RIG-4' }, to: { projectId: 'ops', name: 'Operations', key: 'OPS-17' }, addedToTeam: [], unassigned: [SARA], milestoneCleared: false, dueDateSet: null } });
    const { onMoved } = open();
    await chooseProject('Operations');
    const group = await screen.findByRole('radiogroup', { name: 'Sara Al Balushi isn’t on the Operations team.' });
    expect(within(group).getByRole('radio', { name: 'Add Sara Al Balushi to the team' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Unassign Sara Al Balushi' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /^Move task/ }));
    expect(await screen.findByText('Choose whether to add them to the team or unassign them.')).toBeInTheDocument();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(moves()).toEqual([]);
    await userEvent.click(within(group).getByRole('radio', { name: 'Unassign Sara Al Balushi' }));
    await userEvent.click(screen.getByRole('button', { name: /^Move task/ }));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(moves()[0]!.body).toEqual({ projectId: 'ops', columnId: 'o-doing', assignees: 'UNASSIGN' });
  });

  it('shows why a move was refused, and stays open', async () => {
    moveReply = () => json({ error: { code: 'TASK_MOVED', message: 'Someone else moved this task just now. Reload it and try again.' } }, 409);
    const { onMoved, onClose } = open();
    await chooseProject('Operations');
    await userEvent.click(await screen.findByRole('button', { name: /^Move task/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else moved this task just now. Reload it and try again.');
    expect(onMoved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a task it can’t move says why, and offers no Move', async () => {
    previewTasks = [previewTask({ canMove: false, newKey: null, columnId: null, reason: 'You need to manage Rig Inspection to move its tasks.' })];
    open();
    await chooseProject('Operations');
    // Announced, not only shown.
    expect(await screen.findByRole('alert')).toHaveTextContent('You need to manage Rig Inspection to move its tasks.');
    expect(screen.getByRole('button', { name: /^Move task/ })).toBeDisabled();
  });

  it('says it will be marked complete when a Done column is chosen (and reopened when a completed task goes to an open one)', async () => {
    open();
    await chooseProject('Operations');
    const changes = await screen.findByRole('list', { name: 'What will change' });
    expect(within(changes).queryByText('It will be marked complete.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Column' }));
    await userEvent.click(await screen.findByRole('option', { name: /^Finished/ }));
    expect(within(screen.getByRole('list', { name: 'What will change' })).getByText('It will be marked complete.')).toBeInTheDocument();
  });

  it('when someone left the team after the preview, it asks again instead of failing', async () => {
    let refused = false;
    moveReply = () => {
      refused = true;
      // Meanwhile Sara left the Operations team: the preview now names her.
      previewTasks = [previewTask({ outsiders: [SARA] })];
      return json({ error: { code: 'ASSIGNEES_NOT_ON_TEAM', message: 'Sara Al Balushi isn’t on the Operations team. Choose whether to add them to the team or unassign them.', details: { people: [SARA] } } }, 409);
    };
    open();
    await chooseProject('Operations');
    await userEvent.click(await screen.findByRole('button', { name: /^Move task/ }));
    expect(refused).toBe(true);
    expect(await screen.findByRole('radiogroup', { name: 'Sara Al Balushi isn’t on the Operations team.' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sara Al Balushi isn’t on the Operations team.');
    expect(calls.filter((c) => c.url.endsWith('/tasks/move-preview'))).toHaveLength(2);
  });

  it('Escape and Cancel close it without moving anything', async () => {
    const { onClose } = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(moves()).toEqual([]);
  });

  it('with nowhere to move it, says so', async () => {
    const onlyRig = { ...TARGETS, projects: [project('rig', 'RIG', 'Rig Inspection')] };
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).endsWith('/tasks/move-targets') ? json({ data: onlyRig }) : json({ data: [] })));
    open();
    expect(await screen.findByText('There’s no other open project you manage to move it to.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Move task/ })).toBeDisabled();
  });
});

describe('Move to another project (several tasks, from My Tasks)', () => {
  const THREE = [
    { id: 'a', key: 'RIG-1', title: 'One', projectId: 'rig' },
    { id: 'b', key: 'RIG-2', title: 'Two', projectId: 'rig' },
    { id: 'c', key: 'ADM-1', title: 'Pay', projectId: 'adm' },
  ];
  beforeEach(() => {
    previewTasks = [
      previewTask({ id: 'a', key: 'RIG-1', title: 'One', newKey: 'OPS-17', outsiders: [SARA] }),
      previewTask({ id: 'b', key: 'RIG-2', title: 'Two', newKey: 'OPS-18', outsiders: [SARA, { id: 'zaid', name: 'Zaid Omar' }] }),
      previewTask({ id: 'c', key: 'ADM-1', title: 'Pay', canMove: false, newKey: null, columnId: null, reason: 'You need to manage Admin to move its tasks.' }),
    ];
  });

  it('one dialog for all of them: how many, the numbers, the people across them, and the ones that can’t move', async () => {
    open({ tasks: THREE });
    expect(screen.getByRole('dialog', { name: 'Move 3 tasks to another project' })).toBeInTheDocument();
    await chooseProject('Operations');
    expect(await screen.findByText('They get the next OPS numbers, OPS-17 to OPS-18. Searching for their old numbers still finds them.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sara Al Balushi and Zaid Omar aren’t on the Operations team.' })).toBeInTheDocument();
    const refused = screen.getByRole('list', { name: 'Can’t be moved' });
    expect(within(refused).getByText(/ADM-1/)).toHaveTextContent('ADM-1 · Pay: You need to manage Admin to move its tasks.');
    expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Same kind of column as now');
    expect(screen.getByRole('button', { name: /^Move 2 tasks/ })).toBeEnabled();
  });

  it('moves the ones that can move with one answer for everyone, and hands back the results', async () => {
    const result = { results: [{ taskId: 'a', ok: true, to: { name: 'Operations', key: 'OPS-17' } }, { taskId: 'b', ok: true, to: { name: 'Operations', key: 'OPS-18' } }], moved: 2, failed: 0 };
    moveReply = () => json({ data: result });
    const { onBulkMoved, onClose } = open({ tasks: THREE });
    await chooseProject('Operations');
    await userEvent.click(await screen.findByRole('radio', { name: 'Add them to the team' }));
    await userEvent.click(screen.getByRole('button', { name: /^Move 2 tasks/ }));
    await waitFor(() => expect(onBulkMoved).toHaveBeenCalledWith(result, 'Operations'));
    expect(moves()[0]).toMatchObject({ url: expect.stringMatching(/\/tasks\/move-to-project$/), body: { taskIds: ['a', 'b'], projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a task the person can’t open is named as such, not by an empty key', async () => {
    previewTasks = [...previewTasks.slice(0, 2), previewTask({ id: 'c', key: '', title: '', from: null, canMove: false, newKey: null, columnId: null, reason: 'Task not found.' })];
    open({ tasks: THREE });
    await chooseProject('Operations');
    const refused = await screen.findByRole('list', { name: 'Can’t be moved' });
    expect(within(refused).getByText('A task you can’t open: Task not found.')).toBeInTheDocument();
  });

  it('when some couldn’t be moved after all, lists them and why', async () => {
    moveReply = () =>
      json({ data: { results: [{ taskId: 'a', ok: true, to: { name: 'Operations', key: 'OPS-17' } }, { taskId: 'b', ok: false, error: { code: 'TASK_MOVED', message: 'Someone else moved this task just now. Reload it and try again.' } }], moved: 1, failed: 1 } });
    const { onBulkMoved } = open({ tasks: THREE });
    await chooseProject('Operations');
    await userEvent.click(await screen.findByRole('radio', { name: 'Unassign them' }));
    await userEvent.click(screen.getByRole('button', { name: /^Move 2 tasks/ }));
    expect(await screen.findByText('Moved 1 of 2 tasks to Operations. 1 couldn’t be moved.')).toBeInTheDocument();
    expect(screen.getByText('RIG-2 · Two: Someone else moved this task just now. Reload it and try again.')).toBeInTheDocument();
    expect(onBulkMoved).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
