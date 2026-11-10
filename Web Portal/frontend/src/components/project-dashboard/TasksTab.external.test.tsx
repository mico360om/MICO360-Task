import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksTab } from './TasksTab';
import type { ApiTask } from '../../api/tasks';

// tgc: 1.24 — external contacts are guests now: each row says "Guest: …" (from the row's `guests`), finding a
// task matches its guests' names and companies, and the tab has the Guest, Guest company and Category filters.

const task = (id: string, title: string, extra: Partial<ApiTask> = {}): ApiTask => ({
  id, key: `RIG-${id}`, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
});
const ELEC = { id: 'k1', name: 'Electrical', color: 'teal', retired: false };
const HSE = { id: 'k2', name: 'HSE', color: 'pink', retired: false };
const groups = [
  {
    id: 'c1',
    name: 'To Do',
    color: '#3A6EA5',
    tasks: [
      task('1', 'Rig inspection', { guests: [{ id: 'g1', name: 'Ahmed Al Said', company: 'OXY' }, { id: 'g2', name: 'Sara Nasser', company: 'PDO' }], categories: [ELEC, HSE] }),
      task('2', 'Internal only', { guests: [], categories: [HSE] }),
      task('3', 'Old row', { externalSummary: { count: 1, name: 'Salim', company: 'Petrogas', names: ['Salim'], companies: ['Petrogas'] } }),
    ],
  },
];
const renderTab = () => render(<TasksTab groups={groups} today="2026-10-31" timeZone="Asia/Muscat" loading={false} filter="all" onFilter={vi.fn()} onOpen={vi.fn()} />);

describe('project Tasks tab: guests and categories', () => {
  it('each row says who outside the company is named on it (an older server’s row from its contacts in short)', () => {
    renderTab();
    expect(screen.getByText('Guest: Ahmed Al Said (OXY) and 1 more')).toBeInTheDocument();
    expect(screen.getByText('Guest: Salim (Petrogas)')).toBeInTheDocument();
    expect(screen.queryByText(/^External:/)).toBeNull();
  });

  it('finding a task matches its guests’ names and companies', async () => {
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('Find a task…'), 'sara');
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
    await userEvent.clear(screen.getByPlaceholderText('Find a task…'));
    await userEvent.type(screen.getByPlaceholderText('Find a task…'), 'petrogas');
    expect(screen.getByText('Old row')).toBeInTheDocument();
    expect(screen.queryByText('Rig inspection')).toBeNull();
  });

  it('each row shows its category chips', () => {
    renderTab();
    const row = screen.getByText('Rig inspection').closest('button')!;
    expect([...row.querySelectorAll('[data-category-chip]')].map((el) => el.getAttribute('aria-label'))).toEqual(['Category: Electrical', 'Category: HSE']);
  });

  it('filters by category, guest and guest company', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    await userEvent.click(await screen.findByRole('option', { name: /^HSE/ }));
    await waitFor(() => expect(screen.queryByText('Old row')).toBeNull());
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    expect(screen.getByText('Internal only')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Sara Nasser (PDO)' }));
    await waitFor(() => expect(screen.queryByText('Internal only')).toBeNull());
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    // Clear brings every task back.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('Old row')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Petrogas' }));
    await waitFor(() => expect(screen.queryByText('Rig inspection')).toBeNull());
    expect(screen.getByText('Old row')).toBeInTheDocument();
  });
});
