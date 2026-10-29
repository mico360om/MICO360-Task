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
  location: 'Room 4', onlineLink: 'meet.google.com/abc-defg-hij', startAt: '2026-10-01T06:00:00.000Z', endAt: '2026-10-01T07:00:00.000Z',
  timeZone: 'Asia/Muscat', recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null,
  reminderSentAt: null, createdById: 'u1', createdAt: '', updatedAt: '', ...over,
});
const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1', meetingId: 'm1', agendaItemId: null, authorId: 'me', type: 'DECISION', body: 'Ship on Thursday', highlighted: false,
  taskId: null, actionItemId: null, decisionId: null, createdAt: '2026-10-01T06:10:00.000Z', editedAt: null, ...over,
});
const attendee = (over: Record<string, unknown> = {}) => ({
  id: 'a1', meetingId: 'm1', userId: null, externalName: 'Guest One', externalEmail: 'g@x.co', role: 'REQUIRED', attendance: 'INVITED',
  response: 'PENDING', respondedAt: null, invitedAt: null, department: null, createdAt: '', ...over,
});
const actionItem = (over: Record<string, unknown> = {}) => ({
  id: 'ai1', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Book the room', assigneeId: null, priority: 'NORMAL',
  status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, taskKey: null, createdById: 'me', createdAt: '', updatedAt: '', overdue: false, ...over,
});

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let meetingData: ReturnType<typeof meeting>;
let notes: unknown[];
let actionItems: unknown[];
let attendees: unknown[];
let override: (u: string, method: string, body?: Record<string, unknown>) => Response | undefined;

const invitePreview = (over: Record<string, unknown> = {}) => ({
  recipients: [
    { name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', attendeeIds: [], alreadyInvited: false },
    { name: 'Guest One', email: 'g@x.co', kind: 'guest', attendeeIds: ['a1'], alreadyInvited: false },
  ],
  missingEmail: [],
  problems: [],
  invitesSentAt: null,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  calls = [];
  meetingData = meeting();
  notes = [note()];
  actionItems = [];
  attendees = [attendee()];
  override = () => undefined;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    const o = override(u, method, body);
    if (o) return o;
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/m1') && method === 'GET') return json({ data: meetingData });
    if (u.endsWith('/meetings/m1') && method === 'PUT') {
      meetingData = { ...meetingData, ...body };
      return json({ data: meetingData });
    }
    if (u.endsWith('/meetings/m1/notes') && method === 'GET') return json({ data: notes });
    if (u.endsWith('/meetings/m1/action-items') && method === 'GET') return json({ data: actionItems });
    if (u.endsWith('/meetings/m1/attendees') && method === 'GET') return json({ data: attendees });
    if (u.endsWith('/meetings/m1/agenda') && method === 'GET') return json({ data: [{ id: 'ag1', meetingId: 'm1', title: 'Budget', ownerId: null, expectedMinutes: 10, position: 0, completed: false, linkedPrevActionId: null, createdAt: '' }] });
    if (u.endsWith('/meetings/m1/invites/preview')) return json({ data: invitePreview() });
    if (u.endsWith('/meetings/m1/minutes/preview')) {
      return json({ data: { subject: 'Minutes: Weekly sync', html: '<p>The minutes for Weekly sync are ready.</p>', text: '', attachmentName: 'minutes-weekly-sync.pdf', recipients: invitePreview().recipients, missingEmail: [] } });
    }
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', name: 'Falcon CRM', code: 'FAL' }] });
    if (u.endsWith('/users/directory')) {
      return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }, { id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan' }] });
    }
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
          <Route path="/meetings" element={<p>Meetings list</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const openMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /more meeting actions/i }));
  return screen.getByRole('menu');
};

