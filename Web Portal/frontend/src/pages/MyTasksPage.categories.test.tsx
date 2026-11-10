import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';
import { useDensityStore } from '../lib/density';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const ELEC = { id: 'k1', name: 'Electrical', color: 'teal', retired: false };
const HSE = { id: 'k2', name: 'HSE', color: 'pink', retired: false };
const CIVIL = { id: 'k3', name: 'Civil', color: 'gold', retired: true };
const MECH = { id: 'k5', name: 'Mechanical', color: 'navy', retired: false };
const task = (id: string, key: string, title: string, categories: unknown, projectId = 'p1') => ({
  id, key, title, description: null, projectId, columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [], guests: [], categories,
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/projects'))
        return json({
          data: [
            { id: 'p1', code: 'MICO', name: 'MICO Platform', color: '#1E5A8B', icon: null, status: 'ACTIVE' },
            { id: 'p2', code: 'RIG', name: 'Rig Inspection', color: '#1E8B5A', icon: null, status: 'ACTIVE' },
          ],
        });
      if (u.includes('/tasks/mine'))
        return json({
          data: [
            task('t1', 'MICO-1', 'Panel wiring', [ELEC, HSE, CIVIL]),
            task('t2', 'MICO-2', 'Toolbox talk', [HSE]),
            task('t3', 'RIG-1', 'Rig check', [MECH], 'p2'),
            task('t4', 'MICO-3', 'Unsorted job', []),
          ],
        });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useDensityStore.getState().set('comfortable'));
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const holder = (key: string) => [...document.querySelectorAll<HTMLElement>(`[data-task-key="${key}"]`)].find((el) => el.querySelector(`[data-task-key="${key}"]`))!;
const chipsOf = (key: string) => [...holder(key).querySelectorAll('[data-category-chip]')].map((el) => el.getAttribute('aria-label'));

describe('My Tasks: categories (1.24)', () => {
  it('cards show the chips (Comfortable: two and “+1”)', async () => {
    renderPage();
    await screen.findByText('Panel wiring');
    expect(chipsOf('MICO-1')).toEqual(['Category: Electrical', 'Category: HSE']);
    expect(within(holder('MICO-1')).getByText('+1')).toBeInTheDocument();
    expect(chipsOf('MICO-3')).toEqual([]);
  });

  it('list rows show them too: Compact one, Detailed all', async () => {
    act(() => useDensityStore.getState().set('compact'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'List view' }));
    await waitFor(() => expect(chipsOf('MICO-1')).toEqual(['Category: Electrical']));
    act(() => useDensityStore.getState().set('detailed'));
    await waitFor(() => expect(chipsOf('MICO-1')).toEqual(['Category: Electrical', 'Category: HSE', 'Category: Civil (retired)']));
  });

  it('the Category filter lists the categories by project (the project as a hint) and keeps the tasks with the one picked', async () => {
    renderPage();
    await screen.findByText('Panel wiring');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual([
      'Category: Any category',
      'CivilMICO Platform · retired',
      'ElectricalMICO Platform',
      'HSEMICO Platform',
      'MechanicalRig Inspection',
    ]);
    await userEvent.click(screen.getByRole('option', { name: /^HSE/ }));
    await waitFor(() => expect(screen.queryByText('Rig check')).toBeNull());
    expect(screen.getByText('Panel wiring')).toBeInTheDocument();
    expect(screen.getByText('Toolbox talk')).toBeInTheDocument();
    expect(screen.queryByText('Unsorted job')).toBeNull();
    // “Clear filters” under no match, and the toolbar's Clear, clear it too.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('Unsorted job')).toBeInTheDocument());
  });

  it('the Table view: a Categories column (from Columns) whose header sorts the page', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Table view' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Categories' }));
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Categories/ })).getByRole('button'));
    const order = () => screen.getAllByRole('rowheader').map((h) => h.textContent?.match(/Panel wiring|Toolbox talk|Rig check|Unsorted job/)?.[0]);
    // First categories: Electrical, HSE, Mechanical; none last.
    await waitFor(() => expect(order()).toEqual(['Panel wiring', 'Toolbox talk', 'Rig check', 'Unsorted job']));
    expect(screen.getByRole('button', { name: 'Sort tasks' })).toHaveTextContent('Categories (A–Z)');
    // The other way round: Mechanical, HSE, Electrical (none still last).
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Categories/ })).getByRole('button'));
    await waitFor(() => expect(order()).toEqual(['Rig check', 'Toolbox talk', 'Panel wiring', 'Unsorted job']));
  });
});
