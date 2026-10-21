import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingFormModal } from './MeetingFormModal';
import type { Meeting } from '../api/meetings';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
const directory = [
  { id: 'u1', username: 'khalid', firstName: 'Khalid', lastName: 'Al Amri', avatarUrl: null },
  { id: 'u2', username: 'sara', firstName: 'Sara', lastName: 'Al Balushi', avatarUrl: null },
];

let freeReply: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  freeReply = { suggestions: [], clashes: [], day: [], workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'MICO360', companyName: 'MICO', serverTime: new Date().toISOString() } });
    if (u.endsWith('/users/directory')) return json({ data: directory });
    if (u.endsWith('/meetings/free-times')) return json({ data: freeReply });
    if (u.endsWith('/meetings/m1/attendees')) return json({ data: [{ id: 'a1', meetingId: 'm1', userId: 'u2' }, { id: 'a2', meetingId: 'm1', userId: null, externalName: 'Sami', externalEmail: 'sami@contractor.om' }] });
    if (u.endsWith('/meetings') && method === 'POST') return json({ data: { id: 'm-new' } }, 201);
    if (u.includes('/meetings/') && method === 'PUT') return json({ data: { id: 'm1' } });
    if (u.endsWith('/meetings/m3') && method === 'GET') return json({ data: { ...baseMeeting, id: 'm3', recurrenceParentId: 'm1', series: { id: 'm1', rule: { freq: 'WEEKLY', interval: 1, weekdays: [4] }, timeZone: 'Asia/Muscat' } } });
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

function renderModal(meeting?: Meeting) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MeetingFormModal meeting={meeting} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const baseMeeting: Meeting = {
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2026-10-01T06:00:00.000Z', endAt: '2026-10-01T07:00:00.000Z', timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'u1', createdAt: '', updatedAt: '',
};

async function pick(trigger: string, option: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** A meeting of a weekly series (its first meeting). */
const seriesMeeting: Meeting = {
  ...baseMeeting,
  recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [4] },
  series: { id: 'm1', rule: { freq: 'WEEKLY', interval: 1, weekdays: [4] }, timeZone: 'Asia/Muscat' },
};