describe('MeetingDetailPage — header and actions', () => {
  it('shows the meeting’s status, project, day, time, time zone, place, link and organizer up top', async () => {
    renderPage();
    const header = (await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).closest('header')!;
    expect(within(header).getByText('Scheduled')).toBeInTheDocument();
    await waitFor(() => expect(header).toHaveTextContent('Falcon CRM'));
    expect(header.querySelector('[data-project-avatar]')).toHaveTextContent('FC'); // the project's picture (initials: none saved)
    expect(header).toHaveTextContent('Asia/Muscat');
    expect(header).toHaveTextContent('Room 4');
    await waitFor(() => expect(header).toHaveTextContent('Aisha Khan'));
    expect(within(header).getByRole('link', { name: /join online/i })).toBeInTheDocument();
  });

  it('gives a long title the full width on a tablet: the next-step button and ⋯ sit under it below lg (1024px)', async () => {
    renderPage();
    const title = await screen.findByRole('heading', { level: 1, name: 'Weekly sync' });
    const row = title.parentElement!.parentElement!;
    expect(row.className).toMatch(/lg:flex-row/);
    expect(row.className).not.toMatch(/(^|\s)md:flex-row/);
  });

  it('has a Final MOM card; the one minutes PDF carries it once final (no second PDF)', async () => {
    const done = { summary: 'Done.', discussion: [], decisions: [], risks: [], nextSteps: [] };
    override = (u, method) =>
      u.endsWith('/meetings/m1/final-minutes') && method === 'GET'
        ? json({ data: { status: 'FINAL', content: done, savedAt: '', approvedBy: { id: 'me', name: 'Me Myself' }, approvedAt: '2026-10-14T09:00:00Z', canEdit: true } })
        : undefined;
    renderPage();
    expect(await screen.findByRole('region', { name: /final mom/i })).toHaveTextContent('Approved by Me Myself');
    const menu = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Export minutes (PDF)' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Export final minutes (PDF)' })).not.toBeInTheDocument();
  });

  it('shows management actions when the server allows editing (or doesn’t say)', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^send invitations$/i })).toBeInTheDocument();
    const menu = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: /edit details/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /cancel meeting/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /delete meeting/i })).toBeInTheDocument();
    await screen.findByText('Guest One');
    expect(screen.getByRole('button', { name: /add attendee/i })).toBeInTheDocument();
  });

  it('hides editing, cancelling, deleting, invitations, attendee and agenda management when canEdit is false (SEC-06)', async () => {
    meetingData = meeting({ canEdit: false });
    notes = [note({ authorId: 'someone-else' })];
    renderPage();
    await screen.findByText('Guest One');
    await screen.findByText('Budget');
    expect(screen.queryByRole('button', { name: /send invitations/i })).not.toBeInTheDocument();
    const menu = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: /edit details/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /cancel meeting/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /delete meeting/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /email minutes/i })).not.toBeInTheDocument();
    // Viewers can still export the minutes.
    expect(within(menu).getByRole('menuitem', { name: /export minutes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add attendee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove guest one/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/new agenda item/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove "budget"/i })).not.toBeInTheDocument();
    // Other people's notes can't be edited or deleted either.
    await screen.findByText('Ship on Thursday');
    expect(screen.queryByRole('button', { name: /delete note/i })).not.toBeInTheDocument();
  });

  it('offers the next step for each status: start, then end the meeting', async () => {
    meetingData = meeting({ invitesSentAt: '2026-09-30T08:00:00.000Z' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^start meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body?.status === 'IN_PROGRESS')).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: /^end meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body?.status === 'COMPLETED')).toBe(true));
    expect(await screen.findByRole('button', { name: /^email minutes/i })).toBeInTheDocument();
  });

  it('asks before cancelling, and keeps cancelling apart from deleting', async () => {
    renderPage();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /cancel meeting/i }));
    const dialog = screen.getByRole('alertdialog', { name: /cancel this meeting/i });
    expect(within(dialog).getByRole('button', { name: /keep meeting/i })).toHaveFocus();
    expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/cancel'))).toBe(true));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('asks before deleting, then goes back to the list', async () => {
    renderPage();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /delete meeting/i }));
    const dialog = screen.getByRole('alertdialog', { name: /delete this meeting/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete meeting$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/meetings/m1'))).toBe(true));
    expect(await screen.findByText('Meetings list')).toBeInTheDocument();
  });

  it('links to the online meeting over https, and never renders an unsafe link (MTG-08)', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /join online/i })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
  });

  it('drops a javascript: link entirely (MTG-08)', async () => {
    meetingData = meeting({ onlineLink: 'javascript:alert(1)' });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Weekly sync' });
    expect(screen.queryByRole('link', { name: /join online/i })).not.toBeInTheDocument();
  });

  it('shows the meeting time in company time (MTG-01)', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Weekly sync' });
    expect(screen.getAllByTitle(/company time/i)[0]).toHaveTextContent(/10:00/);
  });

  it('keeps an Arabic title inline (bdi) and lays Arabic notes out right-to-left (ARB-02)', async () => {
    meetingData = meeting({ title: 'اجتماع الفريق' });
    notes = [note({ body: 'تمت الموافقة على الميزانية' })];
    renderPage();
    expect((await screen.findByRole('heading', { level: 1, name: 'اجتماع الفريق' })).querySelector('bdi')).not.toBeNull();
    expect((await screen.findByText('تمت الموافقة على الميزانية')).getAttribute('dir')).toBe('auto');
  });
});

