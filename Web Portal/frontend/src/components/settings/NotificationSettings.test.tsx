import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationSettings } from './NotificationSettings';
import { personPolicy } from '../../test/notify-policy';
import type { NotificationPreferences } from '../../api/notifications';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let prefs: NotificationPreferences;
let policy: ReturnType<typeof personPolicy>;
let bodies: Record<string, unknown>[];

beforeEach(() => {
  prefs = { muted: [] };
  policy = personPolicy();
  bodies = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  // Wednesday 11 Nov 2026, 15:00 in Muscat.
  vi.setSystemTime(new Date('2026-11-11T11:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/notifications/preferences') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      prefs = { ...prefs, ...(body as Partial<NotificationPreferences>) };
      if (body.pauseUntil === null) delete prefs.pauseUntil;
      if (body.quietHours === null) delete prefs.quietHours;
      return json({ data: prefs });
    }
    if (u.includes('/notifications/preferences')) return json({ data: prefs });
    if (u.includes('/notifications/policy')) return json({ data: policy });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
}

describe('Settings → Notifications: each kind × channel', () => {
  it('shows the company’s defaults: bell and phone on, email only for escalations to admins and @mentions', async () => {
    renderCard();
    expect(await screen.findByRole('switch', { name: 'Overdue tasks: in the app' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Overdue tasks: phone push' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Overdue tasks: email' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: '@mentions: email' })).toHaveAttribute('aria-checked', 'true');
    // Meeting reminders' email follows the company's reminder times: no switch here.
    expect(screen.queryByRole('switch', { name: 'Meeting reminders: email' })).toBeNull();
  });

  it('locks the bell and phone of a kind the company requires (email stays theirs)', async () => {
    policy = personPolicy({ required: ['overdue'] });
    renderCard();
    expect(await screen.findByRole('switch', { name: 'Overdue tasks: in the app' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Overdue tasks: phone push' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Overdue tasks: email' })).not.toBeDisabled();
    expect(screen.getByText('Required by your company')).toBeInTheDocument();
  });

  it('shows a reminder the company turned off as off, and can’t be switched', async () => {
    policy = personPolicy({ off: ['inactivity'] });
    renderCard();
    const bell = await screen.findByRole('switch', { name: 'Tasks with no activity: in the app' });
    expect(bell).toHaveAttribute('aria-checked', 'false');
    expect(bell).toBeDisabled();
    expect(screen.getByText('Off for your company')).toBeInTheDocument();
  });

  it('a phone push needs the bell: with the bell off its phone switch is off and locked', async () => {
    policy = personPolicy({ current: { comments: { bell: false, push: false } } });
    renderCard();
    const push = await screen.findByRole('switch', { name: 'Comments: phone push' });
    expect(push).toHaveAttribute('aria-checked', 'false');
    expect(push).toBeDisabled();
  });

  it('saves only the channel switched', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('switch', { name: 'Comments: email' }));
    await waitFor(() => expect(bodies).toEqual([{ channels: { comments: { email: true } } }]));
  });
});

describe('Settings → Notifications: Pause', () => {
  it('pauses for an hour, the rest of today or until the week starts — then offers Resume', async () => {
    renderCard();
    const group = await screen.findByRole('group', { name: 'Pause notifications' });
    expect(group).toHaveTextContent('1 hour');
    expect(group).toHaveTextContent('Until Sunday');
    fireEvent.click(screen.getByRole('button', { name: 'Rest of today' }));
    await waitFor(() => expect(bodies).toEqual([{ pauseUntil: '2026-11-11T20:00:00.000Z' }]));
    expect(await screen.findByRole('status')).toHaveTextContent('Paused until Thu 12 Nov, 00:00.');
    fireEvent.click(screen.getByRole('button', { name: 'Resume now' }));
    await waitFor(() => expect(bodies.at(-1)).toEqual({ pauseUntil: null }));
    expect(await screen.findByRole('group', { name: 'Pause notifications' })).toBeInTheDocument();
  });
});

describe('Settings → Notifications: quiet hours', () => {
  it('says what the company’s quiet hours are, and saves the person’s own', async () => {
    renderCard();
    expect(await screen.findByRole('radio', { name: /My company’s — Outside working hours \(Sun–Thu, 08:00–17:00\) and on days off/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'My own hours (in my time zone)' }));
    await waitFor(() => expect(bodies[0]).toEqual({ quietHours: { mode: 'custom', start: '22:00', end: '07:00', daysOff: true } }));
    fireEvent.change(await screen.findByLabelText('Quiet from'), { target: { value: '21:30' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Quiet on days off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    await waitFor(() => expect(bodies.at(-1)).toEqual({ quietHours: { mode: 'custom', start: '21:30', end: '07:00', daysOff: false } }));
    fireEvent.click(screen.getByRole('radio', { name: /My company’s/ }));
    await waitFor(() => expect(bodies.at(-1)).toEqual({ quietHours: null }));
  });

  it('meeting reminders and @mentions come through quiet hours until the person says no', async () => {
    renderCard();
    const meetings = await screen.findByRole('switch', { name: 'Meeting reminders come through quiet hours' });
    expect(meetings).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(meetings);
    await waitFor(() => expect(bodies).toEqual([{ breakThrough: { meetings: false, mentions: true } }]));
  });
});

describe('Settings → Notifications: the extra "due soon" reminder', () => {
  it('saves a lead time alone, and "No extra reminder" alone (null: nothing else is touched)', async () => {
    prefs = { muted: ['TASK_COMMENT'], reminderLeadMinutes: 1440 };
    renderCard();
    const select = await screen.findByRole('combobox', { name: 'Reminder timing' });
    await waitFor(() => expect(select).toHaveValue('1440'));
    fireEvent.change(select, { target: { value: '2880' } });
    await waitFor(() => expect(bodies).toEqual([{ reminderLeadMinutes: 2880 }]));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(bodies.at(-1)).toEqual({ reminderLeadMinutes: null }));
  });
});
