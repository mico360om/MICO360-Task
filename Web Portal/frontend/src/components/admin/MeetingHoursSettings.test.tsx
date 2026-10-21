import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingHoursSettings } from './MeetingHoursSettings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let puts: Array<{ url: string; body: unknown }> = [];
let stored: unknown;

beforeEach(() => {
  puts = [];
  stored = undefined;
  useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push({ url: u, body });
        stored = body.value;
        return json({ data: { key: 'meetings.workingHours', value: body.value } });
      }
      return json({ data: stored === undefined ? [] : [{ key: 'meetings.workingHours', value: stored }] });
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
      <MeetingHoursSettings />
    </QueryClientProvider>,
  );
}

describe('System Settings: Meeting hours', () => {
  it('shows the default hours: Sunday to Thursday, 08:00 to 17:00', async () => {
    renderIt();
    expect(await screen.findByRole('heading', { name: 'Meeting hours' })).toBeInTheDocument();
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
    expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].map(pressed)).toEqual(['true', 'true', 'true', 'true', 'true']);
    expect(['Fri', 'Sat'].map(pressed)).toEqual(['false', 'false']);
    expect(screen.getByLabelText('Day starts')).toHaveValue('08:00');
    expect(screen.getByLabelText('Day ends')).toHaveValue('17:00');
  });

  it('saves the edited days and times', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Thu' })); // off
    await userEvent.click(screen.getByRole('button', { name: 'Sat' })); // on
    fireEvent.change(screen.getByLabelText('Day starts'), { target: { value: '07:30' } });
    fireEvent.change(screen.getByLabelText('Day ends'), { target: { value: '16:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting hours' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.url).toMatch(/\/system-settings\/meetings\.workingHours$/);
    expect(puts[0]!.body).toEqual({ value: { days: [0, 1, 2, 3, 6], start: '07:30', end: '16:00' } });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('says when the day ends before it starts, and saves nothing', async () => {
    renderIt();
    fireEvent.change(await screen.findByLabelText('Day ends'), { target: { value: '07:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting hours' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The day has to end after it starts.');
    expect(puts).toHaveLength(0);
  });

  it('needs at least one working day', async () => {
    renderIt();
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']) await userEvent.click(await screen.findByRole('button', { name: d }));
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting hours' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one working day.');
    expect(puts).toHaveLength(0);
  });
});
