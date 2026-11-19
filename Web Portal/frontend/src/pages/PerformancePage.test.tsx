import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PerformancePage } from './PerformancePage';
import { useAuthStore } from '../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const kpis = (id: string, name: string) => ({
  person: { id, name, avatarUrl: null, active: true },
  scope: id === 'me' ? 'self' : 'manager',
  projects: [{ id: 'p1', code: 'CON', name: 'Contoso Tower', color: '#2F6DB5', icon: null, imageUrl: null }],
  period: { kind: 'week', from: '2026-11-15', to: '2026-11-21', end: '2026-11-19', label: 'This week' },
  today: '2026-11-19',
  timeZone: 'Asia/Muscat',
  generatedAt: '2026-11-19T06:00:00.000Z',
  trend: { kind: 'week', points: [] },
  tiles: [],
  workload: { openTasks: 3, plannedHours: null, capacityHours: 40, meetingHours: 2 },
});

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.includes('.pdf')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="My performance 2026-11-19.pdf"' } });
      if (url.includes('/kpis/people/me?')) return json({ data: kpis('me', 'Me') });
      if (url.includes('/kpis/people/u1?')) return json({ data: kpis('u1', 'Omar Said') });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/performance/:userId" element={<PerformancePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PerformancePage: Download PDF (1.24.3)', () => {
  it('my own: sends the period shown', async () => {
    renderAt('/performance?period=week');
    await screen.findByText('This week');
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/kpis/people/me/export.pdf?period=week'))).toBe(true));
  });

  it('a person’s: asks for theirs, with a custom period', async () => {
    renderAt('/performance/u1?period=custom&from=2026-11-01&to=2026-11-10');
    await screen.findByText('This week');
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/kpis/people/u1/export.pdf?period=custom&from=2026-11-01&to=2026-11-10'))).toBe(true));
  });
});
