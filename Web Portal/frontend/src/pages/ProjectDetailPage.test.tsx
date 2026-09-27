import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Platform', description: 'Desc', clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', ownerId: null, createdAt: '', updatedAt: '' };
const COLUMNS = [
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#111', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#222', enabled: true },
];
const task = (id: string, extra: Record<string, unknown>) => ({
  id, key: id.toUpperCase(), title: `Task ${id}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
});

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  // A project MANAGER who is not an admin.
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 on 30 Sep in Muscat
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'manager', email: '', firstName: 'Mona', lastName: 'M', role: 'MANAGER' }] });
    if (u.endsWith('/users/directory')) return json({ data: [
      { id: 'u1', username: 'manager', firstName: 'Mona', lastName: 'M', avatarUrl: null },
      { id: 'u7', username: 'sara', firstName: 'Sara', lastName: 'K', avatarUrl: null },
    ] });
    if (u.endsWith('/users')) return json({ error: { code: 'FORBIDDEN', message: 'Admins only' } }, 403);
    if (u.includes('/columns')) return json({ data: COLUMNS });
    if (u.includes('/tasks')) return json({ data: [
      task('t1', { dueDate: '2026-09-30T00:00:00.000Z' }), // due today → not overdue
      task('t2', { dueDate: '2026-09-29T00:00:00.000Z' }), // yesterday → overdue
      task('t3', { dueDate: '2026-09-01T00:00:00.000Z', columnId: 'c2', columnCategory: 'DONE' }), // done → never overdue
    ] });
    return json({ data: PROJECT });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProjectDetailPage', () => {
  it('lets a project manager add members, picking from the people directory', async () => {
    renderPage();
    await screen.findByText('MICO Platform');
    await userEvent.click(screen.getByRole('tab', { name: /team/i }));
    const picker = await screen.findByLabelText(/add a member/i);
    expect(within(picker).getByRole('option', { name: 'Sara K' })).toBeInTheDocument();
    expect(calls.some((u) => u.endsWith('/users'))).toBe(false);
  });

  it('opens the board of THIS project', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /open board/i });
    expect(link).toHaveAttribute('href', '/board?project=p1');
  });

  it('counts overdue by company calendar day and never counts finished tasks', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Overdue').previousElementSibling).toHaveTextContent('1'));
    expect(screen.getByText('Completed').previousElementSibling).toHaveTextContent('1');
  });
});
