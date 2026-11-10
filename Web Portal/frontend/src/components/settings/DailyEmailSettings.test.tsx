import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyEmailSettings } from './DailyEmailSettings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
const ALL_ON = { pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: true, priority: true, comingUp: true, projects: true };
const ALL_OFF = { pending: false, completed: false, time: '06:00', schedule: false, urgent: false, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false };
/** The redesign's parts, in the email's order. */
const PARTS = ['Today at a glance', 'This week', 'By priority', 'Overdue and due today', 'Coming up', 'Other open tasks', 'Today’s meetings', 'Completed yesterday', 'Your projects', 'Others’ overdue and waiting tasks'];
let prefs: Record<string, unknown> = {};
let emailEnabled = true;
let testReply: () => Response = () => json({ data: { daily: 'sent', pending: 'sent', completed: 'sent' } });
const PREVIEW = { subject: 'Today: 1 overdue — Wed 4 Nov', html: '<!DOCTYPE html><html><body><h1>Good morning, Ada</h1></body></html>', text: 'Good morning, Ada', empty: false };
let previewReply: () => Response = () => json({ data: PREVIEW });

beforeEach(() => {
  calls = [];
  prefs = { muted: ['TASK_COMMENT'], dailyEmails: { ...ALL_ON } };
  emailEnabled = true;
  testReply = () => json({ data: { daily: 'sent', pending: 'sent', completed: 'sent' } });
  previewReply = () => json({ data: PREVIEW });
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
      if (u.includes('/notifications/daily-emails/preview')) return previewReply();
      if (u.endsWith('/notifications/preferences') && method === 'PUT') {
        prefs = { ...prefs, dailyEmails: { ...(prefs.dailyEmails as object), ...(body?.dailyEmails as object) } };
        return json({ data: prefs });
      }
      if (u.endsWith('/notifications/preferences')) return json({ data: prefs });
      if (u.endsWith('/users/me/preferences')) return json({ data: { timeZone: 'Asia/Dubai', weekStart: null } });
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

describe('Settings: the daily email (1.22: one email, in parts)', () => {
  it('shows the email on, every part on (in the email’s order), and its time', async () => {
    renderIt();
    expect(await screen.findByRole('switch', { name: 'Send me the daily email' })).toHaveAttribute('aria-checked', 'true');
    for (const part of PARTS) expect(screen.getByRole('switch', { name: part })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('switch').slice(1).map((sw) => sw.getAttribute('aria-label'))).toEqual(PARTS);
    expect(screen.getByRole('button', { name: 'Send it at: 06:00' })).toHaveTextContent('06:00');
  });

  it('turns one part off, saving the daily email settings only', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Completed yesterday' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    // The website says it knows every part, so the server saves them as they are.
    expect(puts()[0]!.body).toEqual({ dailyEmails: { ...ALL_ON, completed: false, knowsAllParts: true } });
    expect(screen.getByRole('switch', { name: 'Completed yesterday' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Send me the daily email' })).toHaveAttribute('aria-checked', 'true');
  });

  it('the whole email off — every part off, and said so — and on again', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Send me the daily email' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ dailyEmails: { ...ALL_OFF, knowsAllParts: true } });
    expect(await screen.findByText('You get no daily email. Turn on any part to get it again.')).toBeInTheDocument();
    for (const part of PARTS) expect(screen.getByRole('switch', { name: part })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(screen.getByRole('switch', { name: 'Send me the daily email' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]!.body).toEqual({ dailyEmails: { ...ALL_ON, knowsAllParts: true } });
  });

  it('changes the time from the site’s 24-hour list', async () => {
    renderIt();
    const time = await screen.findByRole('button', { name: 'Send it at: 06:00' });
    await waitFor(() => expect(time).toBeEnabled());
    await userEvent.click(time);
    expect(screen.getByRole('option', { name: '13:45' })).toBeInTheDocument(); // 24-hour, never "1:45 PM"
    await userEvent.click(screen.getByRole('option', { name: '07:30' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ dailyEmails: { ...ALL_ON, time: '07:30', knowsAllParts: true } });
  });

  it('names the time zone it goes in, with links to change it and the notification settings', async () => {
    const { container } = renderIt();
    expect(await screen.findByText(/In your time zone, Asia\/Dubai\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change the time zone' })).toHaveAttribute('href', '#time-zone');
    expect(screen.getByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '#notifications');
    expect(container.querySelector('section#daily-email')).not.toBeNull(); // the email's own links open it here
  });

  it('"Send me a test" sends the real email now and says so', async () => {
    renderIt();
    // 44 px on a touch screen: the important form, or the site's global 32 px rule for buttons wins.
    expect((await screen.findByRole('button', { name: 'Send me a test' })).className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent your daily email as it is now. Check your inbox.');
    expect(calls.filter((c) => c.url.endsWith('/notifications/daily-emails/test') && c.method === 'POST')).toHaveLength(1);
  });

  it('says when there is nothing in it, so nothing was sent', async () => {
    testReply = () => json({ data: { daily: 'empty', pending: 'empty', completed: 'empty' } });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('There’s nothing in your daily email right now, so no test was sent.');
  });

  it('says plainly when the address is blocked, and never that it was sent', async () => {
    testReply = () => json({ data: { daily: 'blocked', pending: 'blocked', completed: 'blocked' } });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent: your email address is blocked after a bounce or spam complaint. Ask an administrator to check it.');
    expect(screen.queryByText(/^Sent /)).not.toBeInTheDocument();
  });

  it('shows the server’s reason when the test can’t be sent (one a minute)', async () => {
    testReply = () => json({ error: { code: 'TOO_SOON', message: 'A test was just sent. Wait a minute before sending another.' } }, 429);
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute before sending another.');
  });

  it('says so when email isn’t set up on the server, and offers no test', async () => {
    emailEnabled = false;
    renderIt();
    expect(await screen.findByText(/Email isn’t set up on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send me a test' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Send me the daily email' })).toBeInTheDocument(); // settings can still be chosen
  });
});

describe('Settings: the daily email — the redesign’s parts', () => {
  it('a new part turns off on its own, saving every part as it is (the server keeps the new parts the website sends)', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'By priority' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ dailyEmails: { ...ALL_ON, priority: false, knowsAllParts: true } });
  });

  it('settings from a server before the redesign (no new parts): the new ones show on', async () => {
    prefs = { muted: [], dailyEmails: { pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true } };
    renderIt();
    expect(await screen.findByRole('switch', { name: 'Your projects' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Settings: "Preview my email" (everyone, owner 10 Nov)', () => {
  it('beside "Send me a test": opens your own email as it is now, in a sandboxed frame, at a computer\u2019s or a phone\u2019s width', async () => {
    renderIt();
    const button = await screen.findByRole('button', { name: 'Preview my email' });
    // 44 px on a touch screen, like "Send me a test".
    expect(button.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Your daily email' });
    expect(await within(dialog).findByText('Today: 1 overdue — Wed 4 Nov')).toBeInTheDocument();
    const frame = within(dialog).getByTitle('Your daily email as it is now') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('Good morning, Ada');
    // Only ever your own: the request names no one.
    const asked = calls.filter((c) => c.url.includes('/notifications/daily-emails/preview'));
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toMatch(/\/notifications\/daily-emails\/preview$/);
    expect(asked[0]!.method).toBe('GET');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Phone' }));
    expect(frame.style.width).toBe('375px');
    expect(within(dialog).getByRole('region', { name: 'Email preview' })).toHaveAttribute('tabindex', '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Nothing was sent.
    expect(calls.filter((c) => c.url.endsWith('/notifications/daily-emails/test'))).toHaveLength(0);
  });

  it('works before email is set up (it sends nothing)', async () => {
    emailEnabled = false;
    renderIt();
    expect(await screen.findByText(/Email isn\u2019t set up on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send me a test' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview my email' })).toBeEnabled();
  });

  it('nothing in it right now: says so', async () => {
    previewReply = () => json({ data: { subject: null, html: null, text: null, empty: true } });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview my email' }));
    expect(await screen.findByText(/There\u2019s nothing in your daily email right now/)).toBeInTheDocument();
  });
});
