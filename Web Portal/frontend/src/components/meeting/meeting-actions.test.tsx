import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelMeetingDialog, DeleteMeetingDialog } from './meeting-actions';
import type { Meeting } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: { url: string; method: string }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if ((init?.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 });
    return json({ data: { id: 'm2', status: 'CANCELLED' } });
  }));
});
afterEach(() => vi.restoreAllMocks());

const base: Meeting = {
  id: 'm2', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2099-10-27T06:00:00.000Z', endAt: null, timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: 'm1', templateId: null, transcript: null, invitesSentAt: '2099-10-01T00:00:00.000Z', reminderSentAt: null,
  createdById: 'u1', createdAt: '', updatedAt: '',
};

function renderWith(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe('cancelling and deleting a meeting of a series', () => {
  it('cancels just this meeting by default', async () => {
    const onDone = vi.fn();
    renderWith(<CancelMeetingDialog meeting={base} onClose={() => {}} onDone={onDone} />);
    expect(screen.getByRole('radio', { name: /this meeting only/i })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel meeting' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('one'));
    expect(calls[0]).toEqual({ url: expect.stringMatching(/\/meetings\/m2\/cancel$/), method: 'POST' });
  });

  it('cancels every upcoming meeting of the series when asked', async () => {
    const onDone = vi.fn();
    renderWith(<CancelMeetingDialog meeting={base} onClose={() => {}} onDone={onDone} />);
    await userEvent.click(screen.getByRole('radio', { name: /all upcoming meetings/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel meetings' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('series'));
    expect(calls[0]!.url).toMatch(/\/meetings\/m2\/cancel\?scope=series$/);
  });

  it('deletes every upcoming meeting of the series when asked', async () => {
    const onDone = vi.fn();
    renderWith(<DeleteMeetingDialog meeting={base} onClose={() => {}} onDone={onDone} />);
    await userEvent.click(screen.getByRole('radio', { name: /all upcoming meetings/i }));
    expect(screen.getByText(/the upcoming meetings and their agenda/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete meetings' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('series'));
    expect(calls[0]).toEqual({ url: expect.stringMatching(/\/meetings\/m2\?scope=series$/), method: 'DELETE' });
  });

  it('asks nothing extra for a one-off meeting', () => {
    renderWith(<CancelMeetingDialog meeting={{ ...base, recurrenceParentId: null }} onClose={() => {}} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'Cancel this meeting?' })).toBeInTheDocument();
  });
});
