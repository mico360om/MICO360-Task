import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TasksTab } from './TasksTab';
import { useDensityStore } from '../../lib/density';
import type { ApiTask } from '../../api/tasks';
import type { ApiProject } from '../../api/projects';

afterEach(() => act(() => useDensityStore.getState().set('comfortable')));

const task = {
  id: 't1', key: 'MICO-1', title: 'Pour the level 5 slab', description: 'Book the pump.\nThen the crew.', projectId: 'p1', columnId: 'c1', columnCategory: 'IN_PROGRESS', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 10, completedAt: null, createdAt: '', updatedAt: '', assignees: [{ id: 'u1', name: 'Ann Lee' }], tags: [{ id: 'g', name: 'Concrete', color: '#123456' }],
  counts: { comments: 0, attachments: 0, checklistDone: 1, checklistTotal: 4 },
} as unknown as ApiTask;

describe('Detailed rows on a project’s Tasks tab (1.23.8 review)', () => {
  it('the extra lines are inline inside the row’s button (no <p> in a <button>), with the checklist count', () => {
    act(() => useDensityStore.getState().set('detailed'));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TasksTab
            groups={[{ id: 'c1', name: 'Doing', color: '', tasks: [task] }]}
            today="2026-11-10"
            timeZone="Asia/Muscat"
            loading={false}
            filter="all"
            onFilter={() => {}}
            onOpen={() => {}}
            project={{ id: 'p1', name: 'MICO', code: 'MICO' } as unknown as ApiProject}
            columns={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = screen.getByRole('button', { name: /MICO-1/ });
    expect(row.querySelector('p')).toBeNull();
    expect(row.querySelector('[data-testid="card-description"]')!.tagName).toBe('SPAN');
    expect(row.querySelector('[data-testid="card-checklist"]')).toHaveTextContent('1/4');
  });
});

// s137: one New task — the top bar's, which already starts in this project. The empty tab only points to it.
describe('An empty project’s Tasks tab (1.23.37)', () => {
  it('has no New task button of its own and says where New task is', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TasksTab groups={[]} today="2026-11-10" timeZone="Asia/Muscat" loading={false} filter="all" onFilter={() => {}} onOpen={() => {}} canAdd project={{ id: 'p1', name: 'MICO', code: 'MICO' } as unknown as ApiProject} columns={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('No tasks in this project yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).toBeNull();
    expect(screen.getByText(/New task at the top/)).toBeInTheDocument();
  });
});
