import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyEmailLog } from './DailyEmailLog';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const emailOf = (extra: Record<string, unknown> = {}) => ({ on: true, state: 'DUE', dueAt: null, sentAt: null, taskCount: 0, attempts: 0, nextAttemptAt: null, lastError: null, ...extra });
const PEOPLE = [
  {
    userId: 'u-ada', name: 'Ada Lovelace', email: 'ada@mico360.test', timeZone: 'Asia/Muscat', ownTimeZone: false, time: '07:00', day: '2026-10-21',
    pending: emailOf({ state: 'SENT', sentAt: '2026-10-21T03:01:00.000Z', taskCount: 4, attempts: 1 }),
    completed: emailOf({ state: 'SKIPPED', attempts: 1 }),
  },
  {
    userId: 'u-bo', name: 'Bo Brown', email: 'bo@mico360.test', timeZone: 'Asia/Kolkata', ownTimeZone: true, time: '16:00', day: '2026-10-21',
    pending: emailOf({ state: 'DUE', dueAt: '2026-10-21T10:30:00.000Z' }),
    completed: emailOf({ on: false, state: 'OFF' }),
  },
  {
    userId: 'u-fay', name: 'Fay Fisher', email: 'fay@mico360.test', timeZone: 'Asia/Muscat', ownTimeZone: false, time: '06:00', day: '2026-10-21',
    pending: emailOf({ state: 'FAILED', attempts: 4, lastError: 'HTTP 503' }),
    completed: emailOf({ state: 'RETRY', attempts: 2, nextAttemptAt: '2026-10-21T06:00:00.000Z', lastError: 'Timed out' }),
  },
];