describe('MeetingDetailPage — invitations', () => {
  it('checks the meeting and its recipients before sending, then shows who got the invitation', async () => {
    override = (u, method) =>
      u.endsWith('/invites') && method === 'POST'
        ? json({ data: { sent: 1, failed: 1, recipients: [{ name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', ok: true }, { name: 'Guest One', email: 'g@x.co', kind: 'guest', ok: false, error: 'The mail server didn’t accept it.' }], skipped: [] } })
        : undefined;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^send invitations$/i }));
    const dialog = await screen.findByRole('dialog', { name: /send invitations/i });
    expect(await within(dialog).findByText('g@x.co')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /send to 2 people/i }));
    expect(await within(dialog).findByText(/sent to 1 of 2/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/didn’t accept/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/invites'))).toHaveLength(1);
  });

  it('won’t send while something blocks it', async () => {
    override = (u) => (u.endsWith('/invites/preview') ? json({ data: invitePreview({ problems: [{ level: 'error', message: 'Add at least one attendee with an email address to invite.' }] }) }) : undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^send invitations$/i }));
    const dialog = await screen.findByRole('dialog', { name: /send invitations/i });
    expect(await within(dialog).findByText(/add at least one attendee/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^send/i })).toBeDisabled();
  });

  it('after invitations went out, invites only the people added since unless asked to resend to all', async () => {
    meetingData = meeting({ status: 'IN_PROGRESS', invitesSentAt: '2026-09-30T08:00:00.000Z' });
    override = (u, method) => {
      if (u.endsWith('/invites/preview')) {
        const p = invitePreview({ invitesSentAt: '2026-09-30T08:00:00.000Z' });
        p.recipients[0]!.alreadyInvited = true;
        return json({ data: p });
      }
      if (u.endsWith('/invites') && method === 'POST') return json({ data: { sent: 1, failed: 0, recipients: [], skipped: [] } });
      return undefined;
    };
    renderPage();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /invitations/i }));
    const dialog = await screen.findByRole('dialog', { name: /send invitations/i });
    expect(await within(dialog).findByRole('radio', { name: /only people not invited yet \(1\)/i })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: /send to 1 person/i }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/invites'))?.body).toEqual({ onlyNew: true }));
  });

  it('schedules a draft as it invites', async () => {
    meetingData = meeting({ status: 'DRAFT' });
    override = (u, method) => (u.endsWith('/invites') && method === 'POST' ? json({ data: { sent: 2, failed: 0, recipients: [], skipped: [] } }) : undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /schedule & invite/i }));
    const dialog = await screen.findByRole('dialog', { name: /send invitations/i });
    await userEvent.click(await within(dialog).findByRole('button', { name: /schedule and send to 2 people/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body?.status === 'SCHEDULED')).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/invites'))).toBe(true));
  });
});

