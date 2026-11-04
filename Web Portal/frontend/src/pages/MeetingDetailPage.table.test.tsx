import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MeetingDetailPage } from './MeetingDetailPage';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';

// 1.23.0 (owner, 5 Nov): "List | Table" at the top of the Agenda — only when the meeting has topics or action items.

vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, emit: () => {}, connect: () => {}, disconnect: () => {} }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MEETING = {
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'me',
  location: null, onlineLink: null, startAt: '2026-11-05T06:00:00.000Z', endAt: '2026-11-05T07:00:00.000Z', timeZone: 'UTC', recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'me', createdAt: '', updatedAt: '',
};
let meetingData: Record<string, unknown>;
let agenda: unknown[];
let actionItems: unknown[];

beforeEach(() => {
  localStorage.clear();
  meetingData = MEETING;
  agenda = [{ id: 'ag1', meetingId: 'm1', title: 'Budget', ownerId: null, expectedMinutes: 10, position: 0, completed: false, linkedPrevActionId: null, createdAt: '' }];
  actionItems = [{ id: 'ai1', meetingId: 'm1', agendaItemId: 'ag1', sourceNoteId: null, projectId: null, description: 'Book the room', assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, taskKey: null, createdById: 'me', createdAt: '', updatedAt: '', overdue: false }];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/m1')) return json({ data: meetingData });
    if (u.endsWith('/meetings/m1/agenda')) return json({ data: agenda });
    if (u.endsWith('/meetings/m1/action-items')) return json({ data: actionItems });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/meetings/m1']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Meeting page: List | Table (1.23.0)', () => {
  it('the switch is at the top of the Agenda; Table shows the agenda and action items as one table', async () => {
    const user = userEvent.setup();
    renderPage();
    const agendaSection = (await screen.findByRole('heading', { name: /^Agenda/ })).closest('section')!;
    await user.click(await within(agendaSection).findByRole('button', { name: 'Table view' }));
    expect(await screen.findByRole('table', { name: 'Agenda and action items' })).toBeInTheDocument();
    expect(localStorage.getItem(userStorageKey('me', 'meeting.view'))).toBe('table');
    // One table instead of the two sections; the notes stay.
    expect(screen.queryByRole('heading', { name: /^Action items/ })).toBeNull();
    expect(screen.getByRole('heading', { name: /^Live notes/ })).toBeInTheDocument();
    // Back to the list from the table's own switch.
    const tableSection = screen.getByRole('heading', { name: /Agenda and action items/ }).closest('section')!;
    await user.click(within(tableSection).getByRole('button', { name: 'List view' }));
    expect(await screen.findByRole('heading', { name: /^Action items/ })).toBeInTheDocument();
  });

  it('no switch on a meeting with no topics and no action items', async () => {
    agenda = [];
    actionItems = [];
    localStorage.setItem(userStorageKey('me', 'meeting.view'), 'table');
    renderPage();
    await screen.findByRole('heading', { name: /^Agenda/ });
    await screen.findByText(/No agenda yet/);
    expect(screen.queryByRole('button', { name: 'Table view' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a person who may not change the meeting still gets the table (its topics to read)', async () => {
    meetingData = { ...MEETING, organizerId: 'someone', canEdit: false };
    localStorage.setItem(userStorageKey('me', 'meeting.view'), 'table');
    renderPage();
    expect(await screen.findByRole('table', { name: 'Agenda and action items' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Budget')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Change the title of topic/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New agenda item' })).toBeNull();
  });
});
