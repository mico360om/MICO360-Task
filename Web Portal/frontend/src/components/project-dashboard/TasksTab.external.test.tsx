import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksTab } from './TasksTab';
import type { ApiTask } from '../../api/tasks';

const task = (id: string, title: string, externalSummary: ApiTask['externalSummary']): ApiTask => ({
  id, key: `RIG-${id}`, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', externalSummary,
});
const groups = [
  {
    id: 'c1',
    name: 'To Do',
    color: '#3A6EA5',
    tasks: [
      task('1', 'Rig inspection', { count: 2, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said', 'Sara Nasser'], companies: ['OXY'] }),
      task('2', 'Internal only', null),
    ],
  },
];

describe('project Tasks tab: external contacts', () => {
  it('each row says who outside the company is responsible, and finding a task matches their names and companies', async () => {
    render(<TasksTab groups={groups} today="2026-10-31" timeZone="Asia/Muscat" loading={false} filter="all" onFilter={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('External: Ahmed Al Said (OXY) and 1 more')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Find a task…'), 'sara');
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
  });
});
