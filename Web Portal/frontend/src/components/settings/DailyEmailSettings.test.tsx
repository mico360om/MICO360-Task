import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyEmailSettings } from './DailyEmailSettings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let prefs: Record<string, unknown> = {};
let emailEnabled = true;
let testReply: () => Response = () => json({ data: { pending: 'sent', completed: 'empty' } });

beforeEach(() => {
  calls = [];
  prefs = { muted: ['TASK_COMMENT'], dailyEmails: { pending: true, completed: true, time: '06:00' } };
  emailEnabled = true;
  testReply = () => json({ data: { pending: 'sent', completed: 'empty' } });
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString(), emailEnabled } });
      if (u.endsWith('/notifications/daily-emails/test')) return testReply();
      if (u.endsWith('/notifications/preferences') && method === 'PUT') {
        prefs = { ...prefs, dailyEmails: { ...(prefs.dailyEmails as object), ...(body?.dailyEmails as object) } };
        return json({ data: prefs });
      }
      if (u.endsWith('/notifications/preferences')) return json({ data: prefs });
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
      <DailyEmailSettings />
    </QueryClientProvider>,
  );
}
const puts = () => calls.filter((c) => c.method === 'PUT');

describe('Settings: daily task emails', () => {
  it('shows both emails on, at 06:00', async () => {
    renderIt();
    expect(await screen.findByRole('switch', { name: 'Pending tasks email' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Completed yesterday email' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Send them at')).toHaveValue('06:00');
  });

  it('turns one email off, saving only the daily email settings', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Completed yesterday email' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ dailyEmails: { pending: true, completed: false, time: '06:00' } });
    expect(screen.getByRole('switch', { name: 'Completed yesterday email' })).toHaveAttribute('aria-checked', 'false');
  });

  it('changes the time when the field is left', async () => {
    renderIt();
    const time = await screen.findByLabelText('Send them at');
    fireEvent.change(time, { target: { value: '07:30' } }); // (jsdom can't type into a time field)
    expect(puts()).toHaveLength(0); // not while it is being changed
    fireEvent.blur(time);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ dailyEmails: { pending: true, completed: true, time: '07:30' } });
  });

  it('sends a test now and says which one had nothing in it', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent the pending tasks email. Nothing was completed yesterday, so there was no completed tasks email to send.');
  });

  it('shows the server’s reason when the test can’t be sent', async () => {
    testReply = () => json({ error: { code: 'TOO_SOON', message: 'A test was just sent. Wait a minute before sending another.' } }, 429);
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute before sending another.');
  });

  it('says so when email isn’t set up on the server, and offers no test', async () => {
    emailEnabled = false;
    renderIt();
    expect(await screen.findByText(/Email isn’t set up on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send me a test now' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Pending tasks email' })).toBeInTheDocument(); // settings can still be chosen
  });
});
