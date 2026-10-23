import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyEmailLog } from './DailyEmailLog';
import { useAuthStore } from '../../stores/auth-store';
import { clearUserStorage } from '../../lib/user-storage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const emailOf = (extra: Record<string, unknown> = {}) => ({ on: true, state: 'DUE', dueAt: null, sentAt: null, taskCount: 0, attempts: 0, nextAttemptAt: null, lastError: null, ...extra });
const personOf = (extra: Record<string, unknown>) => ({ ownTimeZone: false, day: '2026-10-21', today: '2026-10-21', due: true, account: 'active', ...extra });
const PEOPLE = [
  personOf({
    userId: 'u-ada', name: 'Ada Lovelace', email: 'ada@mico360.test', timeZone: 'Asia/Muscat', time: '07:00',
    pending: emailOf({ state: 'SENT', sentAt: '2026-10-21T03:01:00.000Z', taskCount: 4, attempts: 1 }),
    completed: emailOf({ state: 'SKIPPED', attempts: 1 }),
  }),
  personOf({
    userId: 'u-bo', name: 'Bo Brown', email: 'bo@mico360.test', timeZone: 'Asia/Kolkata', ownTimeZone: true, time: '16:00', due: false,
    pending: emailOf({ state: 'DUE', dueAt: '2026-10-21T10:30:00.000Z' }),
    completed: emailOf({ on: false, state: 'OFF' }),
  }),
  personOf({
    userId: 'u-fay', name: 'Fay Fisher', email: 'fay@mico360.test', timeZone: 'Asia/Muscat', time: '06:00',
    pending: emailOf({ state: 'FAILED', attempts: 4, lastError: 'HTTP 503' }),
    completed: emailOf({ state: 'RETRY', attempts: 2, nextAttemptAt: '2026-10-21T06:00:00.000Z', lastError: 'Timed out' }),
  }),
];
const COUNTS = { sent: 0, skipped: 0, blocked: 0, failed: 0, retrying: 0, alreadyDone: 0, sending: 0, off: 0, notYet: 0, errors: 0 };
const runOf = (extra: Record<string, unknown> = {}) => ({ running: true, startedAt: '2026-10-21T05:45:00.000Z', finishedAt: null, total: 2, done: 0, counts: COUNTS, error: null, ...extra });

interface Call { url: string; method: string; body: unknown; headers: Record<string, string> }
let calls: Call[] = [];
let overview: Record<string, unknown> = {};
let overviewReply: () => Response | Promise<Response> = () => json({ data: overview });
let sendNowReply: () => Response | Promise<Response> = () => json({ data: {} });
let sendReply: (body: { userId: string; kind: string; resend: boolean; early?: boolean }) => Response = () => json({ data: {} });

/** A reply the test lets go of later (a slow server). */
function held() {
  let release!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { release = r; });
  return { reply: () => promise, release };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T05:45:00Z')); // 09:45 in Muscat
  calls = [];
  overview = {
    day: null,
    lastCheckedAt: '2026-10-21T05:41:00.000Z',
    checkLate: false,
    nextSendAt: '2026-10-21T10:30:00.000Z',
    run: null,
    emailEnabled: true,
    summary: { people: 3, sent: 1, skipped: 1, failed: 1, retrying: 1, sending: 0, late: 0, upcoming: 1, toSend: 2 },
    people: PEOPLE,
  };
  overviewReply = () => json({ data: overview });
  sendNowReply = () => json({ data: runOf() }, 202);
  sendReply = (b) => json({ data: { userId: b.userId, name: 'Bo Brown', email: 'bo@mico360.test', day: '2026-10-21', time: '16:00', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
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
      if (u.includes('/admin/daily-emails/overview')) return overviewReply();
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
  localStorage.clear();
});

function renderIt(props: { pollMs?: number } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DailyEmailLog {...props} />
    </QueryClientProvider>,
  );
}
const overviewCalls = () => calls.filter((c) => c.url.includes('/admin/daily-emails/overview'));
const personItem = async (name: string) => {
  const list = await screen.findByRole('list', { name: 'Everyone and their daily emails' });
  return within(list).getAllByRole('listitem').find((li) => li.textContent?.includes(name))!;
};
const shownNames = () => within(screen.getByRole('list', { name: 'Everyone and their daily emails' })).getAllByRole('listitem').map((li) => li.querySelector('h3')?.textContent);
const withPeople = (people: unknown[], extra: Record<string, unknown> = {}) => {
  overview = { ...overview, people, ...extra };
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
    expect(summary).toHaveTextContent(/Late\s*0/);
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

  it('says so when the server has never checked', async () => {
    overview = { ...overview, lastCheckedAt: null };
    renderIt();
    expect(await screen.findByText('Server last checked: not yet')).toBeInTheDocument();
  });

  it('says plainly when the server hasn’t checked for a while although emails are due (it was asleep)', async () => {
    overview = { ...overview, lastCheckedAt: '2026-10-20T19:59:00.000Z', checkLate: true, summary: { ...(overview.summary as object), late: 2 } };
    renderIt();
    expect(await screen.findByText('The server hasn’t checked since Tue 20 Oct, 23:59 — emails due since then haven’t gone.')).toBeInTheDocument();
  });

  it('email not set up: the warning, and nothing can be sent — a preview still can', async () => {
    overview = { ...overview, emailEnabled: false };
    renderIt();
    const warning = await screen.findByText(/Email isn’t set up on this server/);
    expect(screen.getByRole('button', { name: 'Send today’s emails now' })).toBeDisabled();
    const send = screen.getByRole('button', { name: 'Send Bo Brown’s Pending tasks email' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(warning.textContent!);
    expect(screen.getByRole('button', { name: 'Resend Ada Lovelace’s Pending tasks email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Ada Lovelace’s Pending tasks email' })).toBeEnabled();
  });

  it('a refresh that fails keeps what was shown, with a small note — the list stays', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    overviewReply = () => json({ error: { code: 'ERROR', message: 'Bad gateway' } }, 502);
    await user.click(screen.getByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' })); // a send, then the list is read again
    expect(await screen.findByText(/Couldn’t refresh the list/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Everyone and their daily emails' })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load the daily emails/)).not.toBeInTheDocument();
    overviewReply = () => json({ data: overview });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh the list/)).not.toBeInTheDocument());
  });
});

