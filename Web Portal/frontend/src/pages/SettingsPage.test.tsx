import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const me = { id: 'u1', email: 'ada@x.co', username: 'ada', roles: ['EMPLOYEE'] };
/** What the server answers to a preferences save, and to a photo upload. */
let saveAnswer: () => Response;
let photoAnswer: () => Response;

beforeEach(() => {
  saveAnswer = () => json({ data: { muted: ['TASK_ASSIGNED'] } });
  photoAnswer = () => json({ data: { ...me, avatarUrl: '/uploads/a.png' } });
  useAuthStore.getState().setSession({ user: me, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/avatar')) return photoAnswer();
    if (u.includes('/notifications/preferences') && method !== 'GET') return saveAnswer();
    if (u.includes('/notifications/preferences')) return json({ data: { muted: [] } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SettingsPage — daily task emails', () => {
  it('has the daily task emails card', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Daily task emails' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Pending tasks email' })).toBeInTheDocument();
  });
});

describe('SettingsPage — notification switches', () => {
  it('lets people mute being told they were added to a project', async () => {
    renderPage();
    expect(await screen.findByRole('switch', { name: 'Notify me: Added to a project' })).toBeInTheDocument();
  });

  it('says so when a switch could not be saved (it used to flip back without a word)', async () => {
    saveAnswer = () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    renderPage();
    const first = (await screen.findAllByRole('switch'))[0]!;
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(first);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t save that change/i);
    // …and the switch shows what is really stored.
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'true'));
  });

  it('clears the message when the next change is saved', async () => {
    saveAnswer = () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    renderPage();
    const first = (await screen.findAllByRole('switch'))[0]!;
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(first);
    await screen.findByRole('alert');
    saveAnswer = () => json({ data: { muted: ['TASK_ASSIGNED'] } });
    fireEvent.click(first);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('SettingsPage — photo', () => {
  it('says why a file was refused', async () => {
    photoAnswer = () => json({ error: { code: 'VALIDATION', message: 'Only PNG, JPEG, WebP or GIF images are allowed.' } }, 400);
    renderPage();
    await screen.findAllByRole('switch');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPEG, WebP or GIF images are allowed.');
  });
});

describe('SettingsPage — how long the sign-in lasts', () => {
  it('says 30 days when "Keep me signed in" was chosen', async () => {
    useAuthStore.getState().setSession({ user: me, accessToken: 'at', refreshToken: 'rt' }, { remember: true });
    renderPage();
    expect(await screen.findByText('You’re signed in for 30 days')).toBeInTheDocument();
  });

  it('says the sign-in ends with the browser when it was not', async () => {
    useAuthStore.getState().setSession({ user: me, accessToken: 'at', refreshToken: 'rt' }, { remember: false });
    renderPage();
    expect(await screen.findByText('You’re signed in until you close this browser')).toBeInTheDocument();
    expect(screen.queryByText(/30 days/)).not.toBeInTheDocument();
  });
});


describe('SettingsPage — calendar and dates', () => {
  it('saves the first day of the week and an own time zone, and can go back to the company’s', async () => {
    const puts: unknown[] = [];
    let stored = { timeZone: null as string | null, weekStart: null as number | null };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (u.endsWith('/users/me/preferences') && method === 'PUT') {
        const body = JSON.parse(String(init?.body));
        puts.push(body);
        stored = { ...stored, ...body };
        return json({ data: stored });
      }
      if (u.endsWith('/users/me/preferences')) return json({ data: stored });
      if (u.includes('/notifications/preferences')) return json({ data: { muted: [] } });
      return json({ data: [] });
    }));
    renderPage();
    const week = await screen.findByRole('group', { name: 'Week starts on' });
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    await waitFor(() => expect(puts).toContainEqual({ weekStart: 1 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true'));
    expect(week).toBeInTheDocument();

    expect(screen.getByText(/company time zone \(Asia\/Muscat\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Time zone' }));
    fireEvent.click(await screen.findByRole('option', { name: /Europe\/London/ }));
    await waitFor(() => expect(puts).toContainEqual({ timeZone: 'Europe/London' }));
    fireEvent.click(screen.getByRole('button', { name: /use the company time zone/i }));
    await waitFor(() => expect(puts).toContainEqual({ timeZone: null }));
  });
});

describe('signing out with inspection changes still on this device', () => {
  it('asks first, and only "Log out anyway" signs out and removes them', async () => {
    localStorage.setItem('mico360.inspection.u1.i1', JSON.stringify({ v: 1, ownerId: 'u1', inspectionId: 'i1', projectId: 'p1', title: 'Rig daily check', snapshot: { id: 'i1', projectId: 'p1', title: 'Rig daily check', status: 'IN_PROGRESS', structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [], revision: 0 }, answers: { v: { itemId: 'v', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:00:00.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 change saved on this device hasn’t been sent yet');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out anyway' }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('mico360.inspection.u1.i1')).toBeNull();
  });
});

describe('SettingsPage — a notification switch saves only what it changes (M-4)', () => {
  it('never sends the weekly summary or the daily email settings back (an older tab can’t turn them on again)', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('/notifications/preferences') && method === 'PUT') {
        bodies.push(JSON.parse(String(init!.body)));
        return json({ data: { muted: ['TASK_ASSIGNED'], reminderLeadMinutes: 120, weeklySummary: false, dailyEmails: { pending: false, completed: true, time: '07:00' } } });
      }
      if (u.includes('/notifications/preferences')) return json({ data: { muted: [], reminderLeadMinutes: 120, weeklySummary: false, dailyEmails: { pending: false, completed: true, time: '07:00' } } });
      return json({ data: [] });
    }));
    renderPage();
    const first = (await screen.findAllByRole('switch', { name: /^Notify me:/ }))[0]!;
    await waitFor(() => expect(first).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(first);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0] as object).sort()).toEqual(['muted', 'reminderLeadMinutes']);
    expect(bodies[0]).toMatchObject({ reminderLeadMinutes: 120 });
  });
});
