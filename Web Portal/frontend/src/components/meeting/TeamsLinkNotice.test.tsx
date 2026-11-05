import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamsLinkNotice } from './TeamsLinkNotice';
import { MeetingHeader } from './MeetingHeader';
import type { Meeting } from '../../api/meetings';
import { useAuthStore } from '../../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: { url: string; method: string }[];
let available: boolean;
let reply: Record<string, unknown>;

const meeting: Meeting = {
  id: 'm1', title: 'OXY review', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, onlineMeetingProvider: 'TEAMS', teamsLinkPending: true, startAt: '2026-12-01T06:00:00.000Z', endAt: '2026-12-01T07:00:00.000Z',
  timeZone: 'Asia/Muscat', recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'u1', createdAt: '', updatedAt: '', canEdit: true,
};

beforeEach(() => {
  calls = [];
  available = true;
  reply = { made: true, teamsNotice: null, onlineLink: 'https://teams.microsoft.com/l/meetup-join/x', onlineMeetingProvider: 'TEAMS', teamsLinkPending: false };
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'k@prolens.om', username: 'khalid', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString(), microsoftTeams: available } });
    if (u.endsWith('/teams-link')) return json({ data: reply });
    return json({ data: {} });
  }));
});
afterEach(() => vi.restoreAllMocks());

function renderIt(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a meeting waiting for its Teams link', () => {
  it('its organizer sees the plain notice and Make Teams link', async () => {
    const onMade = vi.fn();
    renderIt(<TeamsLinkNotice meeting={meeting} onMade={onMade} />);
    // A lasting note (role status), not an alert announced on every visit.
    expect((await screen.findByRole('status')).textContent).toMatch(/The Teams link couldn’t be made — try again\./);
    await userEvent.click(screen.getByRole('button', { name: 'Make Teams link' }));
    await waitFor(() => expect(onMade).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/teams-link'))).toBe(true);
  });

  it('a refusal says why (e.g. connect again), and the button stays', async () => {
    reply = { made: false, teamsNotice: { code: 'TEAMS_NOT_CONNECTED', message: 'The Teams link couldn’t be made: connect Microsoft Teams in Settings, then press Make Teams link.' }, onlineLink: null, onlineMeetingProvider: 'TEAMS', teamsLinkPending: true };
    renderIt(<TeamsLinkNotice meeting={meeting} onMade={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make Teams link' }));
    expect(await screen.findByText(/connect Microsoft Teams in Settings/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make Teams link' })).toBeTruthy();
  });

  it('nothing on a site without Teams links', async () => {
    available = false;
    renderIt(<TeamsLinkNotice meeting={meeting} onMade={vi.fn()} />);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/config'))).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Make Teams link' })).toBeNull();
  });

  it('nothing for someone else, or for a meeting that has its link', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 's@prolens.om', username: 'sara', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><TeamsLinkNotice meeting={meeting} onMade={vi.fn()} /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/config'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Make Teams link' })).toBeNull();
    unmount();
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'k@prolens.om', username: 'khalid', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
    renderIt(<TeamsLinkNotice meeting={{ ...meeting, teamsLinkPending: false, onlineLink: 'https://teams.microsoft.com/l/x' }} onMade={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Make Teams link' })).toBeNull();
  });
});

describe('the meeting header', () => {
  it('a Teams link joins "on Teams"; a pasted one "online"', () => {
    const props = { project: null, organizerName: 'Khalid', timeZone: 'Asia/Muscat', live: false, primary: null, onPrimary: () => {}, menu: [] };
    const { unmount } = render(<MemoryRouter><MeetingHeader meeting={{ ...meeting, teamsLinkPending: false, onlineLink: 'https://teams.microsoft.com/l/meetup-join/x' }} {...props} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Join on Teams' }).getAttribute('href')).toBe('https://teams.microsoft.com/l/meetup-join/x');
    unmount();
    render(<MemoryRouter><MeetingHeader meeting={{ ...meeting, onlineMeetingProvider: null, teamsLinkPending: false, onlineLink: 'https://meet.example.com/x' }} {...props} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Join online' })).toBeTruthy();
  });
});
