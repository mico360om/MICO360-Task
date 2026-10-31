import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, localStorageQueueStore } from '../lib/offline-queue';

vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' }];
const task = (id: string, key: string, title: string, externalSummary: unknown) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', externalSummary,
});

beforeEach(() => {
  clearQueue(localStorageQueueStore);
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (u.includes('/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
      if (u.includes('/tasks')) {
        return json({
          data: [
            task('t1', 'MICO-1', 'Rig inspection', { count: 2, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said', 'Sara Nasser'], companies: ['OXY', 'PDO'] }),
            task('t2', 'MICO-2', 'Pipeline survey', { count: 1, name: 'Salim', company: 'PDO', names: ['Salim'], companies: ['PDO'] }),
            task('t3', 'MICO-3', 'Internal only', null),
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

describe('BoardPage: external contacts', () => {
  it('each card says who outside the company is responsible', async () => {
    renderPage();
    expect(await screen.findByText('External: Ahmed Al Said (OXY) and 1 more')).toBeInTheDocument();
    expect(screen.getByText('External: Salim (PDO)')).toBeInTheDocument();
  });

  it('filters the board by external company', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by external company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'OXY' }));
    await waitFor(() => expect(screen.queryByText('Pipeline survey')).toBeNull());
    expect(screen.getByText('Rig inspection')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
  });
});
