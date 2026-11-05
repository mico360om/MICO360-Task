import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MergeTasksDialog } from './MergeTasksDialog';
import type { MergePreview, MergePreviewTask } from '../api/task-merge';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const counts = { comments: 2, checklist: 1, files: 0, assignees: 1, watchers: 0, contacts: 0, tags: 0, blockers: 0, actionItems: 0, inspections: 0, activity: 3 };
const task = (id: string, key: string, title: string, over: Partial<MergePreviewTask> = {}): MergePreviewTask => ({
  id, key, title, projectId: 'rig', projectName: 'Rig Inspection', status: { name: 'To do', category: 'TODO' }, createdAt: '2026-11-01T08:00:00Z', createdByName: 'Aisha', version: 1, canMerge: true, reason: null, counts, ...over,
});
const TASKS = { t12: task('t12', 'MICO-12', 'Service the pump'), t14: task('t14', 'MICO-14', 'Pump check', { version: 4 }) };

let calls: { method: string; url: string; body: unknown }[] = [];
let preview: (body: { taskIds: string[]; mainTaskId?: string }) => MergePreview;
let mergeReply: () => Response;

const basePreview = (ids: string[], mainTaskId?: string): MergePreview => ({
  tasks: ids.map((id) => TASKS[id as keyof typeof TASKS]),
  mainTaskId: mainTaskId ?? ids[0] ?? null,
  canMerge: ids.length >= 2,
  reason: ids.length >= 2 ? null : 'Choose at least 2 tasks you can merge.',
  differences:
    ids.length >= 2
      ? [
          { field: 'title', label: 'Title', options: [{ value: mainTaskId ?? 't12', label: mainTaskId === 't14' ? 'Pump check' : 'Service the pump', keys: [] }, { value: mainTaskId === 't14' ? 't12' : 't14', label: mainTaskId === 't14' ? 'Service the pump' : 'Pump check', keys: [] }] },
          { field: 'priority', label: 'Priority', options: [{ value: 't12', label: 'Normal', keys: ['MICO-12'] }, { value: 't14', label: 'High', keys: ['MICO-14'] }] },
        ]
      : [],
  project: { id: 'rig', name: 'Rig Inspection', code: 'MICO', changes: false, newKey: null },
  duplicates: { checklist: 1, files: 0, contacts: 0, assignees: 0, watchers: 0, tags: 0, blockers: 0 },
  duplicatesText: ids.length >= 2 ? '1 checklist item appears in more than one task — kept once.' : null,
  droppedLinks: [],
  outsiders: [],
  watchersLeftOff: 0,
  descriptionTooLong: false,
});

beforeEach(() => {
  calls = [];
  preview = (b) => basePreview(b.taskIds, b.mainTaskId);
  mergeReply = () => json({ data: { mergeId: 'm1', mainTaskId: 't12', mainKey: 'MICO-12', mainProjectId: 'rig', mainProjectBefore: 'rig', merged: [{ id: 't14', key: 'MICO-14', projectId: 'rig' }], addedToTeam: [], leftOff: [], text: 'Merged MICO-14 into MICO-12' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: u, body });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: ['rig'], projects: [] } });
      if (u.endsWith('/tasks/merge-preview')) return json({ data: preview(body) });
      if (u.endsWith('/tasks/merge')) return mergeReply();
      if (u.includes('/search/tasks')) return json({ data: [{ id: 't14', key: 'MICO-14', title: 'Pump check', projectId: 'rig', project: { id: 'rig', code: 'MICO', name: 'Rig Inspection', archived: false } }, { id: 'x9', key: 'OPS-9', title: 'Pump elsewhere', projectId: 'ops', project: { id: 'ops', code: 'OPS', name: 'Operations', archived: false } }], nextCursor: null });
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function open(tasks = [{ id: 't12', key: 'MICO-12', title: 'Service the pump', projectId: 'rig' }]) {
  const onClose = vi.fn();
  const onMerged = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MergeTasksDialog tasks={tasks} onClose={onClose} onMerged={onMerged} />
    </QueryClientProvider>,
  );
  return { onClose, onMerged };
}
const merges = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks/merge'));

