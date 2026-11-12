import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, localStorageQueueStore } from '../lib/offline-queue';

vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' },
  { id: 'p2', code: 'RIG', name: 'Rig Inspection', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#1E8B1E', createdAt: '', updatedAt: '' },
];
const ELEC = { id: 'k1', name: 'Electrical', color: 'teal', retired: false };
const HSE = { id: 'k2', name: 'HSE', color: 'pink', retired: false };
const task = (id: string, key: string, title: string, categories: unknown, projectId = 'p1') => ({
  id, key, title, description: null, projectId, columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', guests: [], categories,
});
let requireCategory = true;
let categoryCalls = 0;

beforeEach(() => {
  clearQueue(localStorageQueueStore);
  localStorage.clear();
  requireCategory = true;
  categoryCalls = 0;
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (u.includes('/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
      if (u.includes('/projects/p1/categories')) {
        categoryCalls += 1;
        return json({
          data: {
            requireCategory,
            canManage: false,
            categories: [
              { ...ELEC, projectId: 'p1', position: 0, retiredAt: null },
              { id: 'k9', projectId: 'p1', name: 'Civil', color: 'gold', position: 1, retired: true, retiredAt: '2026-11-01T00:00:00Z' },
              { ...HSE, projectId: 'p1', position: 2, retiredAt: null },
            ],
          },
        });
      }
      if (u.includes('/tasks')) {
        return json({
          data: [
            task('t1', 'MICO-1', 'Panel wiring', [ELEC, HSE]),
            task('t2', 'MICO-2', 'Toolbox talk', [HSE]),
            task('t3', 'MICO-3', 'Unsorted job', []),
            task('t4', 'RIG-1', 'Rig check', [{ id: 'k5', name: 'Mechanical', color: 'navy', retired: false }], 'p2'),
          ],
        });
      }
      if (u.includes('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(entry = '/board?project=p1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const cardOf = (title: string) => screen.getByText(title).closest('[data-card-key]') as HTMLElement;

describe('BoardPage: categories (1.24)', () => {
  it('each card shows its category chips', async () => {
    renderPage();
    await screen.findByText('Panel wiring');
    expect(within(cardOf('Panel wiring')).getByRole('img', { name: 'Category: Electrical' })).toBeInTheDocument();
    expect(within(cardOf('Panel wiring')).getByRole('img', { name: 'Category: HSE' })).toBeInTheDocument();
    expect(within(cardOf('Toolbox talk')).getByRole('img', { name: 'Category: HSE' })).toBeInTheDocument();
  });

  it('“Needs a category” on a card without one when the project asks every task for one', async () => {
    renderPage();
    await screen.findByText('Unsorted job');
    await waitFor(() => expect(within(cardOf('Unsorted job')).getByText('Needs a category')).toBeInTheDocument());
    expect(within(cardOf('Panel wiring')).queryByText('Needs a category')).toBeNull();
  });

  it('no mark when the project doesn’t ask for one', async () => {
    requireCategory = false;
    renderPage();
    await screen.findByText('Unsorted job');
    await waitFor(() => expect(categoryCalls).toBeGreaterThan(0));
    expect(screen.queryByText('Needs a category')).toBeNull();
  });

  it('the Category filter offers the project’s whole list (the retired one marked) and keeps only the cards with the one picked', async () => {
    renderPage();
    await screen.findByText('Panel wiring');
    await waitFor(() => expect(categoryCalls).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Category: Any category', 'Electrical', 'HSE', 'Civilretired']);
    await userEvent.click(screen.getByRole('option', { name: /^Electrical/ }));
    await waitFor(() => expect(screen.queryByText('Toolbox talk')).toBeNull());
    expect(screen.getByText('Panel wiring')).toBeInTheDocument();
    expect(screen.queryByText('Unsorted job')).toBeNull();
  });

  it('All projects: the categories on the cards, each with its project’s name; no “Needs a category” there', async () => {
    renderPage('/board?project=all');
    await screen.findByText('Rig check');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Category: Any category', 'ElectricalMICO360 Platform', 'HSEMICO360 Platform', 'MechanicalRig Inspection']);
    await userEvent.click(screen.getByRole('option', { name: /^Mechanical/ }));
    await waitFor(() => expect(screen.queryByText('Panel wiring')).toBeNull());
    expect(screen.getByText('Rig check')).toBeInTheDocument();
    expect(screen.queryByText('Needs a category')).toBeNull();
    expect(categoryCalls).toBe(0);
  });

  it('Clear lets go of the filters; another project lets go of the category (each project has its own)', async () => {
    renderPage();
    await screen.findByText('Panel wiring');
    await waitFor(() => expect(categoryCalls).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    await userEvent.click(await screen.findByRole('option', { name: /^HSE/ }));
    await waitFor(() => expect(screen.queryByText('Unsorted job')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('Unsorted job')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    // Picked again, then the board shows All projects: the category is let go.
    await userEvent.click(screen.getByRole('button', { name: 'Filter by category' }));
    await userEvent.click(await screen.findByRole('option', { name: /^HSE/ }));
    await waitFor(() => expect(screen.queryByText('Unsorted job')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Select project' }));
    await userEvent.click(await screen.findByRole('option', { name: /All projects/ }));
    expect(await screen.findByText('Rig check')).toBeInTheDocument();
    expect(screen.getByText('Unsorted job')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by category' })).toHaveTextContent('Category: Any category');
  });
});
