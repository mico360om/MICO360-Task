import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingFormModal } from './MeetingFormModal';
import type { Meeting } from '../api/meetings';
import { useAuthStore } from '../stores/auth-store';

/** 1.23 automatic Teams links in the meeting form: the "Create a Teams link" tick. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const JOIN = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0';
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let available: boolean;
let connected: boolean;
let createReply: Record<string, unknown>;
let teamsLinkReply: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  available = true;
  connected = true;
  createReply = { id: 'm-new', onlineMeetingProvider: 'TEAMS', onlineLink: JOIN, teamsLinkPending: false };
  teamsLinkReply = { made: true, teamsNotice: null, onlineLink: JOIN, onlineMeetingProvider: 'TEAMS', teamsLinkPending: false };
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'k@prolens.om', username: 'khalid', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'MICO360', companyName: 'MICO', serverTime: new Date().toISOString(), microsoftTeams: available } });
    if (u.endsWith('/integrations/microsoft')) return json({ data: { available: true, connected, email: connected ? 'khalid@prolens.example' : null, name: null, connectedAt: null, problem: null } });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'khalid', firstName: 'Khalid', lastName: 'Al Amri', avatarUrl: null }] });
    if (u.endsWith('/meetings/free-times')) return json({ data: { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } } });
    if (u.endsWith('/teams-link') && method === 'POST') return json({ data: teamsLinkReply });
    if (u.endsWith('/meetings') && method === 'POST') return json({ data: createReply }, 201);
    if (u.includes('/meetings/') && method === 'PUT') return json({ data: { id: 'm1' } });
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

const baseMeeting: Meeting = {
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2026-12-01T06:00:00.000Z', endAt: '2026-12-01T07:00:00.000Z', timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'u1', createdAt: '', updatedAt: '',
};

function renderModal(meeting?: Meeting, opts: { defaultTeamsLink?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MeetingFormModal meeting={meeting} defaultTeamsLink={opts.defaultTeamsLink} onClose={onClose} onSaved={onSaved} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

const tick = () => screen.findByRole('checkbox', { name: 'Create a Teams link' });
const postOf = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/meetings'))?.body;
const putOf = () => calls.find((c) => c.method === 'PUT')?.body;

describe('the "Create a Teams link" tick', () => {
  it('is not there when Teams links aren’t set up on this site (nothing extra is sent)', async () => {
    available = false;
    renderModal();
    await userEvent.type(screen.getByLabelText(/Title/), 'Plain');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/config'))).toBe(true));
    expect(screen.queryByRole('checkbox', { name: 'Create a Teams link' })).toBeNull();
    expect(screen.queryByText(/Connect Microsoft Teams/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    await waitFor(() => expect(postOf()).toBeTruthy());
    expect(postOf()).not.toHaveProperty('teamsLink');
  });

  it('not connected: a link to Settings instead; the pasted link field stays', async () => {
    connected = false;
    renderModal();
    const link = await screen.findByRole('link', { name: 'Connect Microsoft Teams in Settings' });
    expect(link.getAttribute('href')).toBe('/settings#microsoft-teams');
    expect(screen.queryByRole('checkbox', { name: 'Create a Teams link' })).toBeNull();
    expect((screen.getByLabelText('Online link') as HTMLInputElement).disabled).toBe(false);
  });

  it('ticked: the link field waits for Teams, and the new meeting is sent with teamsLink and no pasted link', async () => {
    const { onSaved, onClose } = renderModal();
    await userEvent.type(screen.getByLabelText(/Title/), 'OXY review');
    await userEvent.type(screen.getByLabelText('Online link'), 'meet.example.com/abc');
    await userEvent.click(await tick());
    const field = screen.getByLabelText('Online link') as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(screen.getByText(/made with your Microsoft account when you save/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postOf()).toMatchObject({ teamsLink: true, onlineLink: null });
    expect(onSaved).toHaveBeenCalledWith('m-new');
  });

  it('Microsoft unreachable: "Meeting saved", the plain notice and Make Teams link — which then works', async () => {
    createReply = { id: 'm-new', onlineMeetingProvider: 'TEAMS', onlineLink: null, teamsLinkPending: true, teamsNotice: { code: 'TEAMS_FAILED', message: 'The Teams link couldn’t be made — try again.' } };
    const { onClose, onSaved } = renderModal();
    await userEvent.type(screen.getByLabelText(/Title/), 'OXY review');
    await userEvent.click(await tick());
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    expect(await screen.findByText('Meeting saved')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/The Teams link couldn’t be made — try again\./);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Make Teams link' }));
    expect(await screen.findByText(/The Teams link is made/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m-new/teams-link'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith('m-new');
  });

  it('editing a meeting with a Teams link: ticked, the link read-only; unticking takes it away', async () => {
    renderModal({ ...baseMeeting, onlineLink: JOIN, onlineMeetingProvider: 'TEAMS' });
    const box = (await tick()) as HTMLInputElement;
    expect(box.checked).toBe(true);
    const field = screen.getByLabelText('Online link') as HTMLInputElement;
    expect(field.value).toBe(JOIN);
    expect(field.disabled).toBe(true);
    await userEvent.click(box);
    expect((screen.getByLabelText('Online link') as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(putOf()).toBeTruthy());
    expect(putOf()).toMatchObject({ teamsLink: false, onlineLink: null });
  });

  it('someone else’s meeting: only its organizer can make the link', async () => {
    renderModal({ ...baseMeeting, organizerId: 'u9' });
    expect(await screen.findByText(/Only the organizer can make a Teams link/)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Create a Teams link' })).toBeNull();
  });

  it('a meeting waiting for its link shows the tick ticked, and saving tries again', async () => {
    renderModal({ ...baseMeeting, onlineMeetingProvider: 'TEAMS', teamsLinkPending: true });
    expect(((await tick()) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(putOf()).toBeTruthy());
    expect(putOf()).toMatchObject({ teamsLink: true });
  });

  it('pre-ticked (a series’ next meeting) for someone not connected: the link field stays usable and no tick is sent', async () => {
    connected = false;
    renderModal(undefined, { defaultTeamsLink: true });
    await screen.findByRole('link', { name: 'Connect Microsoft Teams in Settings' });
    const field = screen.getByLabelText('Online link') as HTMLInputElement;
    expect(field.disabled).toBe(false);
    await userEvent.type(screen.getByLabelText(/Title/), 'Next in series');
    await userEvent.type(field, 'meet.example.com/x');
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    await waitFor(() => expect(postOf()).toBeTruthy());
    expect(postOf()).not.toHaveProperty('teamsLink');
    expect(postOf()).toMatchObject({ onlineLink: 'https://meet.example.com/x' });
  });

  it('saved but not connected after all: the notice links to Settings', async () => {
    createReply = { id: 'm-new', onlineMeetingProvider: 'TEAMS', onlineLink: null, teamsLinkPending: true, teamsNotice: { code: 'TEAMS_NOT_CONNECTED', message: 'The Teams link couldn’t be made: connect Microsoft Teams in Settings, then press Make Teams link.' } };
    renderModal();
    await userEvent.type(screen.getByLabelText(/Title/), 'OXY review');
    await userEvent.click(await tick());
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    expect(await screen.findByText('Meeting saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/settings#microsoft-teams');
  });

  it('saved, but only the organizer can make the link: said plainly, no Make Teams link', async () => {
    createReply = { id: 'm-new', onlineMeetingProvider: null, onlineLink: null, teamsNotice: { code: 'TEAMS_NOT_ORGANIZER', message: 'Only the meeting’s organizer can make its Teams link, with their own Microsoft account.' } };
    const { onClose } = renderModal();
    await userEvent.type(screen.getByLabelText(/Title/), 'OXY review');
    await userEvent.click(await tick());
    await userEvent.click(screen.getByRole('button', { name: /Schedule meeting/ }));
    expect(await screen.findByText(/Only the meeting’s organizer can make its Teams link/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make Teams link' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('someone else’s meeting waiting for its link: the hint names the organizer, not you', async () => {
    renderModal({ ...baseMeeting, organizerId: 'u9', onlineMeetingProvider: 'TEAMS', teamsLinkPending: true });
    expect(await screen.findByText(/Waiting for the organizer to make the Teams link/)).toBeTruthy();
  });
});
