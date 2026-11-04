import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingFormModal } from './MeetingFormModal';
import type { Meeting } from '../api/meetings';
import type { SeriesPrefill } from '../api/meeting-series';
import { useAuthStore } from '../stores/auth-store';

// 1.23 "New meeting in this series": the form starts from the series' latest meeting and the meeting
// joins the series; moved to another project it won't. Editing a meeting of a series: moving it to
// another project says it will leave the series, before saving.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }, { id: 'u2', username: 'sara', firstName: 'Sara', lastName: 'Balushi' }] });
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'p1', name: 'Pump Station', code: 'PUMP', status: 'ACTIVE' }, { id: 'p2', name: 'Rig Inspection', code: 'RIG', status: 'ACTIVE' }] });
    if (u.endsWith('/meetings/free-times')) return json({ data: { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } } });
    if (u.endsWith('/meetings/m1/series')) return json({ data: { series: { id: 's1', name: 'Monthly OXY review', projectId: 'p1', companyId: null, auto: false }, meetings: [], position: null, total: 1, previous: null, next: null, openFromEarlier: [], canManage: true, canRemove: true, keepsRepeat: false } });
    if (u.endsWith('/meetings') && method === 'POST') return json({ data: { id: 'm-new' } }, 201);
    if (u.includes('/meetings/') && method === 'PUT') return json({ data: { id: 'm1' } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

const prefill: SeriesPrefill = {
  seriesId: 's1', seriesName: 'Monthly OXY review', title: 'Monthly OXY review', projectId: 'p1', companyId: null,
  location: 'Site office', onlineLink: 'https://meet.example.com/oxy', durationMinutes: 90, description: null,
  people: [{ kind: 'user', id: 'u2', name: 'Sara Balushi' }, { kind: 'guest', email: 'guest@client.test', name: 'Guest' }],
  agendaItems: [{ title: 'Progress', ownerId: 'u2', expectedMinutes: 15 }],
};

function renderForm(props: { meeting?: Meeting; prefill?: SeriesPrefill }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MeetingFormModal {...props} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function pick(trigger: string, option: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('New meeting in this series', () => {
  it('starts from the latest meeting and joins the series', async () => {
    renderForm({ prefill });
    expect(await screen.findByText(/In the series/)).toHaveTextContent('In the series “Monthly OXY review” — filled in from its latest meeting. Choose the day.');
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Monthly OXY review');
    expect(screen.getByLabelText('Location')).toHaveValue('Site office');
    expect(screen.getByLabelText('Online link')).toHaveValue('https://meet.example.com/oxy');
    expect(screen.getAllByText('Sara Balushi').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('Progress')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings'))).toBe(true));
    const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/meetings'))!.body!;
    expect(sent).toMatchObject({ title: 'Monthly OXY review', projectId: 'p1', location: 'Site office', onlineLink: 'https://meet.example.com/oxy', seriesId: 's1' });
    expect(sent.attendees).toEqual([{ userId: 'u2' }, { externalEmail: 'guest@client.test', externalName: 'Guest' }]);
    expect(sent.agendaItems).toEqual([{ title: 'Progress', ownerId: 'u2', expectedMinutes: 15 }]);
    // The latest meeting's length: an hour and a half.
    expect(Date.parse(sent.endAt as string) - Date.parse(sent.startAt as string)).toBe(90 * 60_000);
  });

  it('moved to another project, it won’t be in the series (said before saving)', async () => {
    renderForm({ prefill });
    await screen.findByText(/In the series/);
    await pick('Project', /Rig Inspection/);
    expect(screen.getByText(/won’t be in the series/)).toHaveTextContent('This meeting won’t be in the series “Monthly OXY review”: it is in another project now.');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/meetings'))!.body).not.toHaveProperty('seriesId');
  });
});

describe('editing a meeting of a series', () => {
  const meeting: Meeting = {
    id: 'm1', title: 'Monthly 1', description: null, category: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'me',
    location: null, onlineLink: null, startAt: '2026-10-01T06:00:00.000Z', endAt: '2026-10-01T07:00:00.000Z', timeZone: 'Asia/Muscat',
    recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
    createdById: 'me', createdAt: '', updatedAt: '', seriesId: 's1',
  };

  it('says it will leave the series when it moves to another project', async () => {
    renderForm({ meeting });
    await screen.findByLabelText(/^Title/);
    expect(screen.queryByText(/will leave the series/)).not.toBeInTheDocument();
    await pick('Project', /Rig Inspection/);
    expect(await screen.findByText(/will leave the series/)).toHaveTextContent('This meeting will leave the series “Monthly OXY review”.');
    await pick('Project', /Pump Station/);
    expect(screen.queryByText(/will leave the series/)).not.toBeInTheDocument();
  });
});
