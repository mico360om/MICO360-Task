import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingDetailPage } from './MeetingDetailPage';
import { useAuthStore } from '../stores/auth-store';

/** The meeting page for someone invited from another company (`view: 'invitee'`, MC2 Task 7). */

vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, off: () => {}, emit: () => {}, connect: () => {}, disconnect: () => {} }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ma = (over: Record<string, unknown> = {}) => ({
  id: 'ma', title: 'Alpha review', description: null, category: null, status: 'SCHEDULED', projectId: 'pa', organizerId: 'ana',
  location: 'Room 2', onlineLink: null, startAt: '2026-11-10T06:00:00.000Z', endAt: '2026-11-10T07:00:00.000Z', timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'ana', createdAt: '', updatedAt: '', canEdit: false, view: 'invitee', companyId: null, ...over,
});
const bobItem = {
  id: 'ai1', meetingId: 'ma', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Send the Beta figures', assigneeId: 'bob', priority: 'HIGH',
  status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, taskKey: null, createdById: 'ana', createdAt: '', updatedAt: '', overdue: false,
};

let calls: string[];
let meeting: ReturnType<typeof ma>;
/** The server names the meeting's people beside its roster (false: an older server). */
let withPeople = true;
beforeEach(() => {
  calls = [];
  withPeople = true;
  meeting = ma();
  useAuthStore.getState().setSession({ user: { id: 'bob', email: 'b@x', username: 'bob', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u.slice(u.indexOf('/api/v1') + 7));
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/ma')) return json({ data: meeting });
    if (u.endsWith('/meetings/ma/attendees')) {
      const row = (id: string, userId: string) => ({ id, meetingId: 'ma', userId, externalName: null, externalEmail: null, role: 'REQUIRED', attendance: 'INVITED', response: 'PENDING', respondedAt: null, invitedAt: null, department: null, createdAt: '' });
      // The roster names the meeting's people (the organizer first): bob's directory has no Alpha people.
      return json({ data: [row('a0', 'ana'), row('a1', 'bob')], ...(withPeople ? { people: [{ id: 'ana', name: 'Ana Alpha', avatarUrl: null }, { id: 'bob', name: 'Bob Betaonly', avatarUrl: null }] } : {}) });
    }
    if (u.endsWith('/meetings/ma/agenda')) return json({ data: [] });
    if (u.endsWith('/meetings/ma/final-minutes')) return json({ error: { code: 'NOT_FOUND', message: 'Meeting not found.' } }, 404);
    if (u.endsWith('/meetings/ma/action-items')) return json({ data: [bobItem] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', avatarUrl: null }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/meetings/ma']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Meeting page — invited from another company', () => {
  it('the organizer and the people are named, though my directory doesn’t know them', async () => {
    renderPage();
    expect(await screen.findByText('You can see this meeting because you were invited.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Organizer:/).textContent).toBe('Organizer: Ana Alpha'));
    const people = screen.getByRole('region', { name: /People/ });
    await waitFor(() => expect(within(people).getByText('Ana Alpha')).toBeInTheDocument());
    expect(within(people).queryByText('Unknown member')).toBeNull();
  });

  it('shows the invitee view: no notes asked for, the minutes not ready, my action items', async () => {
    renderPage();
    expect(await screen.findByText('You can see this meeting because you were invited.')).toBeInTheDocument();
    expect(await screen.findByText('The minutes aren’t ready yet.')).toBeInTheDocument();
    const mine = screen.getByRole('region', { name: 'Your action items' });
    await waitFor(() => expect(within(mine).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: /Live notes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More meeting actions' })).toBeNull();
    expect(calls).not.toContain('/meetings/ma/notes');
    // People: still answerable (their own invitation).
    expect(screen.getByRole('region', { name: /People/ })).toBeInTheDocument();
  });

  it('the full view is unchanged for everyone else', async () => {
    meeting = ma({ view: 'full', canEdit: true });
    renderPage();
    expect(await screen.findByRole('region', { name: /Live notes/ })).toBeInTheDocument();
    expect(screen.queryByText('You can see this meeting because you were invited.')).toBeNull();
  });
});
