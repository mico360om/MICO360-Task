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
  { id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [task('MICO-1', 'Valve check'), task('MICO-2', 'Pump overhaul', { isMilestone: true })] },
  { id: 'c2', name: 'Done', color: '#2E7D32', tasks: [task('MICO-3', 'Gate repair', { columnId: 'c2', columnCategory: 'DONE' })] },
];
const PROJECT = { id: 'p1', code: 'MICO', name: 'Platform', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null } as unknown as ApiProject;

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
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

describe('project Tasks tab: List | Table (1.23.0)', () => {
  it('starts in List, switches to Table, and remembers it for the person', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('table', { name: 'Tasks of Platform' })).toBeInTheDocument();
    expect(localStorage.getItem(userStorageKey('u1', 'project-tasks.view'))).toBe('table');
    // As listed today: column by column.
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Valve check'), expect.stringContaining('Pump overhaul'), expect.stringContaining('Gate repair')]);
    // Its own Project column isn't needed on a project's page; there is no second filter bar.
    expect(screen.queryByRole('columnheader', { name: /Project/ })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Filter rows' })).toBeNull();
  });

  it('uses the tab’s own phase chips', () => {
    localStorage.setItem(userStorageKey('u1', 'project-tasks.view'), 'table');
    show({ filter: 'completed' });
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.getByRole('rowheader')).toHaveTextContent('Gate repair');
  });

  it('“Find a task” narrows the table too', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'project-tasks.view'), 'table');
    show();
    await user.type(screen.getByPlaceholderText('Find a task…'), 'mico 2');
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Pump overhaul')]);
  });

  it('an archived project’s table has no quick edits', () => {
    localStorage.setItem(userStorageKey('u1', 'project-tasks.view'), 'table');
    show({ readOnly: 'archived' });
    expect(screen.queryByRole('button', { name: /Change the title/ })).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('button', { name: /^Open MICO-/ })).toHaveLength(3);
  });

  it('Open opens the task', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'project-tasks.view'), 'table');
    const { onOpen } = show();
    await user.click(screen.getByRole('button', { name: 'Open MICO-2: Pump overhaul' }));
    expect(onOpen).toHaveBeenCalledWith('MICO-2');
  });
});
