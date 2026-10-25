import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersPage } from './UsersPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Person = { id: string; username: string; email: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; lastLoginAt: string | null; welcomeSentAt: string | null; locked?: boolean };
const person = (id: string, username: string, o: Partial<Person> = {}): Person => ({ id, username, email: `${username}@x.co`, status: 'ACTIVE', lastLoginAt: null, welcomeSentAt: null, ...o });
const asListed = (list: Person[]) => list.map((p) => ({ ...p, firstName: p.username, lastName: 'T', roles: ['EMPLOYEE'], avatarUrl: null })) as Person[];

const SIGN_OUT = 'Using the link signs them out of MICO360 Tasks on their other devices (the app and the extension too).';

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let people: Person[];
let emailEnabled: boolean;
/** Answers to the welcome posts, by path end. */
let answers: Record<string, () => Response>;

beforeEach(() => {
  // "Now" is 25 Oct 2026 (only the date is pinned: timers stay real for the page).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T06:00:00.000Z'));
  calls = [];
  emailEnabled = true;
  answers = {};
  people = asListed([
    person('u1', 'ada', { lastLoginAt: '2026-10-24T05:12:00.000Z' }),
    person('u2', 'bo', { welcomeSentAt: '2026-10-24T08:00:00.000Z' }),
    person('u3', 'cy', { lastLoginAt: '2026-10-20T07:00:00.000Z' }),
    person('u4', 'di', { status: 'SUSPENDED' }),
    person('u5', 'ed'),
    person('u6', 'fa', { welcomeSentAt: '2026-10-15T08:00:00.000Z' }),
  ]);
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const u = String(url);
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', emailEnabled } });
      for (const [end, answer] of Object.entries(answers)) if (method === 'POST' && u.endsWith(end)) return answer();
      return json({ data: people });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersPage />
    </QueryClientProvider>,
  );
}
const rowOf = (username: string) => screen.getByRole('row', { name: new RegExp(`^(Select )?${username}\\b`) });
const shownNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[1]!.textContent);

