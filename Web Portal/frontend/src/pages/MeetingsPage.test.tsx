import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingsPage } from './MeetingsPage';
import { useAuthStore } from '../stores/auth-store';
import { shiftDayKey, todayKey } from '../lib/due-date';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
/** A Muscat wall-clock time on a day relative to today, as an ISO instant. */
const at = (days: number, hhmm: string) => new Date(`${shiftDayKey(today, days)}T${hhmm}:00+04:00`).toISOString();

const meeting = (over: Record<string, unknown>) => ({
  id: 'm', title: 'Meeting', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: at(0, '10:00'), endAt: at(0, '11:00'), timeZone: TZ, recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', canEdit: true, attendeeCount: 0, openActionItemCount: 0, ...over,
});

let calls: { url: string; method: string }[];
let meetings: unknown[];
let failList: boolean;

beforeEach(() => {
  calls = [];
  failList = false;
  meetings = [
    meeting({ id: 'budget', title: 'Budget review', projectId: 'p1', attendeeCount: 6, openActionItemCount: 2 }),
    meeting({ id: 'arabic', title: 'اجتماع الميزانية', startAt: at(2, '09:00'), endAt: at(2, '10:00'), organizerId: 'u2' }),
    meeting({ id: 'draft', title: 'Hiring plan', status: 'DRAFT', startAt: at(5, '09:00'), endAt: null }),
    meeting({ id: 'retro', title: 'Sprint retro', status: 'COMPLETED', startAt: at(-3, '09:00'), endAt: at(-3, '10:00') }),
  ];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@x', username: 'aisha', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method });
    if (u.endsWith('/config')) return json({ data: { timeZone: TZ, productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (/\/meetings(\?.*)?$/.test(u) && method === 'GET') return failList ? json({ error: { code: 'X', message: 'down' } }, 500) : json({ data: meetings });
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', name: 'Falcon CRM', code: 'FAL', color: '#0F766E', icon: 'chart' }] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Said' }] });
    if (u.endsWith('/cancel') && method === 'POST') return json({ data: meeting({ status: 'CANCELLED' }) });
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
    <MemoryRouter initialEntries={['/meetings']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/meetings/:id" element={<p>Opened meeting</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const rowOf = async (title: string) => (await screen.findByRole('link', { name: title })).closest('tr')!;

describe('MeetingsPage', () => {
  it('lists each meeting with its project, status, time, organizer, attendees and open action items', async () => {
    renderPage();
    const row = await rowOf('Budget review');
    await waitFor(() => expect(row).toHaveTextContent('Falcon CRM'));
    expect(row).toHaveTextContent('Scheduled');
    const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
    expect(row).toHaveTextContent(`${time(at(0, '10:00'))} – ${time(at(0, '11:00'))}`);
    expect(row).toHaveTextContent('Aisha Khan');
    expect(within(row).getAllByText('6')[0]).toBeInTheDocument();
    expect(row).toHaveTextContent(/2 open/);
    expect(await rowOf('Hiring plan')).toHaveTextContent('Standalone');
    expect(row.querySelector('[data-project-avatar="icon"]')).not.toBeNull(); // the project's own picture
  });

  it('groups meetings into Today, Upcoming, Drafts and Past', async () => {
    renderPage();
    await rowOf('Budget review');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([expect.stringMatching(/^Today/), expect.stringMatching(/^Upcoming/), expect.stringMatching(/^Drafts/), expect.stringMatching(/^Past/)]);
  });

  it('keeps an Arabic title inline beside its details instead of pushing it to the other side', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'اجتماع الميزانية' });
    expect(link.querySelector('bdi')).not.toBeNull();
    expect(link.closest('[dir="auto"]')).toBeNull();
  });

  it('searches, and offers to clear filters when nothing matches', async () => {
    renderPage();
    await rowOf('Budget review');
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'retro');
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sprint retro' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search meetings/i }), 'zzz');
    expect(await screen.findByText(/no meetings match/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]!);
    expect(await screen.findByRole('link', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('keeps "All meetings / Organized by me" apart from the status and project filters', async () => {
    renderPage();
    await rowOf('Budget review');
    const scope = screen.getByRole('group', { name: /whose meetings/i });
    await userEvent.click(within(scope).getByRole('button', { name: /organized by me/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/meetings?mine=true'))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'COMPLETED');
    expect(await screen.findByRole('link', { name: 'Sprint retro' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), 'ALL');
    await userEvent.selectOptions(screen.getByLabelText(/^project$/i), 'p1');
    expect(screen.getByRole('link', { name: 'Budget review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sprint retro' })).not.toBeInTheDocument();
  });

  it('opens drafts in one click', async () => {
    renderPage();
    await rowOf('Budget review');
    await userEvent.click(screen.getByRole('button', { name: /drafts \(1\)/i }));
    expect(screen.getByRole('link', { name: 'Hiring plan' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Budget review' })).not.toBeInTheDocument();
  });

  it('shows past meetings ten at a time with "Show more"', async () => {
    meetings = Array.from({ length: 13 }, (_, i) => meeting({ id: `p${i}`, title: `Old meeting ${i + 1}`, status: 'COMPLETED', startAt: at(-1 - i, '09:00'), endAt: null }));
    renderPage();
    await screen.findByRole('link', { name: 'Old meeting 1' });
    expect(screen.queryByRole('link', { name: 'Old meeting 11' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
    expect(screen.getByRole('link', { name: 'Old meeting 13' })).toBeInTheDocument();
  });

  it('says so, with a retry, when the list can’t be loaded', async () => {
    failList = true;
    renderPage();
    expect(await screen.findByText(/couldn’t load meetings/i)).toBeInTheDocument();
    failList = false;
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('link', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('has a friendly empty state with New meeting when there are none at all', async () => {
    meetings = [];
    renderPage();
    expect(await screen.findByText(/no meetings yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new meeting/i }).length).toBeGreaterThan(0);
  });

  it('asks before cancelling from a row’s menu', async () => {
    renderPage();
    const row = await rowOf('Budget review');
    await userEvent.click(within(row).getByRole('button', { name: /more actions for budget review/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cancel meeting/i }));
    const dialog = screen.getByRole('alertdialog', { name: /cancel this meeting/i });
    expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/budget/cancel'))).toBe(true));
  });
});