describe('MeetingDetailPage — minutes email', () => {
  it('previews the email and sends it only to the people left ticked', async () => {
    meetingData = meeting({ status: 'COMPLETED' });
    override = (u, method) => (u.endsWith('/minutes/send') && method === 'POST' ? json({ data: { sent: 1, failed: 0, recipients: [{ name: 'Aisha Khan', email: 'aisha@x.co', kind: 'organizer', ok: true }], skipped: [] } }) : undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^email minutes/i }));
    const dialog = await screen.findByRole('dialog', { name: /email the minutes/i });
    expect(await within(dialog).findByText('Minutes: Weekly sync')).toBeInTheDocument();
    expect(within(dialog).getByTitle(/email preview/i)).toBeInTheDocument();
    expect(within(dialog).getByText('minutes-weekly-sync.pdf')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /guest one/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /send to 1 person/i }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/minutes/send'))?.body).toEqual({ recipients: ['aisha@x.co'] }));
    expect(await within(dialog).findByText(/sent to 1 of 1/i)).toBeInTheDocument();
  });
});

describe('MeetingDetailPage — agenda', () => {
  it('edits an item’s title, presenter and time in place, and totals the plan against the meeting', async () => {
    renderPage();
    await screen.findByText('Budget');
    expect(screen.getByText(/10 of 60 min planned/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit "budget"/i }));
    const title = screen.getByLabelText(/^agenda item title$/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Budget and hiring');
    const minutes = screen.getByLabelText(/^planned minutes$/i);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '25');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/agenda/ag1'))?.body).toMatchObject({ title: 'Budget and hiring', expectedMinutes: 25 }));
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
});

describe('MeetingDetailPage — notes', () => {
  it('keeps a note that failed to save, with the reason and a way to retry', async () => {
    let fail = true;
    override = (u, method) => (fail && u.endsWith('/meetings/m1/notes') && method === 'POST' ? json({ error: { code: 'ERR', message: 'x' } }, 500) : undefined);
    renderPage();
    await screen.findByText('Ship on Thursday');
    await userEvent.click(screen.getByRole('radio', { name: /^issue$/i }));
    const box = () => screen.getByRole('textbox', { name: /^new note$/i });
    await userEvent.click(box());
    await userEvent.type(box(), 'Vendor is late');
    await userEvent.click(screen.getByRole('button', { name: /^add note$/i }));
    expect(await screen.findByText(/couldn’t save the note/i)).toBeInTheDocument();
    expect(box()).toHaveTextContent('Vendor is late');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /^add note$/i }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/notes')).at(-1)?.body).toMatchObject({ body: '<p>Vendor is late</p>', format: 'RICH', type: 'ISSUE' }));
    await waitFor(() => expect(box()).toHaveTextContent(''));
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
    const status = await screen.findByRole('status', { name: /note deleted/i });
    notes = [note()];
    await userEvent.click(within(status).getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/notes/n1/restore'))).toBe(true));
    expect(await screen.findByText('Ship on Thursday')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/note deleted/i)).not.toBeInTheDocument());
  });

  it('refreshes notes when another person adds one (MTG-06)', async () => {
    renderPage();
    await screen.findByText('Ship on Thursday');
    notes = [note(), note({ id: 'n2', authorId: 'u2', body: 'Budget approved' })];
    await act(async () => { handlers['meeting:notes']?.({ id: 'm1' }); });
    expect(await screen.findByText('Budget approved')).toBeInTheDocument();
  });

  it('shows the Final MOM someone else just approved (the server says the meeting changed)', async () => {
    const done = { summary: 'Done.', discussion: [], decisions: [], risks: [], nextSteps: [] };
    let finalMinutes: Record<string, unknown> = { status: 'NONE', content: null, savedAt: null, approvedBy: null, approvedAt: null, canEdit: true };
    override = (u, method) => (u.endsWith('/meetings/m1/final-minutes') && method === 'GET' ? json({ data: finalMinutes }) : undefined);
    renderPage();
    const section = await screen.findByRole('region', { name: /final mom/i });
    await screen.findByText('Ship on Thursday');
    expect(section).not.toHaveTextContent('Approved by');
    finalMinutes = { status: 'FINAL', content: done, savedAt: '', approvedBy: { id: 'u1', name: 'Aisha Khan' }, approvedAt: '2026-10-14T09:00:00Z', canEdit: true };
    await act(async () => { handlers['meeting:updated']?.({ id: 'm1' }); });
    await waitFor(() => expect(screen.getByRole('region', { name: /final mom/i })).toHaveTextContent('Approved by Aisha Khan'));
  });

  it('shows an error state (not an empty list) when notes fail to load (WEB-19)', async () => {
    override = (u, method) => (u.endsWith('/meetings/m1/notes') && method === 'GET' ? json({ error: { code: 'ERR', message: 'x' } }, 500) : undefined);
    renderPage();
    expect(await screen.findByText(/couldn’t load the notes/i)).toBeInTheDocument();
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument();
  });

  it('turns an action note into a task from the note itself', async () => {
    notes = [note({ type: 'ACTION', body: 'Book the venue' })];
    renderPage();
    await screen.findByText('Book the venue');
    await userEvent.click(screen.getByRole('button', { name: /make it a task/i }));
    expect(await screen.findByRole('dialog', { name: /create task from note/i })).toBeInTheDocument();
  });
});