interface Call { url: string; method: string; body: unknown; headers: Record<string, string> }
let calls: Call[] = [];
let overview: Record<string, unknown> = {};
let sendNowReply: () => Response = () => json({ data: {} });
let sendReply: (body: { userId: string; kind: string; resend: boolean }) => Response = () => json({ data: {} });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T05:45:00Z')); // 09:45 in Muscat
  calls = [];
  overview = {
    day: null,
    lastCheckedAt: '2026-10-21T05:41:00.000Z',
    nextSendAt: '2026-10-21T10:30:00.000Z',
    emailEnabled: true,
    summary: { people: 3, sent: 1, skipped: 1, failed: 1, retrying: 1, sending: 0, upcoming: 1, toSend: 2 },
    people: PEOPLE,
  };
  sendNowReply = () => json({ data: { sent: 9, skipped: 2, failed: 1, retrying: 1, alreadyDone: 4, off: 3 } });
  sendReply = (b) => json({ data: { userId: b.userId, name: 'Bo Brown', email: 'bo@mico360.test', day: '2026-10-21', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url: u, method, body, headers });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '2026-10-21T05:45:00.000Z' } });
      if (u.includes('/admin/daily-emails/overview')) return json({ data: overview });
      if (u.includes('/admin/daily-emails/send-now')) return sendNowReply();
      if (u.includes('/admin/daily-emails/send')) return sendReply(body);
      if (u.includes('/admin/daily-emails/preview')) {
        return json({
          data: {
            userId: 'u-ada', name: 'Ada Lovelace', email: 'ada@mico360.test', kind: 'PENDING', day: '2026-10-21', on: true,
            subject: 'Your pending tasks: 4', text: 'Good morning, Ada Lovelace\n\n- Check the <b>pump</b> (RIG-1, Rig)', taskCount: 4, empty: false,
          },
        });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
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
const overviewCalls = () => calls.filter((c) => c.url.includes('/admin/daily-emails/overview'));
const personItem = async (name: string) => {
  const list = await screen.findByRole('list', { name: 'Everyone and their daily emails' });
  return within(list).getAllByRole('listitem').find((li) => li.textContent?.includes(name))!;
};

describe('System Settings → Daily task emails: today’s summary', () => {
  it('the day’s numbers, when the server last checked and the next send — each person’s own today', async () => {
    renderIt();
    const summary = await screen.findByRole('region', { name: 'Today’s summary' });
    expect(summary).toHaveTextContent(/People\s*3/);
    expect(summary).toHaveTextContent(/Sent\s*1/);
    expect(summary).toHaveTextContent(/Skipped\s*1/);
    expect(summary).toHaveTextContent(/Failed\s*1/);
    expect(summary).toHaveTextContent(/Retrying\s*1/);
    expect(summary).toHaveTextContent(/Still to come\s*1/);
    expect(summary).toHaveTextContent('Server last checked: 09:41');
    expect(summary).toHaveTextContent('Next send: today at 14:30');
    expect(overviewCalls()[0]!.url).toMatch(/\/admin\/daily-emails\/overview$/); // no day: each person's today
  });

  it('an answer it can’t read (an older server, a proxy page) says it couldn’t load — nothing breaks', async () => {
    overview = [{ key: 'companyName', value: 'x' }] as unknown as Record<string, unknown>;
    renderIt();
    expect(await screen.findByText(/Couldn’t load the daily emails/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Daily task emails' })).toBeInTheDocument();
  });

  it('opened from a link to #daily-emails (the extension’s “Daily email log”): shows the section and starts Tab there', async () => {
    window.location.hash = '#daily-emails';
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      const { container } = renderIt();
      await screen.findByRole('list', { name: 'Everyone and their daily emails' });
      expect(container.querySelector('section#daily-emails')).not.toBeNull();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Daily task emails' })).toHaveFocus());
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      window.location.hash = '';
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('says so when the server hasn’t checked since it started', async () => {
    overview = { ...overview, lastCheckedAt: null };
    renderIt();
    expect(await screen.findByText('Server last checked: not since the server started')).toBeInTheDocument();
  });

  it('email not set up: the warning, and nothing can be sent — a preview still can', async () => {
    overview = { ...overview, emailEnabled: false };
    renderIt();
    expect(await screen.findByText(/Email isn’t set up on this server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send today’s emails now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send Bo Brown’s Pending tasks email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend Ada Lovelace’s Pending tasks email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Ada Lovelace’s Pending tasks email' })).toBeEnabled();
  });
});

describe('System Settings → Daily task emails: send today’s emails now', () => {
  it('asks first, sends once and says how it went', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send today’s emails now' }));
    const ask = screen.getByRole('alertdialog', { name: 'Send today’s emails now to 2 people?' });
    expect(ask).toHaveTextContent('Anyone who already got today’s won’t get them again.');
    const before = overviewCalls().length;
    await user.click(within(ask).getByRole('button', { name: 'Send now' }));
    const line = await screen.findByText('Sent 9 emails. 2 had nothing to send. 1 couldn’t be sent; it will be tried again. 4 were already done today.');
    expect(line).toHaveAttribute('role', 'status'); // read out when it appears
    const posts = calls.filter((c) => c.url.includes('/send-now'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.method).toBe('POST');
    expect(posts[0]!.headers['idempotency-key']).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send today’s emails now' })).toHaveFocus(); // back where it was
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThan(before)); // the list is read again
  });

  it('not now: nothing is sent and focus goes back to the button', async () => {
    const user = userEvent.setup();
    renderIt();
    const button = await screen.findByRole('button', { name: 'Send today’s emails now' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/send-now'))).toBe(false);
    expect(button).toHaveFocus();
  });

  it('shows the server’s words when it can’t (too soon)', async () => {
    sendNowReply = () => json({ error: { code: 'TOO_SOON', message: 'Today’s emails were just sent. Wait a minute before sending them again.' } }, 429);
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send today’s emails now' }));
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Today’s emails were just sent. Wait a minute before sending them again.');
  });

  it('nobody left to send to: says so instead', async () => {
    overview = { ...overview, summary: { ...(overview.summary as object), toSend: 0 } };
    renderIt();
    // aria-disabled, not disabled: right after a send it stays focusable, so focus isn't lost.
    expect(await screen.findByRole('button', { name: 'Send today’s emails now' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Everyone has had today’s emails.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send today’s emails now' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('System Settings → Daily task emails: everyone and their settings', () => {
  it('one row per person: each email on or off, the send time and time zone, and today’s state', async () => {
    renderIt();
    const list = await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const ada = await personItem('Ada Lovelace');
    expect(ada).toHaveTextContent('ada@mico360.test');
    expect(ada).toHaveTextContent('Sends at 07:00, company time (Asia/Muscat)');
    expect(ada).toHaveTextContent(/Pending tasks\s*On/);
    expect(ada).toHaveTextContent('Sent at 07:01 · 4 tasks');
    expect(ada).toHaveTextContent('Skipped — nothing to send');
    const bo = await personItem('Bo Brown');
    expect(bo).toHaveTextContent('Sends at 16:00, their own time zone (Asia/Kolkata)');
    expect(bo).toHaveTextContent('Still to come at 16:00');
    expect(bo).toHaveTextContent(/Completed yesterday\s*Off/);
    expect(bo).toHaveTextContent('Turned off');
    const fay = await personItem('Fay Fisher');
    expect(fay).toHaveTextContent('Failed after 4 attempts: HTTP 503');
    expect(fay).toHaveTextContent('Retrying at 10:00 (2 attempts so far): Timed out');
  });

  it('Send: that person’s email now, and how it went', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Bo Brown’s Pending tasks email' }));
    const bo = await personItem('Bo Brown');
    await waitFor(() => expect(bo).toHaveTextContent('Sent the Pending tasks email to Bo Brown.'));
    const post = calls.find((c) => c.url.endsWith('/admin/daily-emails/send'))!;
    expect(post.body).toEqual({ userId: 'u-bo', kind: 'PENDING', resend: false });
    expect(post.headers['idempotency-key']).toBeTruthy();
  });

  it('Resend asks first, saying when they got it; not sending puts focus back', async () => {
    const user = userEvent.setup();
    renderIt();
    const resend = await screen.findByRole('button', { name: 'Resend Ada Lovelace’s Pending tasks email' });
    await user.click(resend);
    await user.click(within(screen.getByRole('alertdialog', { name: 'They already got it at 07:01. Send again?' })).getByRole('button', { name: 'Don’t send' }));
    expect(calls.some((c) => c.url.endsWith('/admin/daily-emails/send'))).toBe(false);
    expect(resend).toHaveFocus();
    await user.click(resend);
    await user.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/admin/daily-emails/send'))?.body).toEqual({ userId: 'u-ada', kind: 'PENDING', resend: true }));
  });

  it('a turned-off email can’t be sent, and says why', async () => {
    renderIt();
    const button = await screen.findByRole('button', { name: 'Send Bo Brown’s Completed yesterday email' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Bo Brown turned this email off.');
  });

  it('the server’s words when it refuses a send', async () => {
    sendReply = () => json({ error: { code: 'EMAIL_TURNED_OFF', message: 'Bo Brown turned off the “Pending tasks” email, so it can’t be sent.' } }, 409);
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Bo Brown’s Pending tasks email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bo Brown turned off the “Pending tasks” email, so it can’t be sent.');
  });

  it('Preview: the subject and the text as it would be sent now — shown as text; focus goes back after', async () => {
    const user = userEvent.setup();
    renderIt();
    const open = await screen.findByRole('button', { name: 'Preview Ada Lovelace’s Pending tasks email' });
    await user.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Pending tasks email for Ada Lovelace' });
    expect(dialog).toHaveTextContent('As it would be sent now');
    expect(await within(dialog).findByText('Your pending tasks: 4')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('To: ada@mico360.test');
    expect(dialog).toHaveTextContent('- Check the <b>pump</b> (RIG-1, Rig)');
    expect(dialog.querySelector('b')).toBeNull(); // never turned into HTML
    expect(calls.find((c) => c.url.includes('/preview'))!.url).toContain('userId=u-ada&kind=PENDING');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('filters: by status, by name or email, and another day', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    let names = within(screen.getByRole('list', { name: 'Everyone and their daily emails' })).getAllByRole('listitem').map((li) => li.querySelector('h3')?.textContent);
    expect(names).toEqual(['Fay Fisher']);
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.type(screen.getByLabelText('Find a person'), 'bo@');
    names = within(screen.getByRole('list', { name: 'Everyone and their daily emails' })).getAllByRole('listitem').map((li) => li.querySelector('h3')?.textContent);
    expect(names).toEqual(['Bo Brown']);
    await user.clear(screen.getByLabelText('Find a person'));
    await user.type(screen.getByLabelText('Find a person'), 'nobody');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
    const dayField = screen.getByLabelText('Day');
    dayField.focus();
    fireEvent.change(dayField, { target: { value: '2026-10-20' } });
    await waitFor(() => expect(overviewCalls().at(-1)!.url).toContain('/admin/daily-emails/overview?day=2026-10-20'));
    expect(screen.getByLabelText('Day')).toBe(dayField); // the field stays while the other day loads
    expect(dayField).toHaveFocus();
    expect(await screen.findByRole('region', { name: 'Summary for Tue 20 Oct' })).toBeInTheDocument();
  });
});
