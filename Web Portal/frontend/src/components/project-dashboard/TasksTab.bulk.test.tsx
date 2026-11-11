import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksTab } from './TasksTab';
import { useAuthStore } from '../../stores/auth-store';
import { userStorageKey } from '../../lib/user-storage';
import type { ApiTask } from '../../api/tasks';
import type { ApiProject } from '../../api/projects';
import type { ApiColumn } from '../../api/columns';

const task = (key: string, title: string, patch: Partial<ApiTask> = {}): ApiTask => ({
  id: key, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...patch,
});
const COLUMNS: ApiColumn[] = [
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#2E7D32', enabled: true },
];
const groups = [
  { id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [task('MICO-1', 'Valve check'), task('MICO-2', 'Pump overhaul'), task('MICO-4', 'Paint rails')] },
  { id: 'c2', name: 'Done', color: '#2E7D32', tasks: [task('MICO-3', 'Gate repair', { columnId: 'c2', columnCategory: 'DONE' })] },
];
const PROJECT = { id: 'p1', code: 'MICO', name: 'Platform', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null, canManage: true } as unknown as ApiProject;
let posts: { url: string; body: { taskIds: string[]; action: unknown; dryRun?: boolean } }[] = [];

beforeEach(() => {
  localStorage.clear();
  posts = [];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).endsWith('/tasks/bulk')) {
      const body = JSON.parse(String(init.body));
      posts.push({ url: String(url), body });
      return new Response(JSON.stringify({ data: { action: 'archive', dryRun: !!body.dryRun, total: body.taskIds.length, changed: body.taskIds.map((id: string) => ({ id, key: id, title: 'T', projectId: 'p1' })), skipped: [], undo: body.dryRun ? null : { id: 'b9', until: '2026-11-12T08:00:30.000Z' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function show(props: Partial<Parameters<typeof TasksTab>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TasksTab groups={groups} today="2026-11-05" timeZone="UTC" loading={false} filter="all" onFilter={vi.fn()} onOpen={onOpen} project={PROJECT} columns={COLUMNS} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe('project Tasks tab: bulk selection', () => {
  it('each row has its own box beside it (the row still opens the task)', async () => {
    const user = userEvent.setup();
    const { onOpen } = show();
    const box = screen.getByRole('checkbox', { name: 'Select MICO-2 Pump overhaul' });
    expect(box.closest('button')).toBeNull();
    await user.click(box);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    await user.click(screen.getByRole('button', { name: /Valve check/ }));
    expect(onOpen).toHaveBeenCalledWith('MICO-1');
  });

  it('"Select all 4", Shift range in the list order, and what the words hide', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('checkbox', { name: 'Select MICO-1 Valve check' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select MICO-4 Paint rails' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('3 selected');
    await user.type(screen.getByPlaceholderText('Find a task…'), 'gate');
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('3 selected (3 hidden by filters)');
    await user.click(screen.getByRole('checkbox', { name: 'Select all 1 matching' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('4 selected (3 hidden by filters)');
  });

  it('the table shares the selection; a manager can archive the selection (confirm, then the summary)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'project-tasks.view'), 'table');
    show();
    await user.click(within(screen.getByRole('table')).getByRole('checkbox', { name: 'Select MICO-3 Gate repair' }));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive 1 task?' });
    await user.click(await within(dialog).findByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('1 archived')).toBeInTheDocument();
    expect(posts.map((p) => p.body)).toEqual([
      { taskIds: ['MICO-3'], action: { type: 'archive' }, dryRun: true },
      { taskIds: ['MICO-3'], action: { type: 'archive' } },
    ]);
  });

  it('an archived or completed project has no boxes', () => {
    show({ readOnly: 'archived' });
    expect(screen.queryByRole('checkbox', { name: /^Select / })).toBeNull();
  });
});