describe('MeetingDetailPage — action items', () => {
  it('shows the owner, due day, priority and status, and links to the task', async () => {
    actionItems = [actionItem({ taskId: 't7', taskKey: 'FAL-7', priority: 'HIGH', assigneeId: 'u1', sourceNoteId: 'n9' })];
    renderPage();
    const row = (await screen.findByText('Book the room')).closest('li')!;
    expect(within(row).getByRole('link', { name: /fal-7/i })).toHaveAttribute('href', expect.stringContaining('task=t7'));
    expect(within(row).getByLabelText(/^status for book the room$/i)).toHaveValue('OPEN');
    expect(within(row).getByLabelText(/^priority for book the room$/i)).toHaveValue('HIGH');
    expect(row).toHaveTextContent(/from a note/i);
  });

  it('treats an action item due today as not overdue, and one due yesterday as overdue (XP-03)', async () => {
    const today = todayKey('Asia/Muscat');
    actionItems = [
      actionItem({ id: 'ai1', description: 'Due today item', dueDate: `${today}T00:00:00.000Z`, overdue: true }),
      actionItem({ id: 'ai2', description: 'Due yesterday item', dueDate: `${shiftDayKey(today, -1)}T00:00:00.000Z` }),
    ];
    renderPage();
    const todayRow = (await screen.findByText('Due today item')).closest('li')!;
    const yesterdayRow = screen.getByText('Due yesterday item').closest('li')!;
    expect(todayRow).not.toHaveTextContent(/overdue/i);
    expect(yesterdayRow).toHaveTextContent(/overdue/i);
  });
});

