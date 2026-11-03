import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingReminderSettings } from './MeetingReminderSettings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let puts: Array<{ url: string; body: { value: unknown } }> = [];
let stored: unknown;
let putAnswer: (() => Response) | null;

beforeEach(() => {
  puts = [];
  stored = undefined;
  putAnswer = null;
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push({ url: u, body });
        if (putAnswer) return putAnswer();
        stored = body.value;
        return json({ data: { key: 'meetings.reminders', value: body.value } });
      }
      return json({ data: stored === undefined ? [] : [{ key: 'meetings.reminders', value: stored }] });
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
      <MeetingReminderSettings />
    </QueryClientProvider>,
  );
}

const amount = (n: number) => screen.getByRole('spinbutton', { name: `Reminder ${n}: how long before the meeting` });
const unit = (n: number) => screen.getByRole('combobox', { name: `Reminder ${n}: minutes, hours or days` });
const email = (n: number) => screen.getByRole('checkbox', { name: `Reminder ${n}: also by email` });

describe('System Settings: Meeting reminders', () => {
  it('shows the defaults: on, 24 hours (also by email), 12 hours and 15 minutes before', async () => {
    renderIt();
    expect(await screen.findByRole('heading', { name: 'Meeting reminders' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toHaveAttribute('aria-checked', 'true');
    expect([amount(1), amount(2), amount(3)].map((i) => (i as HTMLInputElement).value)).toEqual(['24', '12', '15']);
    expect([unit(1), unit(2), unit(3)].map((s) => (s as HTMLSelectElement).value)).toEqual(['hours', 'hours', 'minutes']);
    expect([email(1), email(2), email(3)].map((c) => (c as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(screen.getByText(/the organizer and everyone invited who hasn’t declined/)).toBeInTheDocument();
    // Owner, 3 Nov 2026: a guest invited too late for the emailed ones gets the next reminder by email instead.
    expect(screen.getByText(/invited too late for those get the next reminder by email instead/)).toBeInTheDocument();
  });

  it('the switch saves at once, keeping the times', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Meeting reminders' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.url).toContain('/system-settings/meetings.reminders');
    expect(puts[0]!.body.value).toEqual({ enabled: false, times: [{ minutes: 1440, email: true }, { minutes: 720, email: false }, { minutes: 15, email: false }] });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toHaveAttribute('aria-checked', 'false'));
  });

  it('changes, adds and removes times, then saves them longest first', async () => {
    renderIt();
    await screen.findByRole('heading', { name: 'Meeting reminders' });
    await userEvent.clear(amount(2));
    await userEvent.type(amount(2), '2');
    await userEvent.click(email(3));
    await userEvent.click(screen.getByRole('button', { name: 'Add a reminder time' }));
    await userEvent.clear(amount(4));
    await userEvent.type(amount(4), '3');
    await userEvent.selectOptions(unit(4), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'Remove reminder 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting reminders' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.body.value).toEqual({ enabled: true, times: [{ minutes: 4320, email: false }, { minutes: 120, email: false }, { minutes: 15, email: true }] });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('up to five times, and always one', async () => {
    renderIt();
    await screen.findByRole('heading', { name: 'Meeting reminders' });
    const add = screen.getByRole('button', { name: 'Add a reminder time' });
    await userEvent.click(add);
    await userEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getByText('Up to 5 reminder times.')).toBeInTheDocument();
    for (let i = 5; i > 1; i--) await userEvent.click(screen.getByRole('button', { name: `Remove reminder ${i}` }));
    expect(screen.getByRole('button', { name: 'Remove reminder 1' })).toBeDisabled();
  });

  it('says what to fix and saves nothing (a time outside 5 minutes to 7 days, or the same time twice)', async () => {
    renderIt();
    await screen.findByRole('heading', { name: 'Meeting reminders' });
    await userEvent.clear(amount(3));
    await userEvent.type(amount(3), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting reminders' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Each reminder has to be between 5 minutes and 7 days before the meeting.');
    await userEvent.clear(amount(3));
    await userEvent.type(amount(3), '1');
    await userEvent.selectOptions(unit(3), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting reminders' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Two reminders are at the same time. Change or remove one.');
    expect(puts).toHaveLength(0);
  });

  it('shows the stored times, and the server’s refusal plainly', async () => {
    stored = { enabled: false, times: [{ minutes: 2880, email: true }, { minutes: 30, email: false }] };
    renderIt();
    await waitFor(() => expect((amount(1) as HTMLInputElement).value).toBe('2'));
    expect((unit(1) as HTMLSelectElement).value).toBe('days');
    expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toHaveAttribute('aria-checked', 'false');
    putAnswer = () => json({ error: { code: 'VALIDATION', message: 'Invalid value for meetings.reminders.' } }, 400);
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting reminders' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Those reminder times can’t be saved. Check each time and try again.');
  });

  it('the times are grouped and each row says what it is', async () => {
    renderIt();
    const group = await screen.findByRole('group', { name: 'Reminder times' });
    expect(within(group).getAllByRole('spinbutton')).toHaveLength(3);
    expect(within(group).getAllByText('before')).toHaveLength(3);
  });

  it('nothing can be saved until the stored times are read (a click must never save the defaults over them)', async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r; })));
    renderIt();
    expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save meeting reminders' })).toBeDisabled();
    answer(json({ data: [{ key: 'meetings.reminders', value: { enabled: true, times: [{ minutes: 30, email: false }] } }] }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toBeEnabled());
    expect((amount(1) as HTMLInputElement).value).toBe('30');
  });

  it('when the settings can’t be read, it says so and offers Retry — and saves nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'INTERNAL', message: 'down' } }, 500)));
    renderIt();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the meeting reminders.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Meeting reminders' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save meeting reminders' })).toBeDisabled();
  });

  it('switched off: the times stay readable and it says they wait for the switch', async () => {
    stored = { enabled: false, times: [{ minutes: 15, email: false }] };
    renderIt();
    expect(await screen.findByText('Reminders are off for everyone. These times are kept for when you switch them back on.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reminder times' }).className).not.toMatch(/opacity/);
  });
});