describe('MeetingFormModal: repeating meetings', () => {
  it('schedules a repeating meeting with an end date', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/title/i), 'Weekly sync');
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-01T10:00' } });
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    expect(within(schedule).getByText(/^Repeats every week on Thu$/)).toBeInTheDocument();
    expect(within(schedule).queryByLabelText('Create the next copy')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(schedule).getByLabelText('Repeat ends'), 'UNTIL');
    fireEvent.change(within(schedule).getByLabelText('End date'), { target: { value: '2026-11-26' } });
    expect(within(schedule).getByText(/until 26 Nov 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/meetings') && c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/meetings') && c.method === 'POST')!.body!;
    expect(body.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, count: null, until: '2026-11-26' });
  });

  it('repeats on chosen days, every few weeks, without an end', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/title/i), 'Stand-up');
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-05T09:00' } }); // a Monday
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    fireEvent.change(within(schedule).getByLabelText('Repeat every'), { target: { value: '2' } });
    await userEvent.click(within(schedule).getByRole('button', { name: 'Wed' }));
    expect(within(schedule).getByText(/^Repeats every 2 weeks on Mon, Wed$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body!.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 2, weekdays: [1, 3] });
  });

  it('blocks an end date before the first meeting', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/title/i), 'Daily check-in');
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-05T09:00' } });
    await pick('Repeat', 'Daily');
    await userEvent.selectOptions(screen.getByLabelText('Repeat ends'), 'UNTIL');
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-01' } });
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(await screen.findByText(/check the repeat schedule below/i)).toBeInTheDocument();
    expect(screen.getByText(/can’t end before the first meeting/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('asks which meetings an edit is for, and changes only this one when asked', async () => {
    renderModal(seriesMeeting);
    expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent('Weekly');
    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.type(screen.getByLabelText(/title/i), 'Special sync');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('radio', { name: /this meeting only/i }));
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/meetings\/m1$/);
    expect(put.body!.title).toBe('Special sync');
    expect(put.body).not.toHaveProperty('recurrenceRule');
  });

  it('changes every upcoming meeting of the series', async () => {
    renderModal(seriesMeeting);
    await userEvent.type(screen.getByLabelText(/location/i), 'Room 5');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('radio', { name: /all upcoming meetings/i }));
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/meetings\/m1\?scope=series$/);
    // Only what changed goes to the series: a meeting changed on its own keeps its other details.
    expect(put.body).toEqual({ location: 'Room 5' });
  });

  it('sends the series a new time with its zone, and a new repeat', async () => {
    renderModal(seriesMeeting);
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-01T11:00' } });
    fireEvent.change(screen.getByLabelText(/^ends/i), { target: { value: '2026-10-01T12:00' } });
    await userEvent.click(within(screen.getByRole('group', { name: 'Repeat schedule' })).getByRole('button', { name: 'Mon' }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      startAt: '2026-10-01T07:00:00.000Z',
      endAt: '2026-10-01T08:00:00.000Z',
      timeZone: 'Asia/Muscat',
      recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1, 4] },
    });
  });

  it('applies a new repeat to the whole series only', async () => {
    renderModal(seriesMeeting);
    await pick('Repeat', 'Daily');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    expect(within(ask).getByRole('radio', { name: /this meeting only/i })).toBeDisabled();
    expect(within(ask).getByRole('radio', { name: /all upcoming meetings/i })).toBeChecked();
    expect(within(ask).getByText(/a new repeat changes the whole series/i)).toBeInTheDocument();
  });

  it('says when the first meeting will move onto the repeat’s first day', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-20T10:00' } }); // a Tuesday
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    await userEvent.click(within(schedule).getByRole('button', { name: 'Wed' }));
    await userEvent.click(within(schedule).getByRole('button', { name: 'Tue' })); // off: Wednesday only
    expect(within(schedule).getByText(/first meeting will be on Wed 21 Oct/i)).toBeInTheDocument();
  });

  it('saves a meeting dated after its series’ end on its own', async () => {
    const lastOne: Meeting = { ...seriesMeeting, id: 'm1', series: { id: 'm1', rule: { freq: 'WEEKLY', interval: 1, until: '2026-10-01' }, timeZone: 'Asia/Muscat' }, recurrenceRule: { freq: 'WEEKLY', interval: 1, until: '2026-10-01' } };
    renderModal(lastOne);
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-02T10:00' } });
    fireEvent.change(screen.getByLabelText(/^ends/i), { target: { value: '2026-10-02T11:00' } });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  });

  it('keeps the chosen days when the same repeat is picked again', async () => {
    renderModal({ ...seriesMeeting, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2, 4] }, series: { id: 'm1', rule: { freq: 'WEEKLY', interval: 1, weekdays: [2, 4] }, timeZone: 'Asia/Muscat' } });
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    expect(within(schedule).getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(schedule).getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends nothing for a series save with no changes', async () => {
    const { onClose } = renderModal(seriesMeeting);
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('radio', { name: /all upcoming meetings/i }));
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('compares with what the form opened with, not with later data', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={qc}><MeetingFormModal meeting={seriesMeeting} onClose={() => {}} /></QueryClientProvider>);
    // Someone else moves the series to Room 7 while the form is open; this person renames it.
    view.rerender(<QueryClientProvider client={qc}><MeetingFormModal meeting={{ ...seriesMeeting, location: 'Room 7' }} onClose={() => {}} /></QueryClientProvider>);
    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.type(screen.getByLabelText(/title/i), 'Renamed sync');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const ask = await screen.findByRole('alertdialog', { name: /save changes to a repeating meeting/i });
    await userEvent.click(within(ask).getByRole('radio', { name: /all upcoming meetings/i }));
    await userEvent.click(within(ask).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ title: 'Renamed sync' });
  });

  it('loads the series’ repeat for a later meeting of it', async () => {
    renderModal({ ...baseMeeting, id: 'm3', recurrenceParentId: 'm1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent('Weekly'));
  });
});

describe('MeetingFormModal', () => {
  it('reads the typed time as company time and sends the company time zone (MTG-01)', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText(/company time \(Asia\/Muscat\)/i)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/title/i), 'Kick-off');
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-01T10:00' } });
    fireEvent.change(screen.getByLabelText(/ends/i), { target: { value: '2026-10-01T11:00' } });
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/meetings') && c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/meetings') && c.method === 'POST')!.body!;
    expect(body.startAt).toBe('2026-10-01T06:00:00.000Z'); // 10:00 Muscat
    expect(body.endAt).toBe('2026-10-01T07:00:00.000Z');
    expect(body.timeZone).toBe('Asia/Muscat');
  });

  it('shows an existing meeting’s times in company time', async () => {
    renderModal(baseMeeting);
    expect(screen.getByLabelText(/starts/i)).toHaveValue('2026-10-01T10:00');
    expect(screen.getByLabelText(/ends/i)).toHaveValue('2026-10-01T11:00');
  });

  it('adds https:// to a bare meeting link before saving (MTG-08)', async () => {
    renderModal(baseMeeting);
    await userEvent.type(screen.getByLabelText(/online link/i), 'meet.google.com/abc-defg-hij');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body!.onlineLink).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('refuses javascript: and other non-web links (MTG-08)', async () => {
    renderModal(baseMeeting);
    fireEvent.change(screen.getByLabelText(/online link/i), { target: { value: 'javascript:alert(1)' } });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/enter a web link that starts with https/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('keeps Arabic titles and descriptions right-to-left (ARB-02)', () => {
    renderModal();
    expect(screen.getByLabelText(/title/i)).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText(/description/i)).toHaveAttribute('dir', 'auto');
  });
});

