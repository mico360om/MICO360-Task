import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
