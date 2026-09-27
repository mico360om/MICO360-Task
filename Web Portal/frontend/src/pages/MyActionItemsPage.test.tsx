import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyActionItemsPage } from './MyActionItemsPage';
import { MeetingsPage } from './MeetingsPage';
import { todayKey, shiftDayKey } from '../lib/due-date';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const item = (over: Record<string, unknown>) => ({
  id: 'ai', meetingId: null, agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Item', assigneeId: 'me',
  priority: 'NORMAL', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'me',
  createdAt: '', updatedAt: '', overdue: false, ...over,
});

let routes: (u: string) => Response | undefined;
beforeEach(() => {
  routes = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const r = routes(u);
    if (r) return r;
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

function renderIt(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('MyActionItemsPage', () => {
  it('counts overdue by calendar day in company time — due today is not overdue (XP-03)', async () => {
    const today = todayKey('Asia/Muscat');
    routes = (u) =>
      u.includes('/me/action-items')
        ? json({ data: [
            item({ id: 'a', description: 'Due today', dueDate: `${today}T00:00:00.000Z`, overdue: true }),
            item({ id: 'b', description: 'Due last week', dueDate: `${shiftDayKey(today, -7)}T00:00:00.000Z` }),
          ] })
        : undefined;
    renderIt(<MyActionItemsPage />);
    const todayRow = (await screen.findByText('Due today')).closest('.card')!;
    expect(todayRow).not.toHaveTextContent(/overdue/i);
    expect(screen.getByText('Due last week').closest('.card')).toHaveTextContent(/overdue/i);
    expect(screen.getByText('1 action item overdue.')).toBeInTheDocument();
  });

  it('shows an error with retry — not “Nothing on your plate” — when loading fails (WEB-19)', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ error: { code: 'ERR', message: 'down' } }, 500) : undefined);
    renderIt(<MyActionItemsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your action items/i);
    expect(screen.queryByText(/nothing on your plate/i)).not.toBeInTheDocument();
  });

  it('keeps Arabic descriptions right-to-left (ARB-02)', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ data: [item({ description: 'مراجعة العقد' })] }) : undefined);
    renderIt(<MyActionItemsPage />);
    expect((await screen.findByText('مراجعة العقد')).getAttribute('dir')).toBe('auto');
  });
});

describe('MeetingsPage', () => {
  it('shows meeting times in company time and titles with automatic direction', async () => {
    routes = (u) =>
      u.endsWith('/meetings')
        ? json({ data: [{ id: 'm1', title: 'مراجعة المشروع', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1', location: null, onlineLink: null, startAt: '2026-10-01T06:00:00.000Z', endAt: null, timeZone: null, recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1', createdAt: '', updatedAt: '' }] })
        : undefined;
    renderIt(<MeetingsPage />);
    const title = await screen.findByText('مراجعة المشروع');
    expect(title).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it('offers a retry when meetings fail to load', async () => {
    routes = (u) => (u.endsWith('/meetings') ? json({ error: { code: 'ERR', message: 'x' } }, 500) : undefined);
    renderIt(<MeetingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load meetings/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
