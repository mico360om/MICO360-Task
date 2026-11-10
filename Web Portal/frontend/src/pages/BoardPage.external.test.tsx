import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, localStorageQueueStore } from '../lib/offline-queue';

// tgc: 1.24 — external contacts are guests now: the cards say "Guest: …" (from the rows' `guests`), and the
// board's "External company" filter became "Guest" (a person) and "Guest company".

vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' }];
const task = (id: string, key: string, title: string, guests: unknown, externalSummary: unknown = null) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', guests, externalSummary,
});
let tasks: unknown[] = [];

beforeEach(() => {
  clearQueue(localStorageQueueStore);
  localStorage.clear();
  tasks = [
    task('t1', 'MICO-1', 'Rig inspection', [{ id: 'g1', name: 'Ahmed Al Said', company: 'OXY' }, { id: 'g2', name: 'Sara Nasser', company: 'PDO' }]),
    task('t2', 'MICO-2', 'Pipeline survey', [{ id: 'g3', name: 'Salim', company: 'PDO' }]),
    task('t3', 'MICO-3', 'Internal only', []),
  ];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (u.includes('/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
      if (u.includes('/categories')) return json({ data: { requireCategory: false, categories: [], canManage: false } });
      if (u.includes('/tasks')) return json({ data: tasks });
      if (u.includes('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board']}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BoardPage: guests', () => {
  it('each card says who outside the company is named on it', async () => {
    renderPage();
    expect(await screen.findByText('Guest: Ahmed Al Said (OXY) and 1 more')).toBeInTheDocument();
    expect(screen.getByText('Guest: Salim (PDO)')).toBeInTheDocument();
    expect(screen.queryByText(/^External:/)).toBeNull();
  });

  it('an older server’s rows (contacts in short, no guests) still show the line', async () => {
    tasks = [task('t1', 'MICO-1', 'Rig inspection', undefined, { count: 2, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said', 'Sara'], companies: ['OXY'] })];
    renderPage();
    expect(await screen.findByText('Guest: Ahmed Al Said (OXY) and 1 more')).toBeInTheDocument();
  });

  it('filters the board by guest company', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    expect(screen.queryByRole('button', { name: 'Filter by external company' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'OXY' }));
    await waitFor(() => expect(screen.queryByText('Pipeline survey')).toBeNull());
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
  });

  it('filters the board by guest (a person), and “Show every card” clears the filters when none is left', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Salim (PDO)' }));
    await waitFor(() => expect(screen.queryByText('Rig inspection')).toBeNull());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    // With the company too: nothing is left, and the board says so.
    await userEvent.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'OXY' }));
    expect(await screen.findByText('No cards on this board match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show every card' }));
    await waitFor(() => expect(screen.getByText('Internal only')).toBeInTheDocument());
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
  });
});