describe('MeetingDetailPage — attendees', () => {
  it('keeps role, invitation response and attendance apart', async () => {
    meetingData = meeting({ invitesSentAt: '2026-09-30T08:00:00.000Z' });
    attendees = [attendee({ role: 'OPTIONAL', response: 'ACCEPTED', invitedAt: '2026-09-30T08:00:00.000Z' }), attendee({ id: 'a2', externalName: 'Late Guest', externalEmail: 'late@x.co' })];
    renderPage();
    const one = (await screen.findByText('Guest One')).closest('li')!;
    expect(one).toHaveTextContent('Optional');
    expect(one).toHaveTextContent('Accepted');
    const late = screen.getByText('Late Guest').closest('li')!;
    expect(late).toHaveTextContent(/no response/i);
    expect(late).toHaveTextContent(/not invited yet/i);
    // Someone who can't be emailed isn't "waiting" for an invitation.
    attendees = [...attendees, attendee({ id: 'a3', externalName: 'Walk-in', externalEmail: null })];
    await act(async () => { handlers['meeting:attendees']?.({ id: 'm1' }); });
    const walkIn = (await screen.findByText('Walk-in')).closest('li')!;
    expect(walkIn).toHaveTextContent(/no email address/i);
    expect(walkIn).not.toHaveTextContent(/not invited yet/i);
    // Attendance is recorded during the meeting, not before.
    expect(screen.queryByLabelText(/attendance for guest one/i)).not.toBeInTheDocument();
  });

  it('records attendance once the meeting is under way', async () => {
    meetingData = meeting({ status: 'IN_PROGRESS' });
    renderPage();
    await userEvent.selectOptions(await screen.findByLabelText(/attendance for guest one/i), 'PRESENT');
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/attendees/a1'))?.body).toEqual({ attendance: 'PRESENT' }));
  });

  it('lets me answer my own invitation', async () => {
    attendees = [attendee(), attendee({ id: 'a-me', userId: 'me', externalName: null, externalEmail: null })];
    renderPage();
    const mine = await screen.findByRole('group', { name: /your response/i });
    await userEvent.click(within(mine).getByRole('button', { name: /^accept$/i }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/attendees/a-me'))?.body).toEqual({ response: 'ACCEPTED' }));
  });

  it('stops asking for my answer once the meeting is over', async () => {
    meetingData = meeting({ status: 'COMPLETED' });
    attendees = [attendee({ id: 'a-me', userId: 'me', externalName: null, externalEmail: null })];
    renderPage();
    await screen.findByText('Me Myself');
    expect(screen.queryByRole('group', { name: /your response/i })).not.toBeInTheDocument();
  });

  it('can back out of removing someone', async () => {
    renderPage();
    await screen.findByText('Guest One');
    await userEvent.click(screen.getByRole('button', { name: /remove guest one/i }));
    await userEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('button', { name: /remove guest one/i })).toBeInTheDocument();
  });

  it('explains an invalid guest email instead of blaming a duplicate invite (WEB-19)', async () => {
    renderPage();
    await screen.findByText('Guest One');
    await userEvent.click(screen.getByRole('radio', { name: /^guest$/i }));
    await userEvent.type(screen.getByLabelText(/guest name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/guest email/i), 'sara-at-example');
    await userEvent.click(screen.getByRole('button', { name: /add attendee/i }));
    expect(await screen.findByText(/enter a valid email address for the guest/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attendees'))).toBe(false);
  });

  it('refuses a guest who is already on the list before asking the server', async () => {
    renderPage();
    await screen.findByText('Guest One');
    await userEvent.click(screen.getByRole('radio', { name: /^guest$/i }));
    await userEvent.type(screen.getByLabelText(/guest name/i), 'Guest Again');
    await userEvent.type(screen.getByLabelText(/guest email/i), 'G@X.co');
    await userEvent.click(screen.getByRole('button', { name: /add attendee/i }));
    expect(await screen.findByText(/already on the list/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attendees'))).toBe(false);
  });
});

describe('MeetingDetailPage — missing or failing', () => {
  it('a meeting that does not exist gets a "not found" page with a way back', async () => {
    override = (u) => (/\/meetings\/m1$/.test(u) ? json({ error: { code: 'NOT_FOUND', message: 'Meeting not found.' } }, 404) : undefined);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Meeting not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to meetings/i })).toHaveAttribute('href', '/meetings');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('a meeting that fails to load says so and offers to try again (not "not found")', async () => {
    let fail = true;
    override = (u) => (fail && /\/meetings\/m1$/.test(u) ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500) : undefined);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this meeting' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).toBeInTheDocument();
  });
});
