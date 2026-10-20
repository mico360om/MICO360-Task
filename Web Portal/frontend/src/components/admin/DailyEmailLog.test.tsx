import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyEmailLog } from './DailyEmailLog';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const row = (id: string, extra: Record<string, unknown>) => ({
  id, userId: 'u1', day: '2026-10-21', kind: 'PENDING', status: 'SENT', attempts: 1, taskCount: 4, nextAttemptAt: null, lastError: null,
  sentAt: '2026-10-21T02:00:05.000Z', createdAt: '2026-10-21T02:00:00.000Z', updatedAt: '2026-10-21T02:00:05.000Z', userName: 'Ada Lovelace', email: 'ada@mico360.test', ...extra,
});
let urls: string[] = [];
let emailEnabled = true;

beforeEach(() => {
  urls = [];
  emailEnabled = true;
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      urls.push(u);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '2026-10-21T05:00:00.000Z' } });
      if (u.includes('/admin/daily-emails')) {
        const failedOnly = u.includes('status=FAILED');
        return json({
          data: failedOnly
            ? [row('r2', { kind: 'COMPLETED', status: 'FAILED', attempts: 4, taskCount: 0, sentAt: null, lastError: 'HTTP 503', userName: 'Bo Brown', email: 'bo@mico360.test' })]
            : [
                row('r1', {}),
                row('r2', { kind: 'COMPLETED', status: 'FAILED', attempts: 4, taskCount: 0, sentAt: null, lastError: 'HTTP 503', userName: 'Bo Brown', email: 'bo@mico360.test' }),
                row('r3', { kind: 'COMPLETED', status: 'SKIPPED', taskCount: 0, sentAt: null }),
              ],
          meta: { emailEnabled },
        });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DailyEmailLog />
    </QueryClientProvider>,
  );
}

describe('System Settings: the daily task email log', () => {
  it('lists the day’s emails: who, which, how it went, tasks, attempts and any error', async () => {
    renderIt();
    const table = await screen.findByRole('table', { name: 'Daily task emails' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Ada Lovelace.*ada@mico360\.test.*Pending tasks.*Sent.*4/);
    expect(rows[1]).toHaveTextContent(/Bo Brown.*Completed yesterday.*Failed.*4 attempts.*HTTP 503/);
    expect(rows[2]).toHaveTextContent(/Skipped.*nothing to send/i);
    expect(urls.some((u) => /\/admin\/daily-emails\?day=\d{4}-\d{2}-\d{2}/.test(u))).toBe(true); // today, in the company's zone
  });

  it('filters by status', async () => {
    renderIt();
    await screen.findByRole('table', { name: 'Daily task emails' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Daily task emails' })).getAllByRole('row')).toHaveLength(2));
    expect(urls.at(-1)).toContain('status=FAILED');
  });

  it('says when nothing can be sent because email isn’t set up', async () => {
    emailEnabled = false;
    renderIt();
    expect(await screen.findByText(/Email isn’t set up on this server/)).toBeInTheDocument();
  });
});
