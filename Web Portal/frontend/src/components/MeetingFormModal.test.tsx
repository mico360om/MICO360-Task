import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingFormModal } from './MeetingFormModal';
import type { Meeting } from '../api/meetings';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'MICO360', companyName: 'MICO', serverTime: new Date().toISOString() } });
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
