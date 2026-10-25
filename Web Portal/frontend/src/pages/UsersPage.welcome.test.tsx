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

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let people: Person[];
let emailEnabled: boolean;
/** Answers to the welcome posts, by path end. */
let answers: Record<string, () => Response>;

beforeEach(() => {
  calls = [];
  emailEnabled = true;
  answers = {};
  people = [
    person('u1', 'ada', { lastLoginAt: '2026-10-24T05:12:00.000Z' }),
    person('u2', 'bo', { welcomeSentAt: '2026-10-24T08:00:00.000Z' }),
    person('u3', 'cy', { lastLoginAt: '2026-10-20T07:00:00.000Z' }),
    person('u4', 'di', { status: 'SUSPENDED' }),
    person('u5', 'ed'),
  ].map((p) => ({ ...p, firstName: p.username, lastName: 'T', roles: ['EMPLOYEE'], avatarUrl: null })) as Person[];
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
    expect(shownNames()).toEqual(['bo', 'di', 'ed']);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Everyone');
    expect(shownNames()).toEqual(['ada', 'bo', 'cy', 'di', 'ed']);
  });

  it('can be sorted by last sign-in', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Last sign-in, latest first');
    expect(shownNames()).toEqual(['ada', 'cy', 'bo', 'di', 'ed']);
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Last sign-in, earliest first');
    expect(shownNames()).toEqual(['bo', 'di', 'ed', 'cy', 'ada']);
  });
});

describe('User Management: welcome emails', () => {
  it('sends one person a welcome email from their row, and says so', async () => {
    answers['/users/u2/welcome-email'] = () => json({ data: { userId: 'u2', username: 'bo', name: 'bo T', email: 'bo@x.co', sent: true } });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    expect(await screen.findByText('Welcome email sent to bo (bo@x.co).')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/u2/welcome-email'))).toBe(true);
  });

  it('says why when the server refuses one', async () => {
    answers['/users/u4/welcome-email'] = () => json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'No welcome email was sent: the account is suspended.' } }, 409);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to di' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No welcome email was sent: the account is suspended.');
  });

  it('a server error says so in the server’s plain words', async () => {
    answers['/users/u2/welcome-email'] = () => json({ error: { code: 'SERVER_ERROR', message: 'No welcome email was sent: something went wrong on the server (try again).' } }, 500);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome email to bo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No welcome email was sent: something went wrong on the server (try again).');
  });

  it('"Everyone who has never signed in": asks first with the count, then shows what happened per person', async () => {
    answers['/users/welcome-emails'] = () =>
      json({
        data: {
          sent: 1,
          notSent: 1,
          results: [
            { userId: 'u2', username: 'bo', name: 'bo T', email: 'bo@x.co', sent: true },
            { userId: 'u5', username: 'ed', name: 'ed T', email: 'ed@x.co', sent: false, reason: 'EMAIL_BLOCKED', why: 'emails to this address are blocked (it bounced or was marked as spam)' },
          ],
        },
      });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: 'Select everyone who has never signed in' }));
    // The active people who never signed in (di is suspended).
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select bo' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select di' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Send welcome emails to 2 people?' });
    expect(within(dialog).getByText(/Each gets their username and a link to set their password, valid for 7 days\./)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/users/welcome-emails'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    const notice = await screen.findByRole('status', { name: /sent 1/i });
    expect(notice).toHaveTextContent('Sent 1. 1 not sent:');
    expect(within(notice).getByRole('listitem')).toHaveTextContent('ed: emails to this address are blocked (it bounced or was marked as spam)');
    expect(calls.find((c) => c.url.endsWith('/users/welcome-emails'))?.body).toEqual({ userIds: ['u2', 'u5'] });
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('chosen people: tick them, then send (the dialog can be backed out of)', async () => {
    answers['/users/welcome-emails'] = () => json({ data: { sent: 2, notSent: 0, results: [] } });
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select ada' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select cy' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send welcome emails' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent 2.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/users/welcome-emails'))?.body).toEqual({ userIds: ['u1', 'u3'] });
  });

  it('select all shown, and clear', async () => {
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everyone shown' }));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('more than 100 picked: says to choose fewer, and Send can’t be used', async () => {
    people = Array.from({ length: 101 }, (_, i) => ({ ...person(`p${i}`, `person${i}`), firstName: `person${i}`, lastName: 'T', roles: ['EMPLOYEE'], avatarUrl: null })) as Person[];
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

  it('a new user with a welcome email: the page says whether it went', async () => {
    answers['/users'] = () => json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.co', sent: true } } }, 201);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/last name/i), 'K');
    await userEvent.type(screen.getByLabelText(/username/i), 'sara');
    await userEvent.type(screen.getByLabelText(/^email/i), 'sara@x.co');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(await screen.findByText('sara’s account is ready. Welcome email sent to sara@x.co.')).toBeInTheDocument();
  });

  it('a new user whose welcome email didn’t go: the page says why', async () => {
    answers['/users'] = () =>
      json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.co', sent: false, reason: 'EMAIL_BLOCKED', why: 'emails to this address are blocked (it bounced or was marked as spam)' } } }, 201);
    renderPage();
    await screen.findByText('ada');
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/last name/i), 'K');
    await userEvent.type(screen.getByLabelText(/username/i), 'sara');
    await userEvent.type(screen.getByLabelText(/^email/i), 'sara@x.co');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'sara’s account is ready, but the welcome email wasn’t sent: emails to this address are blocked (it bounced or was marked as spam).',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
