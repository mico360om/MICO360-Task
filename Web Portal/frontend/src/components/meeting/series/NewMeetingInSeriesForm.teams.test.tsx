import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NewMeetingInSeriesForm } from './SeriesSection';
import type { SeriesPrefill } from '../../../api/meeting-series';
import { useAuthStore } from '../../../stores/auth-store';

// 1.23 integration (series × Teams): "New meeting in this series" from a series whose latest meeting has
// a link Teams made. The link isn't copied (each meeting gets its own Teams meeting): the form opens with
// "Create a Teams link" ticked — where the person can make one — and an empty Online link.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let connected: boolean;

beforeEach(() => {
  calls = [];
  connected = true;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString(), microsoftTeams: true } });
    if (u.endsWith('/integrations/microsoft')) return json({ data: { available: true, connected, email: connected ? 'me@prolens.example' : null, name: null, connectedAt: null, problem: null } });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }] });
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'p1', name: 'Pump Station', code: 'PUMP', status: 'ACTIVE' }] });
    if (u.endsWith('/meetings/free-times')) return json({ data: { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } } });
    if (u.endsWith('/meetings') && method === 'POST') return json({ data: { id: 'm-new', onlineMeetingProvider: 'TEAMS', onlineLink: 'https://teams.microsoft.com/l/meetup-join/new', teamsLinkPending: false } }, 201);
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

const prefill: SeriesPrefill = {
  seriesId: 's1', seriesName: 'Monthly site review', title: 'Monthly site review', projectId: 'p1', companyId: null,
  location: 'Site office', onlineLink: null, teamsLink: true, durationMinutes: 60, description: null, people: [], agendaItems: [],
};

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NewMeetingInSeriesForm prefill={prefill} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const postOf = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/meetings'))?.body;

describe('New meeting in this series, after a meeting whose link Teams made', () => {
  it('starts with "Create a Teams link" ticked and no copied link; the new meeting asks for its own', async () => {
    renderForm();
    expect(await screen.findByRole('checkbox', { name: 'Create a Teams link' })).toBeChecked();
    expect(screen.getByLabelText('Online link')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(postOf()).toBeTruthy());
    expect(postOf()).toMatchObject({ seriesId: 's1', teamsLink: true, onlineLink: null });
  });

  it('for someone not connected: a plain form — the link field usable, no tick sent', async () => {
    connected = false;
    renderForm();
    expect(await screen.findByRole('link', { name: 'Connect Microsoft Teams in Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Create a Teams link' })).toBeNull();
    const link = screen.getByLabelText('Online link') as HTMLInputElement;
    expect(link.disabled).toBe(false);
    expect(link).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(postOf()).toBeTruthy());
    expect(postOf()).not.toHaveProperty('teamsLink');
    expect(postOf()).toMatchObject({ seriesId: 's1' });
  });
});
