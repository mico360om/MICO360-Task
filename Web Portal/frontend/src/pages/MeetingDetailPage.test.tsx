import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingDetailPage } from './MeetingDetailPage';
import { useAuthStore } from '../stores/auth-store';
import { todayKey, shiftDayKey } from '../lib/due-date';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
vi.mock('socket.io-client', () => ({
  io: () => ({ on: (ev: string, cb: Handler) => { handlers[ev] = cb; }, emit: () => {}, connect: () => {}, disconnect: () => {} }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'u1',
  location: null, onlineLink: 'meet.google.com/abc-defg-hij', startAt: '2026-10-01T06:00:00.000Z', endAt: '2026-10-01T07:00:00.000Z',
  timeZone: 'Asia/Muscat', recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null,
  reminderSentAt: null, createdById: 'u1', createdAt: '', updatedAt: '', ...over,
});
const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1', meetingId: 'm1', agendaItemId: null, authorId: 'me', type: 'DECISION', body: 'Ship on Thursday', highlighted: false,
  taskId: null, actionItemId: null, decisionId: null, createdAt: '2026-10-01T06:10:00.000Z', editedAt: null, ...over,
});

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let meetingData: ReturnType<typeof meeting>;
let notes: unknown[];
let actionItems: unknown[];
let override: (u: string, method: string) => Response | undefined;

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  calls = [];
  meetingData = meeting();
  notes = [note()];
  actionItems = [];
  override = () => undefined;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const o = override(u, method);
    if (o) return o;
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/m1') && method === 'GET') return json({ data: meetingData });
    if (u.endsWith('/meetings/m1/notes') && method === 'GET') return json({ data: notes });
    if (u.endsWith('/meetings/m1/action-items') && method === 'GET') return json({ data: actionItems });
    if (u.endsWith('/meetings/m1/attendees') && method === 'GET') return json({ data: [{ id: 'a1', meetingId: 'm1', userId: null, externalName: 'Guest One', externalEmail: 'g@x.co', role: 'REQUIRED', attendance: 'INVITED', department: null, createdAt: '' }] });
    if (u.endsWith('/meetings/m1/agenda') && method === 'GET') return json({ data: [{ id: 'ag1', meetingId: 'm1', title: 'Budget', ownerId: null, expectedMinutes: 10, position: 0, completed: false, linkedPrevActionId: null, createdAt: '' }] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }] });
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
    <MemoryRouter initialEntries={['/meetings/m1']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('MeetingDetailPage', () => {
  it('shows management controls when the server allows editing (or doesn’t say)', async () => {
    renderPage();
    await screen.findByText('Weekly sync');
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel meeting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invites/i })).toBeInTheDocument();
    await screen.findByText('Guest One');
    expect(screen.getByRole('button', { name: /add attendee/i })).toBeInTheDocument();
  });

  it('hides edit, cancel, delete, invitations, attendee and agenda management when canEdit is false (SEC-06)', async () => {
    meetingData = meeting({ canEdit: false });
    notes = [note({ authorId: 'someone-else' })];
    renderPage();
    await screen.findByText('Weekly sync');
    await screen.findByText('Guest One');
    await screen.findByText('Budget');
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel meeting/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send invites/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /email minutes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add attendee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove guest one/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/agenda item/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove "budget"/i })).not.toBeInTheDocument();
    // Other people's notes can't be edited or deleted either.
    await screen.findByText('Ship on Thursday');
    expect(screen.queryByRole('button', { name: /delete note/i })).not.toBeInTheDocument();
    // Viewers can still export the minutes.
    expect(screen.getByRole('button', { name: /export minutes/i })).toBeInTheDocument();
  });

  it('asks before deleting a note, and only then sends the delete (MTG-07)', async () => {
    renderPage();
    await screen.findByText('Ship on Thursday');
    await userEvent.click(screen.getByRole('button', { name: /delete note/i }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const confirm = screen.getByRole('group', { name: /confirm: delete note/i });
    expect(within(confirm).getByRole('button', { name: /keep/i })).toHaveFocus();
    await userEvent.click(within(confirm).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/meetings/m1/notes/n1'))).toBe(true));
  });

  it('offers Undo after a note is deleted, which restores it on the server (MTG-07)', async () => {
    renderPage();
    await screen.findByText('Ship on Thursday');
    await userEvent.click(screen.getByRole('button', { name: /delete note/i }));
    notes = [];
    await userEvent.click(within(screen.getByRole('group', { name: /confirm: delete note/i })).getByRole('button', { name: /^delete$/i }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/note deleted/i);
    notes = [note()];
    await userEvent.click(within(status).getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/notes/n1/restore'))).toBe(true));
    expect(await screen.findByText('Ship on Thursday')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/note deleted/i)).not.toBeInTheDocument());
  });

  it('can back out of a delete', async () => {
    renderPage();
    await screen.findByText('Guest One');
    await userEvent.click(screen.getByRole('button', { name: /remove guest one/i }));
    await userEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('button', { name: /remove guest one/i })).toBeInTheDocument();
  });

  it('reports a failed delete instead of failing silently (MTG-07)', async () => {
    override = (u, method) => (method === 'DELETE' && u.includes('/agenda/') ? json({ error: { code: 'FORBIDDEN', message: 'Nope' } }, 403) : undefined);
    renderPage();
    await screen.findByText('Budget');
    await userEvent.click(screen.getByRole('button', { name: /remove "budget"/i }));
    const confirm = screen.getByRole('group', { name: /confirm: remove "budget"/i });
    await userEvent.click(within(confirm).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByText(/couldn’t delete the agenda item/i)).toBeInTheDocument());
  });

  it('links to the online meeting over https, and never renders an unsafe link (MTG-08)', async () => {
    renderPage();
    await screen.findByText('Weekly sync');
    expect(screen.getByRole('link', { name: /join online/i })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
  });

  it('drops a javascript: link entirely (MTG-08)', async () => {
    meetingData = meeting({ onlineLink: 'javascript:alert(1)' });
    renderPage();
    await screen.findByText('Weekly sync');
    expect(screen.queryByRole('link', { name: /join online/i })).not.toBeInTheDocument();
  });

  it('shows the meeting time in company time (MTG-01)', async () => {
    renderPage();
    await screen.findByText('Weekly sync');
    expect(screen.getByTitle(/company time/i)).toHaveTextContent(/10:00/);
  });

  it('treats an action item due today as not overdue, and one due yesterday as overdue (XP-03)', async () => {
    const today = todayKey('Asia/Muscat');
    actionItems = [
      { id: 'ai1', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Due today item', assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: `${today}T00:00:00.000Z`, progress: 0, completedAt: null, taskId: null, createdById: 'me', createdAt: '', updatedAt: '', overdue: true },
      { id: 'ai2', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Due yesterday item', assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: `${shiftDayKey(today, -1)}T00:00:00.000Z`, progress: 0, completedAt: null, taskId: null, createdById: 'me', createdAt: '', updatedAt: '', overdue: false },
    ];
    renderPage();
    const todayRow = (await screen.findByText('Due today item')).closest('li')!;
    const yesterdayRow = screen.getByText('Due yesterday item').closest('li')!;
    expect(todayRow).not.toHaveTextContent(/overdue/i);
    expect(yesterdayRow).toHaveTextContent(/overdue/i);
  });

  it('explains an invalid guest email instead of blaming a duplicate invite (WEB-19)', async () => {
    renderPage();
    await screen.findByText('Guest One');
    await userEvent.click(screen.getByRole('button', { name: /^guest$/i }));
    await userEvent.type(screen.getByLabelText(/guest name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/guest email/i), 'sara-at-example');
    await userEvent.click(screen.getByRole('button', { name: /add attendee/i }));
    expect(await screen.findByText(/enter a valid email address for the guest/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attendees'))).toBe(false);
  });

  it('refreshes notes when another person adds one (MTG-06)', async () => {
    renderPage();
    await screen.findByText('Ship on Thursday');
    notes = [note(), note({ id: 'n2', authorId: 'u2', body: 'Budget approved' })];
    await act(async () => { handlers['meeting:notes']?.({ id: 'm1' }); });
    expect(await screen.findByText('Budget approved')).toBeInTheDocument();
  });

  it('shows an error state (not an empty list) when notes fail to load (WEB-19)', async () => {
    override = (u, method) => (u.endsWith('/meetings/m1/notes') && method === 'GET' ? json({ error: { code: 'ERR', message: 'x' } }, 500) : undefined);
    renderPage();
    expect(await screen.findByText(/couldn’t load the notes/i)).toBeInTheDocument();
    expect(screen.queryByText(/no notes captured yet/i)).not.toBeInTheDocument();
  });

  it('lays out Arabic notes and titles right-to-left (ARB-02)', async () => {
    meetingData = meeting({ title: 'اجتماع الفريق' });
    notes = [note({ body: 'تمت الموافقة على الميزانية' })];
    renderPage();
    expect((await screen.findByText('اجتماع الفريق')).closest('[dir="auto"]')).not.toBeNull();
    expect((await screen.findByText('تمت الموافقة على الميزانية')).getAttribute('dir')).toBe('auto');
  });
});