describe('User Management: last sign-in', () => {
  it('shows each person’s last sign-in in the company time zone, or "Never signed in", and when a welcome email went', async () => {
    renderPage();
    await screen.findByText('ada');
    expect(screen.getByRole('columnheader', { name: 'Last sign-in' })).toBeInTheDocument();
    expect(within(rowOf('ada')).getByText('24 Oct 2026, 09:12')).toBeInTheDocument();
    expect(within(rowOf('bo')).getByText('Never signed in')).toBeInTheDocument();
    expect(within(rowOf('bo')).getByText('Welcome email sent 24 Oct')).toBeInTheDocument();
    expect(within(rowOf('ada')).queryByText(/welcome email sent/i)).not.toBeInTheDocument();
  });

  it('can show only the people who have never signed in', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Never signed in');
    expect(shownNames()).toEqual(['bo', 'di', 'ed', 'fa']);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Everyone');
    expect(shownNames()).toEqual(['ada', 'bo', 'cy', 'di', 'ed', 'fa']);
  });

  it('the "Never signed in" view with nobody in it says so', async () => {
    people = asListed([person('u1', 'ada', { lastLoginAt: '2026-10-24T05:12:00.000Z' })]);
    renderPage();
    await screen.findByText('ada');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Never signed in');
    expect(screen.getByText('Everyone has signed in at least once.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('can be sorted by last sign-in', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Last sign-in, latest first');
    expect(shownNames()).toEqual(['ada', 'cy', 'bo', 'di', 'ed', 'fa']);
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Last sign-in, earliest first');
    expect(shownNames()).toEqual(['bo', 'di', 'ed', 'fa', 'cy', 'ada']);
  });

  it('a locked account shows a lock drawn as an icon, not an emoji', async () => {
    people = asListed([person('u1', 'ada', { locked: true })]);
    renderPage();
    const badge = await screen.findByText('Locked');
    expect(badge.textContent).not.toContain('🔒');
    expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('User Management: one person’s welcome email', () => {
  it('asks first, with their name, address and what the link does; then sends and says so', async () => {
    answers['/users/u2/welcome-email'] = () => json({ data: { userId: 'u2', username: 'bo', name: 'bo T', email: 'bo@x.co', sent: true } });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Send a welcome email to bo T (bo@x.co)?' });
    expect(within(ask).getByText(SIGN_OUT)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(within(ask).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Welcome email sent to bo (bo@x.co).')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/u2/welcome-email'))).toBe(true);
  });

  it('Cancel sends nothing', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says why when the server refuses it, in the server’s words', async () => {
    answers['/users/u2/welcome-email'] = () => json({ error: { code: 'TOO_SOON', message: 'No welcome email was sent: a welcome email was sent to them less than a minute ago.' } }, 429);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No welcome email was sent: a welcome email was sent to them less than a minute ago.');
  });

  it('a server error says so in the server’s plain words', async () => {
    answers['/users/u2/welcome-email'] = () => json({ error: { code: 'SERVER_ERROR', message: 'No welcome email was sent: something went wrong on the server (try again).' } }, 500);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No welcome email was sent: something went wrong on the server (try again).');
  });

  it('can’t be used, and says why, for your own row, an inactive or suspended account, or one with no email; a locked one can', async () => {
    people = asListed([
      person('me', 'admin', { lastLoginAt: '2026-10-24T05:12:00.000Z' }),
      person('u1', 'gone', { status: 'INACTIVE' }),
      person('u2', 'held', { status: 'SUSPENDED' }),
      person('u3', 'noemail', { email: '' }),
      person('u4', 'locked', { locked: true }),
    ]);
    renderPage();
    await screen.findByText('gone');
    const button = (name: string) => screen.getByRole('button', { name: `Send welcome email to ${name}` });
    expect(button('admin')).toBeDisabled();
    expect(button('admin')).toHaveAttribute('title', 'You can’t send yourself a welcome email');
    expect(button('gone')).toBeDisabled();
    expect(button('gone')).toHaveAttribute('title', 'This account is inactive, so it can’t get a welcome email');
    expect(button('held')).toBeDisabled();
    expect(button('held')).toHaveAttribute('title', 'This account is suspended, so it can’t get a welcome email');
    expect(button('noemail')).toBeDisabled();
    expect(button('noemail')).toHaveAttribute('title', 'This account has no email address');
    expect(button('locked')).toBeEnabled();
  });

  it('on a phone the row button is just an envelope, with the same name for screen readers', async () => {
    renderPage();
    await screen.findByText('ada');
    const button = screen.getByRole('button', { name: 'Send welcome email to bo' });
    expect(button.querySelector('svg[aria-hidden="true"]')).toHaveClass('sm:hidden');
    expect(within(button).getByText('Send welcome email')).toHaveClass('hidden', 'sm:inline');
  });
});

describe('User Management: welcome emails to several people', () => {
  it('"Everyone who has never signed in" leaves out people sent one in the last 7 days, asks with the count, names and what the link does, then shows what happened', async () => {
    answers['/users/welcome-emails'] = () =>
      json({
        data: {
          sent: 1,
          notSent: 1,
          results: [
            { userId: 'u5', username: 'ed', name: 'ed T', email: 'ed@x.co', sent: true },
            { userId: 'u6', username: 'fa', name: 'fa T', email: 'fa@x.co', sent: false, reason: 'EMAIL_BLOCKED', why: 'emails to this address are blocked (it bounced or was marked as spam)' },
          ],
        },
      });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Select everyone who has never signed in' }));
    // Active and never signed in: bo (sent one yesterday: left out), ed, fa (sent one 10 days ago). di is suspended.
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select bo' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select ed' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select fa' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select di' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Send welcome emails to 2 people?' });
    expect(within(dialog).getByText('To: ed T, fa T.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Each gets their username and a link to set their password, valid for 7 days\./)).toBeInTheDocument();
    expect(within(dialog).getByText(SIGN_OUT)).toBeInTheDocument();
    expect(within(dialog).getByText('1 person was sent one in the last 7 days and is left out.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/users/welcome-emails'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    const notice = await screen.findByRole('status', { name: /sent 1/i });
    expect(notice).toHaveTextContent('Sent 1. 1 not sent:');
    expect(within(notice).getByRole('listitem')).toHaveTextContent('fa: emails to this address are blocked (it bounced or was marked as spam)');
    expect(calls.find((c) => c.url.endsWith('/users/welcome-emails'))?.body).toEqual({ userIds: ['u5', 'u6'] });
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('people ticked by hand are sent whatever their last welcome email (the row shows when it went), and no “left out” line', async () => {
    answers['/users/welcome-emails'] = () => json({ data: { sent: 2, notSent: 0, results: [] } });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select bo' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select cy' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/left out/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent 2.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/users/welcome-emails'))?.body).toEqual({ userIds: ['u2', 'u3'] });
  });

  it('a filter keeps what was picked, and the question names people filtered off the page', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select ada' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select ed' }));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Never signed in');
    expect(screen.queryByText('ada')).not.toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    expect(within(await screen.findByRole('alertdialog')).getByText('To: ada T, ed T.')).toBeInTheDocument();
  });

  it('names at most 10 people in the question, then how many more', async () => {
    people = asListed(Array.from({ length: 12 }, (_, i) => person(`p${i}`, `person${i}`)));
    renderPage();
    await screen.findByText('person0');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everyone shown' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Send welcome emails to 12 people?' });
    expect(within(dialog).getByText(/^To: person0 T, person1 T, .*, person9 T and 2 more\.$/)).toBeInTheDocument();
  });

  it('a result listing two people the same way doesn’t confuse the list (no duplicate keys)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const why = 'something went wrong on the server (try again)';
    answers['/users/welcome-emails'] = () =>
      json({ data: { sent: 0, notSent: 2, results: [{ userId: 'x1', username: null, name: null, email: null, sent: false, reason: 'NOT_FOUND', why }, { userId: 'x2', username: null, name: null, email: null, sent: false, reason: 'NOT_FOUND', why }] } });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select ada' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }));
    const notice = await screen.findByRole('alert', { name: /sent 0/i });
    expect(within(notice).getAllByRole('listitem')).toHaveLength(2);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
  });

  it('select all shown, and clear', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everyone shown' }));
    expect(screen.getByText('6 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('more than 100 picked: says to choose fewer, and Send can’t be used', async () => {
    people = asListed(Array.from({ length: 101 }, (_, i) => person(`p${i}`, `person${i}`)));
    renderPage();
    await screen.findByText('person0');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everyone shown' }));
    expect(screen.getByText('101 selected')).toBeInTheDocument();
    expect(screen.getByText('You can send up to 100 welcome emails at a time. Choose fewer people.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send welcome emails' })).toBeDisabled();
  });

  it('when email isn’t set up, says so plainly and the send buttons can’t be used', async () => {
    emailEnabled = false;
    renderPage();
    await screen.findByText('ada');
    expect(await screen.findByText('Email isn’t set up on this server, so welcome emails can’t be sent. An administrator needs to add the email (Mailjet) keys.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send welcome email to bo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select everyone who has never signed in' })).toBeDisabled();
  });
});

describe('User Management: adding a user with a welcome email', () => {
  async function addSara() {
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/last name/i), 'K');
    await userEvent.type(screen.getByLabelText(/username/i), 'sara');
    await userEvent.type(screen.getByLabelText(/^email/i), 'sara@x.co');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
  }

  it('the page says whether it went', async () => {
    answers['/users'] = () => json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.co', sent: true } } }, 201);
    renderPage();
    await screen.findByText('ada');
    await addSara();
    expect(await screen.findByText('sara’s account is ready. Welcome email sent to sara@x.co.')).toBeInTheDocument();
  });

  it('when it didn’t go, the page says why', async () => {
    answers['/users'] = () =>
      json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.co', sent: false, reason: 'EMAIL_BLOCKED', why: 'emails to this address are blocked (it bounced or was marked as spam)' } } }, 201);
    renderPage();
    await screen.findByText('ada');
    await addSara();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'sara’s account is ready, but the welcome email wasn’t sent: emails to this address are blocked (it bounced or was marked as spam).',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
