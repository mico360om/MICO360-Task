import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TaskDrawer } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';

// Duplicate Task in the task panel: "Duplicate…" in its actions menu, "Duplicated from MICO-11" on a copy and
// "Copies: MICO-40, MICO-41" on an original — each a link that opens that task in the panel.

const task: ApiTask = {
  id: 't1', key: 'MICO-12', title: 'Prepare the vendor sheet', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}
const show = (t: ApiTask, extra: Partial<React.ComponentProps<typeof TaskDrawer>> = {}) =>
  render(
    <MemoryRouter initialEntries={['/board?view=table']}>
      <TaskDrawer task={t} timeZone="Asia/Muscat" checklist={[]} comments={[]} onClose={vi.fn()} {...extra} />
      <Where />
    </MemoryRouter>,
  );

describe('Duplicate in the task panel', () => {
  it('“Duplicate…” is in the actions menu, on every screen', async () => {
    const onDuplicate = vi.fn();
    show(task, { onDuplicate });
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more.className).not.toMatch(/sm:hidden/);
    await userEvent.click(more);
    await userEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Duplicate…' }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('a copy says which task it was duplicated from, and opens it', async () => {
    show({ ...task, duplicatedFrom: { id: 't0', key: 'MICO-11' }, copies: [] });
    const header = screen.getByTestId('task-header');
    expect(within(header).getByText(/Duplicated from/)).toBeInTheDocument();
    const link = within(header).getByRole('link', { name: 'Open MICO-11, the task this was duplicated from' });
    expect(link).toHaveTextContent('MICO-11');
    await userEvent.click(link);
    expect(screen.getByTestId('where')).toHaveTextContent('?view=table&task=t0');
  });

  it('an original lists its copies, each opening that copy', async () => {
    show({ ...task, duplicatedFrom: null, copies: [{ id: 't40', key: 'MICO-40' }, { id: 't41', key: 'MICO-41' }] });
    const header = screen.getByTestId('task-header');
    const copies = within(header).getByRole('group', { name: 'Copies' });
    expect(copies).toHaveTextContent('Copies: MICO-40, MICO-41');
    await userEvent.click(within(copies).getByRole('link', { name: 'Open MICO-41, a copy of this task' }));
    expect(screen.getByTestId('where')).toHaveTextContent('task=t41');
  });

  it('many copies: the first few, then how many more', () => {
    const copies = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, key: `MICO-${40 + i}` }));
    show({ ...task, copies });
    const group = within(screen.getByTestId('task-header')).getByRole('group', { name: 'Copies' });
    expect(within(group).getAllByRole('link')).toHaveLength(5);
    expect(group).toHaveTextContent('and 3 more');
  });

  it('nothing is said when there is neither (or the reader can’t open the other task)', () => {
    show({ ...task, duplicatedFrom: null, copies: [] });
    expect(screen.queryByText(/Duplicated from/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Copies' })).toBeNull();
  });

  it('outside the app’s pages (no router) the links are plain addresses', () => {
    render(<TaskDrawer task={{ ...task, duplicatedFrom: { id: 't0', key: 'MICO-11' } }} timeZone="Asia/Muscat" checklist={[]} comments={[]} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Open MICO-11, the task this was duplicated from' })).toHaveAttribute('href', '?task=t0');
  });
});