describe('Merge tasks', () => {
  it('starts with this task, finds more by number or title (only ones the person may merge) and then previews', async () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Merge tasks' });
    expect(await within(dialog).findByText('Choose at least 2 tasks you can merge.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Merge tasks' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Add a task to merge' }), 'pump');
    const option = await screen.findByRole('option', { name: /Pump check/ });
    // A task in a project they don't manage isn't offered.
    expect(screen.queryByRole('option', { name: /Pump elsewhere/ })).not.toBeInTheDocument();
    await userEvent.click(option);
    expect(await within(dialog).findByText('1 checklist item appears in more than one task — kept once.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Merge 2 tasks' })).toBeEnabled();
  });

  it('the main task is the oldest unless another is chosen; each difference keeps the main task’s value unless chosen', async () => {
    const { onMerged } = open([
      { id: 't12', key: 'MICO-12', title: 'Service the pump', projectId: 'rig' },
      { id: 't14', key: 'MICO-14', title: 'Pump check', projectId: 'rig' },
    ]);
    const dialog = screen.getByRole('dialog', { name: 'Merge tasks' });
    expect(await within(dialog).findByText(/What will be combined into MICO-12/)).toBeInTheDocument();
    const mainGroup = within(dialog).getByRole('group', { name: 'Main task — the one that stays' });
    expect(within(mainGroup).getByRole('radio', { name: /MICO-12/ })).toBeChecked();
    const priority = within(dialog).getByRole('group', { name: 'Priority' });
    expect(within(priority).getByRole('radio', { name: /Normal/ })).toBeChecked();
    await userEvent.click(within(priority).getByRole('radio', { name: /High/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 tasks' }));
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    expect(merges()[0]!.body).toEqual({ taskIds: ['t12', 't14'], mainTaskId: 't12', choices: { title: 't12', priority: 't14' }, people: {}, versions: { t12: 1, t14: 4 } });
  });

  it('asks about each person not on the team before merging', async () => {
    preview = (b) => ({ ...basePreview(b.taskIds, b.mainTaskId), outsiders: [{ id: 'sara', name: 'Sara Al Balushi', canJoin: false, keys: ['MICO-14'] }] });
    open([
      { id: 't12', key: 'MICO-12', title: 'Service the pump', projectId: 'rig' },
      { id: 't14', key: 'MICO-14', title: 'Pump check', projectId: 'rig' },
    ]);
    const dialog = screen.getByRole('dialog', { name: 'Merge tasks' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Merge 2 tasks' }));
    expect(await within(dialog).findByText('Choose for each person whether to add them to the team or leave them off.')).toBeInTheDocument();
    expect(merges()).toEqual([]);
    const sara = within(dialog).getByRole('radiogroup', { name: /Sara Al Balushi/ });
    // From another company: only "leave off".
    expect(within(sara).getByRole('radio', { name: /Can’t join/ })).toBeDisabled();
    await userEvent.click(within(sara).getByRole('radio', { name: /Leave off this task/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 tasks' }));
    await waitFor(() => expect(merges()).toHaveLength(1));
    expect(merges()[0]!.body).toMatchObject({ people: { sara: 'LEAVE_OFF' } });
  });

  it('says why it couldn’t merge, and reads the preview again', async () => {
    mergeReply = () => json({ error: { code: 'VERSION_CONFLICT', message: 'MICO-14 changed while you were merging. Look again and try once more.' } }, 409);
    open([
      { id: 't12', key: 'MICO-12', title: 'Service the pump', projectId: 'rig' },
      { id: 't14', key: 'MICO-14', title: 'Pump check', projectId: 'rig' },
    ]);
    const dialog = screen.getByRole('dialog', { name: 'Merge tasks' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Merge 2 tasks' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('MICO-14 changed while you were merging.');
  });
});