describe('System Settings → Daily task emails: send today’s emails now', () => {
  it('asks first; the question closes at once and the emails go in the background, with how far it has got', async () => {
    const slow = held();
    sendNowReply = slow.reply;
    const user = userEvent.setup();
    renderIt({ pollMs: 20 });
    await user.click(await screen.findByRole('button', { name: 'Send today’s emails now' }));
    const ask = screen.getByRole('alertdialog', { name: 'Send today’s emails now to 2 people?' });
    expect(ask).toHaveTextContent('Anyone who already got today’s won’t get them again.');
    expect(ask).toHaveTextContent('Only emails whose time has come are sent');
    await user.click(within(ask).getByRole('button', { name: 'Send now' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); // closed at once, the server still answering
    expect(screen.getByRole('button', { name: 'Send today’s emails now' })).toHaveFocus();
    overview = { ...overview, run: runOf({ total: 120, done: 34 }) };
    slow.release(json({ data: runOf({ total: 120, done: 0 }) }, 202));
    expect(await screen.findByText('Sending today’s emails… 34 of 120 people done.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send today’s emails now' })).toHaveAttribute('aria-disabled', 'true');
    const posts = calls.filter((c) => c.url.includes('/send-now'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers['idempotency-key']).toBeTruthy();
    // It ends: how it went, read out.
    overview = { ...overview, run: runOf({ running: false, total: 120, done: 120, finishedAt: '2026-10-21T05:47:00.000Z', counts: { ...COUNTS, sent: 9, skipped: 2, failed: 1, retrying: 1, alreadyDone: 4 } }) };
    const line = await screen.findByText('Today’s emails: sent 9 emails. 2 had nothing to send. 1 couldn’t be sent; it will be tried again. 4 were already done today.');
    expect(line).toHaveAttribute('role', 'status');
    expect(screen.getByText(/Last sent by hand at 09:47/)).toBeInTheDocument();
  });

  it('while it runs it refreshes by itself, and stops once it has finished', async () => {
    overview = { ...overview, run: runOf({ total: 3, done: 1 }) };
    renderIt({ pollMs: 20 });
    await screen.findByText('Sending today’s emails… 1 of 3 people done.');
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThanOrEqual(3));
    overview = { ...overview, run: runOf({ running: false, total: 3, done: 3, finishedAt: '2026-10-21T05:46:00.000Z' }) };
    await screen.findByText(/Last sent by hand at 09:46/);
    const settled = overviewCalls().length;
    await new Promise((r) => setTimeout(r, 120));
    expect(overviewCalls().length).toBe(settled);
  });

  it('a server that takes too long to answer (502/504) may still be sending: says so', async () => {
    sendNowReply = () => json({ error: { code: 'ERROR', message: 'Gateway Timeout' } }, 504);
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send today’s emails now' }));
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server took too long to answer. Today’s emails may still be sending — check the list in a minute.');
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
    expect(screen.getByText('No emails are waiting to be sent right now.')).toBeInTheDocument();
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

  it('late emails, and a blocked address, are said plainly', async () => {
    withPeople([
      personOf({ ...PEOPLE[0], pending: emailOf({ state: 'LATE', dueAt: '2026-10-21T03:00:00.000Z' }), completed: emailOf({ state: 'SKIPPED', lastError: 'Address blocked after a bounce or spam complaint.' }) }),
    ]);
    renderIt();
    const ada = await personItem('Ada Lovelace');
    expect(ada).toHaveTextContent('Due since 07:00 — not sent yet');
    expect(ada).toHaveTextContent('Skipped — Address blocked after a bounce or spam complaint.');
  });

  it('Send: that person’s email now, and how it went', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    const fay = await personItem('Fay Fisher');
    await waitFor(() => expect(fay).toHaveTextContent('Sent the Pending tasks email to Bo Brown.'));
    const post = calls.find((c) => c.url.endsWith('/admin/daily-emails/send'))!;
    expect(post.body).toEqual({ userId: 'u-fay', kind: 'PENDING', resend: false });
    expect(post.headers['idempotency-key']).toBeTruthy();
  });

  it('before the person’s time: asks first, and sends early only when told to', async () => {
    const user = userEvent.setup();
    renderIt();
    const send = await screen.findByRole('button', { name: 'Send Bo Brown’s Pending tasks email' });
    await user.click(send);
    const ask = screen.getByRole('alertdialog', { name: 'It isn’t Bo Brown’s time yet. Send it now?' });
    expect(ask).toHaveTextContent('Their emails go at 16:00, their time.');
    await user.click(within(ask).getByRole('button', { name: 'Wait' }));
    expect(calls.some((c) => c.url.endsWith('/admin/daily-emails/send'))).toBe(false);
    expect(send).toHaveFocus();
    await user.click(send);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send now' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/admin/daily-emails/send'))?.body).toEqual({ userId: 'u-bo', kind: 'PENDING', resend: false, early: true }));
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

  it('a Send that can’t be used says why in words on the page (not only in a tooltip)', async () => {
    renderIt();
    const button = await screen.findByRole('button', { name: 'Send Bo Brown’s Completed yesterday email' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAccessibleDescription('Bo Brown turned this email off.');
    expect(screen.getByText('Bo Brown turned this email off.')).not.toHaveClass('sr-only');
  });

  it('the server’s words when it refuses a send', async () => {
    sendReply = () => json({ error: { code: 'EMAIL_TURNED_OFF', message: 'Fay Fisher turned off the “Pending tasks” email, so it can’t be sent.' } }, 409);
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fay Fisher turned off the “Pending tasks” email, so it can’t be sent.');
  });

  it('a send the server takes too long to answer may still be going: says so', async () => {
    sendReply = () => json({ error: { code: 'ERROR', message: 'Bad Gateway' } }, 502);
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server took too long to answer. The email may still be sending — check the list in a minute.');
  });

  it('a blocked address: says it wasn’t sent, and why', async () => {
    sendReply = (b) => json({ data: { userId: b.userId, name: 'Fay Fisher', email: 'fay@mico360.test', day: '2026-10-21', time: '06:00', results: [{ kind: b.kind, outcome: 'blocked', error: 'Address blocked after a bounce or spam complaint.', sentAt: null }] } });
    const user = userEvent.setup();
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent: Fay Fisher’s address is blocked after a bounce or spam complaint.');
  });

  it('a card acted on stays under the filter (marked) until the filter changes; the result is read out from the section and focus stays', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    expect(shownNames()).toEqual(['Fay Fisher']);
    sendReply = (b) => {
      // Sent: Fay no longer has a failed email.
      withPeople([PEOPLE[0], PEOPLE[1], { ...PEOPLE[2], pending: emailOf({ state: 'SENT', sentAt: '2026-10-21T05:45:00.000Z', taskCount: 2, attempts: 5 }) }]);
      return json({ data: { userId: b.userId, name: 'Fay Fisher', email: 'fay@mico360.test', day: '2026-10-21', time: '06:00', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
    };
    const send = screen.getByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' });
    await user.click(send);
    const fay = await personItem('Fay Fisher');
    await waitFor(() => expect(fay).toHaveTextContent('Sent at 09:45 · 2 tasks'));
    expect(fay).toHaveTextContent('No longer matches the filter');
    expect(shownNames()).toEqual(['Fay Fisher']);
    expect(within(fay).getByRole('button', { name: 'Resend Fay Fisher’s Pending tasks email' })).toHaveFocus();
    const results = screen.getByRole('status', { name: 'Send results' });
    expect(results).toHaveTextContent('Sent the Pending tasks email to Fay Fisher.');
    // Choosing the filter again: only what matches it.
    await user.selectOptions(screen.getByLabelText('Status'), 'RETRY');
    expect(shownNames()).toEqual(['Fay Fisher']); // her completed email is retrying
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
  });

  it('refreshes by itself while an email is being sent', async () => {
    withPeople([PEOPLE[0], { ...PEOPLE[2], pending: emailOf({ state: 'SENDING', attempts: 1 }) }]);
    renderIt({ pollMs: 20 });
    expect(await screen.findByText('Being sent now…')).toBeInTheDocument();
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThanOrEqual(3));
  });

  it('records of people no longer active stay visible, marked, with nothing to send or preview', async () => {
    withPeople([
      PEOPLE[0],
      personOf({ userId: 'u-zed', name: 'Zed Zane', email: 'zed@mico360.test', timeZone: 'Asia/Muscat', time: '', account: 'inactive', due: false,
        pending: emailOf({ on: false, state: 'SENT', sentAt: '2026-10-21T02:00:00.000Z', taskCount: 3, attempts: 1 }), completed: emailOf({ on: false, state: 'NONE' }) }),
    ]);
    renderIt();
    const zed = await personItem('Zed Zane');
    expect(zed).toHaveTextContent('No longer active');
    expect(zed).toHaveTextContent('Sent at 06:00 · 3 tasks');
    expect(zed).not.toHaveTextContent(/\bOff\b/);
    const send = within(zed).getByRole('button', { name: 'Resend Zed Zane’s Pending tasks email' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('No longer active, so nothing can be sent.');
    expect(within(zed).getByRole('button', { name: 'Preview Zed Zane’s Pending tasks email' })).toBeDisabled();
  });

  it('a person’s own day shows when it isn’t the company’s; their emails can be sent for their own today', async () => {
    const eve = personOf({ userId: 'u-eve', name: 'Eve Evans', email: 'eve@mico360.test', timeZone: 'America/New_York', ownTimeZone: true, time: '06:00', day: '2026-10-20', today: '2026-10-20',
      pending: emailOf({ state: 'LATE', dueAt: '2026-10-20T10:00:00.000Z' }), completed: emailOf({ state: 'LATE', dueAt: '2026-10-20T10:00:00.000Z' }) });
    withPeople([PEOPLE[0], eve]);
    renderIt();
    expect(await personItem('Eve Evans')).toHaveTextContent('Their day: Tue 20 Oct');
    expect(await personItem('Ada Lovelace')).not.toHaveTextContent('Their day');
    // Another day (20 Oct): it is still Eve’s today, so hers can be sent; Ada’s can’t.
    withPeople([{ ...PEOPLE[0], day: '2026-10-20', pending: emailOf({ state: 'NONE' }), completed: emailOf({ state: 'NONE' }) }, eve], { day: '2026-10-20' });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-20' } });
    await screen.findByRole('region', { name: 'Summary for Tue 20 Oct' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send Eve Evans’s Pending tasks email' })).toBeEnabled());
    const ada = screen.getByRole('button', { name: 'Send Ada Lovelace’s Pending tasks email' });
    expect(ada).toBeDisabled();
    expect(ada).toHaveAccessibleDescription('Emails can only be sent for each person’s own today.');
    expect(screen.getByText('Emails can only be sent for each person’s own today.')).toBeVisible();
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
    expect(shownNames()).toEqual(['Fay Fisher']);
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.type(screen.getByLabelText('Find a person'), 'bo@');
    expect(shownNames()).toEqual(['Bo Brown']);
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
    expect(screen.getByRole('option', { name: 'Late (due, not sent yet)' })).toBeInTheDocument();
  });
});

describe('System Settings → Daily task emails: pages', () => {
  const two = (n: number) => String(n).padStart(2, '0');
  /** n people, "Person 01"…, in the server's order; `extra` changes one by their number. */
  const crowd = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: n }, (_, k) =>
      personOf({
        userId: `u-${two(k + 1)}`, name: `Person ${two(k + 1)}`, username: `p${two(k + 1)}`, email: `p${two(k + 1)}@mico360.test`,
        timeZone: 'Asia/Muscat', time: '07:00', pending: emailOf(), completed: emailOf(), ...extra(k + 1),
      }),
    );
  const names = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => `Person ${two(from + k)}`);
  const pager = () => screen.getByRole('navigation', { name: 'Pages of people' });
  const listNote = () => screen.getByRole('status', { name: 'What the list shows' });
  const button = (name: string) => within(pager()).getByRole('button', { name });
  const loaded = () => screen.findByRole('list', { name: 'Everyone and their daily emails' });

  it('20 or fewer people: all of them, with no pages', async () => {
    withPeople(crowd(20));
    renderIt();
    await loaded();
    expect(shownNames()).toEqual(names(1, 20));
    expect(screen.queryByRole('navigation', { name: 'Pages of people' })).not.toBeInTheDocument();
  });

  it('20 people a page, with Previous and Next and where you are; a new page starts at its first person', async () => {
    withPeople(crowd(63));
    const user = userEvent.setup();
    renderIt();
    await loaded();
    expect(shownNames()).toEqual(names(1, 20));
    expect(pager()).toHaveTextContent('Showing 1–20 of 63 people');
    expect(pager()).toHaveTextContent('Page 1 of 4');
    expect(button('Previous')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Next')).not.toHaveAttribute('aria-disabled');

    await user.click(button('Next'));
    expect(shownNames()).toEqual(names(21, 40));
    expect(pager()).toHaveTextContent('Showing 21–40 of 63 people');
    expect(pager()).toHaveTextContent('Page 2 of 4');
    expect(screen.getByRole('heading', { name: 'Person 21' })).toHaveFocus();
    await waitFor(() => expect(listNote()).toHaveTextContent('Showing 21 to 40 of 63 people. Page 2 of 4.'));
    expect(button('Previous')).not.toHaveAttribute('aria-disabled');

    await user.click(button('Next'));
    await user.click(button('Next'));
    expect(shownNames()).toEqual(names(61, 63));
    expect(pager()).toHaveTextContent('Showing 61–63 of 63 people');
    expect(button('Next')).toHaveAttribute('aria-disabled', 'true');
    await user.click(button('Next')); // the last page: nothing further
    expect(pager()).toHaveTextContent('Page 4 of 4');

    await user.click(button('Previous'));
    expect(shownNames()).toEqual(names(41, 60));
    expect(screen.getByRole('heading', { name: 'Person 41' })).toHaveFocus();
  });

  it('People per page: 20, 50 or 100, remembered in this browser; choosing keeps focus on the choice', async () => {
    withPeople(crowd(63));
    const user = userEvent.setup();
    const { unmount } = renderIt();
    await loaded();
    const per = screen.getByLabelText('People per page');
    expect(per).toHaveDisplayValue('20');
    expect(within(per).getAllByRole('option').map((o) => o.textContent)).toEqual(['20', '50', '100']);
    await user.selectOptions(per, '50');
    expect(shownNames()).toEqual(names(1, 50));
    expect(pager()).toHaveTextContent('Showing 1–50 of 63 people');
    expect(pager()).toHaveTextContent('Page 1 of 2');
    expect(per).toHaveFocus();
    await waitFor(() => expect(listNote()).toHaveTextContent('Showing 1 to 50 of 63 people. Page 1 of 2.'));
    await user.selectOptions(per, '100');
    expect(pager()).toHaveTextContent('Showing all 63 people');
    expect(within(pager()).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument(); // one page: nothing to move between
    unmount();
    clearUserStorage(); // signing out keeps it too

    renderIt();
    await loaded();
    expect(screen.getByLabelText('People per page')).toHaveDisplayValue('100');
    expect(shownNames()).toHaveLength(63);
  });

  it('a choice it can’t read, or storage that is blocked (a private window): 20 a page, and choosing still works', async () => {
    localStorage.setItem('mico360.u.a1.daily-emails.perPage', '7');
    withPeople(crowd(30));
    const user = userEvent.setup();
    const { unmount } = renderIt();
    await loaded();
    expect(screen.getByLabelText('People per page')).toHaveDisplayValue('20');
    unmount();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderIt();
    await loaded();
    expect(screen.getByLabelText('People per page')).toHaveDisplayValue('20');
    await user.selectOptions(screen.getByLabelText('People per page'), '50');
    expect(shownNames()).toEqual(names(1, 30));
  });

  it('a search, the status, the email, the page size or another day goes back to page 1', async () => {
    withPeople(crowd(63));
    const user = userEvent.setup();
    renderIt();
    await loaded();
    const toPage2 = async () => {
      await user.click(button('Next'));
      expect(pager()).toHaveTextContent(/Page 2 of/);
    };
    await toPage2();
    await user.type(screen.getByLabelText('Find a person'), 'person');
    expect(pager()).toHaveTextContent('Page 1 of 4');
    expect(shownNames()[0]).toBe('Person 01');
    await toPage2();
    await user.selectOptions(screen.getByLabelText('Status'), 'DUE');
    expect(pager()).toHaveTextContent('Page 1 of 4');
    await toPage2();
    await user.selectOptions(screen.getByLabelText('Email'), 'PENDING');
    expect(pager()).toHaveTextContent('Page 1 of 4');
    await toPage2();
    await user.selectOptions(screen.getByLabelText('People per page'), '50');
    expect(pager()).toHaveTextContent('Page 1 of 2');
    await toPage2();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-20' } });
    await screen.findByRole('region', { name: 'Summary for Tue 20 Oct' });
    expect(pager()).toHaveTextContent('Page 1 of 2');
    expect(shownNames()[0]).toBe('Person 01');
  });

  it('a list that shrinks under the last page shows the new last page, and stays there if it grows again', async () => {
    withPeople(crowd(41, () => ({ pending: emailOf({ state: 'SENDING', attempts: 1 }) }))); // being sent: it refreshes by itself
    const user = userEvent.setup();
    renderIt({ pollMs: 20 });
    await loaded();
    await user.selectOptions(screen.getByLabelText('Status'), 'SENDING');
    await user.click(button('Next'));
    await user.click(button('Next'));
    expect(shownNames()).toEqual(['Person 41']);
    // Person 41's went: two pages now.
    const sent = emailOf({ state: 'SENT', sentAt: '2026-10-21T05:45:00.000Z', taskCount: 1, attempts: 1 });
    withPeople(crowd(41, (i) => ({ pending: i === 41 ? sent : emailOf({ state: 'SENDING', attempts: 1 }) })));
    await waitFor(() => expect(pager()).toHaveTextContent('Page 2 of 2'));
    expect(shownNames()).toEqual(names(21, 40));
    // Back to sending (a retry): still page 2, not back to page 3.
    withPeople(crowd(41, () => ({ pending: emailOf({ state: 'SENDING', attempts: 2 }) })));
    await waitFor(() => expect(pager()).toHaveTextContent('Page 2 of 3'));
    expect(shownNames()).toEqual(names(21, 40));
  });

  it('a send on page 2 keeps the page and the card where they are, though others change meanwhile', async () => {
    // The 26th is "Person 10a" (between 10 and 11), whose email hasn't failed; everyone else’s has.
    const people = crowd(26, (i) => (i === 26 ? { name: 'Person 10a' } : { pending: emailOf({ state: 'FAILED', attempts: 4, lastError: 'HTTP 503' }) }));
    withPeople([...people.slice(0, 10), people[25], ...people.slice(10, 25)]);
    const user = userEvent.setup();
    renderIt();
    await loaded();
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    expect(pager()).toHaveTextContent('Showing 1–20 of 25 people');
    await user.click(button('Next'));
    expect(shownNames()).toEqual(names(21, 25));

    const sent = emailOf({ state: 'SENT', sentAt: '2026-10-21T05:45:00.000Z', taskCount: 1, attempts: 5 });
    sendReply = (b) => {
      // Person 21's went; meanwhile Person 01's and 02's were sent too, and Person 10a's failed.
      withPeople((overview.people as Array<{ userId: string }>).map((p) =>
        ['u-01', 'u-02', 'u-21'].includes(p.userId) ? { ...p, pending: sent } : p.userId === 'u-26' ? { ...p, pending: emailOf({ state: 'FAILED', attempts: 4 }) } : p,
      ));
      return json({ data: { userId: b.userId, name: 'Person 21', email: 'p21@mico360.test', day: '2026-10-21', time: '07:00', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
    };
    await user.click(screen.getByRole('button', { name: 'Send Person 21’s Pending tasks email' }));
    const p21 = await personItem('Person 21');
    await waitFor(() => expect(p21).toHaveTextContent('Sent at 09:45 · 1 task'));
    expect(p21).toHaveTextContent('No longer matches the filter.');
    expect(within(p21).getByRole('button', { name: 'Resend Person 21’s Pending tasks email' })).toHaveFocus();
    expect(shownNames().slice(0, 5)).toEqual(names(21, 25)); // nothing moved
    expect(shownNames().at(-1)).toBe('Person 10a'); // someone who has just started to match comes at the end
    expect(pager()).toHaveTextContent('Showing 21–26 of 26 people');
    expect(pager()).toHaveTextContent('Page 2 of 2');

    // Another filter: only what matches, in order, from page 1.
    await user.selectOptions(screen.getByLabelText('Status'), 'SENT');
    expect(shownNames()).toEqual(['Person 01', 'Person 02', 'Person 21']);
  });
});

describe('System Settings → Daily task emails: what the list says', () => {
  const note = () => screen.getByRole('status', { name: 'What the list shows' });
  const loaded = () => screen.findByRole('list', { name: 'Everyone and their daily emails' });
  const sendFay = () => {
    sendReply = (b) => {
      withPeople([PEOPLE[0], PEOPLE[1], { ...PEOPLE[2], pending: emailOf({ state: 'SENT', sentAt: '2026-10-21T05:45:00.000Z', taskCount: 2, attempts: 5 }) }]);
      return json({ data: { userId: b.userId, name: 'Fay Fisher', email: 'fay@mico360.test', day: '2026-10-21', time: '06:00', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
    };
  };

  it('cards kept in view that no longer match: the count doesn’t say “no one” above them; “Send today’s emails now” lets go of them', async () => {
    const user = userEvent.setup();
    renderIt();
    await loaded();
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    sendFay();
    await user.click(screen.getByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    const fay = await personItem('Fay Fisher');
    await waitFor(() => expect(fay).toHaveTextContent('Sent at 09:45 · 2 tasks'));
    expect(fay).toHaveTextContent('No longer matches the filter.');
    expect(screen.getByText('No one else matches now')).toBeInTheDocument();
    expect(screen.queryByText('No one matches')).not.toBeInTheDocument();
    // Sending everyone's now: the list shows what matches as it goes.
    await user.click(screen.getByRole('button', { name: 'Send today’s emails now' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send now' }));
    expect(await screen.findByText('No one matches these filters.')).toBeInTheDocument();
  });

  it('the same words are read out again after another change (another email; another day with as many people)', async () => {
    const user = userEvent.setup();
    renderIt();
    await loaded();
    await user.selectOptions(screen.getByLabelText('Email'), 'PENDING');
    await waitFor(() => expect(note()).toHaveTextContent('Showing all 3 people.'));
    await user.selectOptions(screen.getByLabelText('Email'), 'COMPLETED');
    expect(note().textContent).toBe(''); // emptied at once, so the same words are new again
    await waitFor(() => expect(note()).toHaveTextContent('Showing all 3 people.'));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-20' } });
    expect(note().textContent).toBe('');
    await screen.findByRole('region', { name: 'Summary for Tue 20 Oct' });
    await waitFor(() => expect(note()).toHaveTextContent('Showing all 3 people.'));
  });

  it('a list that refreshes by itself (something being sent) reads nothing out', async () => {
    const sending = emailOf({ state: 'SENDING', attempts: 1 });
    withPeople([PEOPLE[0], { ...PEOPLE[2], pending: sending }]);
    const user = userEvent.setup();
    renderIt({ pollMs: 20 });
    await loaded();
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThanOrEqual(3));
    expect(note().textContent).toBe('');
    await user.selectOptions(screen.getByLabelText('Status'), 'SENDING');
    await waitFor(() => expect(note()).toHaveTextContent('1 person matches.'));
    // Ada's is being sent too now: the list and its count change by themselves, quietly.
    withPeople([{ ...PEOPLE[0], pending: sending }, { ...PEOPLE[2], pending: sending }]);
    expect(await screen.findByText('2 people match')).toBeInTheDocument();
    const seen = overviewCalls().length;
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThanOrEqual(seen + 3));
    await new Promise((r) => setTimeout(r, 450)); // longer than the read-out waits
    expect(note()).toHaveTextContent('1 person matches.');
  });
});

describe('System Settings → Daily task emails: one email at a time', () => {
  const kindsShown = (li: HTMLElement) => within(li).queryAllByRole('button', { name: /^Preview / }).map((b) => b.getAttribute('aria-label'));

  it('Email: Pending tasks or Completed yesterday shows only that email on each card; Both shows the two', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    const email = screen.getByLabelText('Email');
    expect(email).toHaveDisplayValue('Both');
    expect(within(email).getAllByRole('option').map((o) => o.textContent)).toEqual(['Both', 'Pending tasks', 'Completed yesterday']);
    expect(kindsShown(await personItem('Ada Lovelace'))).toEqual(['Preview Ada Lovelace’s Pending tasks email', 'Preview Ada Lovelace’s Completed yesterday email']);
    await user.selectOptions(email, 'PENDING');
    const ada = await personItem('Ada Lovelace');
    expect(kindsShown(ada)).toEqual(['Preview Ada Lovelace’s Pending tasks email']);
    expect(ada).not.toHaveTextContent('Skipped — nothing to send'); // her completed email’s row
    expect(shownNames()).toEqual(['Ada Lovelace', 'Bo Brown', 'Fay Fisher']); // still everyone
    await user.selectOptions(email, 'COMPLETED');
    expect(kindsShown(await personItem('Bo Brown'))).toEqual(['Preview Bo Brown’s Completed yesterday email']);
    expect(await personItem('Bo Brown')).toHaveTextContent('Turned off');
    await user.selectOptions(email, '');
    expect(kindsShown(await personItem('Fay Fisher'))).toHaveLength(2);
  });

  it('the status then applies to the chosen email only', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    expect(shownNames()).toEqual(['Fay Fisher']); // her pending email failed
    await user.selectOptions(screen.getByLabelText('Email'), 'COMPLETED');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument(); // her completed one is retrying
    await user.selectOptions(screen.getByLabelText('Status'), 'RETRY');
    expect(shownNames()).toEqual(['Fay Fisher']);
    await user.selectOptions(screen.getByLabelText('Email'), 'PENDING');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'SENT');
    expect(shownNames()).toEqual(['Ada Lovelace']);
    expect(screen.getByText('1 person matches')).toBeInTheDocument();
  });

  it('a card acted on under the chosen email stays, marked, until a filter changes', async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.selectOptions(screen.getByLabelText('Email'), 'PENDING');
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    sendReply = (b) => {
      withPeople([PEOPLE[0], PEOPLE[1], { ...PEOPLE[2], pending: emailOf({ state: 'SENT', sentAt: '2026-10-21T05:45:00.000Z', taskCount: 2, attempts: 5 }) }]);
      return json({ data: { userId: b.userId, name: 'Fay Fisher', email: 'fay@mico360.test', day: '2026-10-21', time: '06:00', results: [{ kind: b.kind, outcome: 'sent', error: null, sentAt: '2026-10-21T05:45:00.000Z' }] } });
    };
    await user.click(screen.getByRole('button', { name: 'Send Fay Fisher’s Pending tasks email' }));
    const fay = await personItem('Fay Fisher');
    await waitFor(() => expect(fay).toHaveTextContent('Sent at 09:45 · 2 tasks'));
    expect(fay).toHaveTextContent('No longer matches the filter.');
    expect(within(fay).getByRole('button', { name: 'Resend Fay Fisher’s Pending tasks email' })).toHaveFocus();
    // Another email chosen: only what matches (neither of hers has failed now).
    await user.selectOptions(screen.getByLabelText('Email'), '');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
  });
});

describe('System Settings → Daily task emails: finding a person', () => {
  const someone = (userId: string, name: string, username: string, email: string) =>
    personOf({ userId, name, username, email, timeZone: 'Asia/Muscat', time: '07:00', pending: emailOf(), completed: emailOf() });
  const FOUR = [
    someone('u-jp', 'João Pereira', 'jpereira', 'jp@mico360.test'),
    someone('u-rm', 'Rachel Moss', 'rmoss', 'rachel.m@mico360.test'),
    someone('u-rs', 'Rachel Souza', 'rsouza', 'rs@mico360.test'),
    someone('u-sk', 'Sam Kerr', 'skerr', 'sam@mico360.test'),
  ];
  const find = () => screen.getByLabelText('Find a person');

  it('by name, username or email; every word must match, in any order; capitals and accents don’t matter', async () => {
    withPeople(FOUR);
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.type(find(), 'skerr');
    expect(shownNames()).toEqual(['Sam Kerr']); // the username
    await user.clear(find());
    await user.type(find(), '@skerr');
    expect(shownNames()).toEqual(['Sam Kerr']); // as the card shows it
    await user.clear(find());
    await user.type(find(), 'souza rachel');
    expect(shownNames()).toEqual(['Rachel Souza']);
    await user.clear(find());
    await user.type(find(), 'RACHEL');
    expect(shownNames()).toEqual(['Rachel Moss', 'Rachel Souza']);
    await user.clear(find());
    await user.type(find(), 'joao');
    expect(shownNames()).toEqual(['João Pereira']);
    await user.clear(find());
    await user.type(find(), 'rachel pereira');
    expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
    expect(find()).toHaveAttribute('placeholder', 'Name, username or email');
  });

  it('says how many people match the search or the status', async () => {
    withPeople(FOUR);
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    expect(screen.queryByText(/match/)).not.toBeInTheDocument(); // nothing to say without a filter
    await user.type(find(), 'rachel');
    expect(screen.getByText('2 people match')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status', { name: 'What the list shows' })).toHaveTextContent('2 people match.')); // read out too
    await user.type(find(), ' moss');
    expect(screen.getByText('1 person matches')).toBeInTheDocument();
    await user.clear(find());
    await user.selectOptions(screen.getByLabelText('Status'), 'DUE');
    expect(screen.getByText('4 people match')).toBeInTheDocument();
  });

  it('shows each person’s username by their email address', async () => {
    withPeople(FOUR);
    renderIt();
    expect(await personItem('Sam Kerr')).toHaveTextContent('@skerr · sam@mico360.test');
  });

  it('someone with no username (an older server): just their email, no “@…”', async () => {
    withPeople([personOf({ ...FOUR[3], username: undefined })]);
    renderIt();
    const sam = await personItem('Sam Kerr');
    expect(within(sam).getByText(/sam@mico360\.test/).textContent).toBe('sam@mico360.test');
  });

  it('accents either way round, and Arabic names with or without their vowel marks', async () => {
    // The same name with its short-vowel marks (fatha, damma, shadda), and without them.
    const marked = 'م\u064fح\u064eم\u0651\u064eد علي';
    withPeople([
      someone('u-jp', 'João Pereira', 'jpereira', 'jp@mico360.test'),
      someone('u-js', 'Joao Silva', 'jsilva', 'js@mico360.test'),
      someone('u-ma', marked, 'mali', 'ma@mico360.test'),
      someone('u-ms', 'محمد سالم', 'msalem', 'ms@mico360.test'),
    ]);
    const user = userEvent.setup();
    renderIt();
    await screen.findByRole('list', { name: 'Everyone and their daily emails' });
    await user.type(find(), 'joão');
    expect(shownNames()).toEqual(['João Pereira', 'Joao Silva']);
    await user.clear(find());
    await user.type(find(), 'محمد');
    expect(shownNames()).toEqual([marked, 'محمد سالم']);
    await user.clear(find());
    await user.type(find(), 'م\u064fح\u064eم\u0651\u064eد');
    expect(shownNames()).toEqual([marked, 'محمد سالم']);
  });
});
