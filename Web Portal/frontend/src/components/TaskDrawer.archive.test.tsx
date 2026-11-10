import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawer } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';

// Task archive (bulk lane): "Archive" in the task's More actions (administrators and the people who run
// its project); an archived task's panel says so — "Archived on 3 Nov by Ali — read-only" — with Unarchive
// for the same people.
const task: ApiTask = {
  id: 't1',
  key: 'RIG-12',
  title: 'Check the valves',
  description: 'All of them.',
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'HIGH',
  startDate: null,
  dueDate: null,
  progress: 0,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};
const archived: ApiTask = { ...task, archivedAt: new Date().toISOString(), archivedById: 'u9' };

describe('TaskDrawer: task archive', () => {
  it('offers Archive in More actions when it may be archived — and never otherwise', async () => {
    const onArchive = vi.fn();
    const { rerender } = render(<TaskDrawer task={task} checklist={[]} comments={[]} onArchive={onArchive} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    rerender(<TaskDrawer task={task} checklist={[]} comments={[]} onDuplicate={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
  });

  it('an archived task: the banner says when and by whom, “read-only”; the header says Archived; no Archive item', async () => {
    render(<TaskDrawer task={archived} archivedByName="Ali Hassan" checklist={[]} comments={[]} onArchive={vi.fn()} onDuplicate={vi.fn()} onClose={vi.fn()} />);
    const banner = screen.getByTestId('archived-banner');
    expect(banner).toHaveTextContent(/^Archived on \d{1,2} [A-Z][a-z]{2} by Ali Hassan — read-only/);
    expect(within(banner).queryByRole('button', { name: 'Unarchive' })).toBeNull();
    expect(within(screen.getByTestId('task-header')).getByText('Archived')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
  });

  it('Unarchive in the banner, for whoever may; a refusal says why and keeps the banner', async () => {
    const onUnarchive = vi.fn().mockRejectedValueOnce(new Error('Only administrators and the people who run its project can archive or unarchive its tasks.')).mockResolvedValueOnce(undefined);
    render(<TaskDrawer task={archived} archivedByName="Ali" checklist={[]} comments={[]} onUnarchive={onUnarchive} onClose={vi.fn()} />);
    const banner = screen.getByTestId('archived-banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'Unarchive' }));
    expect(await within(banner).findByRole('alert')).toHaveTextContent('Only administrators');
    await userEvent.click(within(banner).getByRole('button', { name: 'Unarchive' }));
    expect(onUnarchive).toHaveBeenCalledTimes(2);
    expect(within(banner).queryByRole('alert')).toBeNull();
  });
});