describe('MeetingFormModal: people and agenda in a new meeting', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'k@mico.om', username: 'khalid', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  });

  async function fillBasics() {
    await waitFor(() => expect(screen.getByText(/company time \(Asia\/Muscat\)/i)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/title/i), 'Pump station review');
    fireEvent.change(screen.getByLabelText(/starts/i), { target: { value: '2026-10-26T10:00' } });
    fireEvent.change(screen.getByLabelText(/ends/i), { target: { value: '2026-10-26T11:30' } });
  }
  const posted = () => calls.find((c) => c.url.endsWith('/meetings') && c.method === 'POST')?.body;

  it('saves one POST /meetings with the people and the agenda', async () => {
    renderModal();
    await fillBasics();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a team member' }));
    await userEvent.click(await screen.findByRole('option', { name: /Sara Al Balushi/ }));
    await userEvent.type(screen.getByLabelText('Guest email'), 'sami.k@contractor.om');
    await userEvent.click(screen.getByRole('button', { name: 'Add guest' }));
    await userEvent.type(screen.getByLabelText('New agenda item'), 'Pump test results{Enter}');
    await userEvent.selectOptions(screen.getByLabelText('Lead for item 1'), 'u2');
    fireEvent.change(screen.getByLabelText('Minutes for item 1'), { target: { value: '20' } });
    expect(screen.getByText('Total 20 of 90 minutes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(posted()).toBeDefined());
    // One create call (the free-time checks are separate reads).
    expect(calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/meetings/free-times'))).toHaveLength(1);
    expect(posted()!.attendees).toEqual([{ userId: 'u2' }, { externalEmail: 'sami.k@contractor.om', externalName: 'sami.k' }]);
    expect(posted()!.agendaItems).toEqual([{ title: 'Pump test results', ownerId: 'u2', expectedMinutes: 20 }]);
  });

  it('the organizer may lead an item; removing a person clears the items they lead', async () => {
    renderModal();
    await fillBasics();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a team member' }));
    await userEvent.click(await screen.findByRole('option', { name: /Sara Al Balushi/ }));
    await userEvent.type(screen.getByLabelText('New agenda item'), 'Intro{Enter}');
    await userEvent.type(screen.getByLabelText('New agenda item'), 'Pump test{Enter}');
    await userEvent.selectOptions(screen.getByLabelText('Lead for item 1'), 'u1');
    await userEvent.selectOptions(screen.getByLabelText('Lead for item 2'), 'u2');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sara Al Balushi' }));
    expect(screen.getByLabelText('Lead for item 2')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()!.attendees).toBeUndefined();
    expect(posted()!.agendaItems).toEqual([{ title: 'Intro', ownerId: 'u1', expectedMinutes: null }, { title: 'Pump test', ownerId: null, expectedMinutes: null }]);
  });

  it('a suggested time moves the start and keeps the meeting’s length', async () => {
    freeReply.suggestions = ['2026-10-26T04:00:00.000Z']; // 08:00 Muscat
    renderModal();
    await fillBasics();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a team member' }));
    await userEvent.click(await screen.findByRole('option', { name: /Sara Al Balushi/ }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/meetings/free-times')).at(-1)?.body?.userIds).toEqual(['u1', 'u2']));
    await userEvent.click(screen.getByRole('button', { name: 'Suggest 3 times' }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Suggested times' })).getByRole('button'));
    expect(screen.getByLabelText(/starts/i)).toHaveValue('2026-10-26T08:00');
    expect(screen.getByLabelText(/ends/i)).toHaveValue('2026-10-26T09:30');
  });

  it('editing checks the meeting’s own people, leaving the meeting itself out', async () => {
    renderModal(baseMeeting);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/meetings/free-times') && (c.body?.userIds as string[] | undefined)?.includes('u2'))).toBe(true));
    const body = calls.filter((c) => c.url.endsWith('/meetings/free-times')).at(-1)!.body!;
    expect(body).toMatchObject({ userIds: ['u1', 'u2'], excludeMeetingId: 'm1', minutes: 60 });
  });

  it('the edit form shows neither section', () => {
    renderModal(baseMeeting);
    expect(screen.queryByRole('group', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Agenda' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New agenda item')).not.toBeInTheDocument();
  });
});
