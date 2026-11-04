import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
    // One list, a row per item.
    const todayRow = (await screen.findByText('Due today')).closest('li')!;
    expect(todayRow).not.toHaveTextContent(/overdue/i);
    expect(screen.getByText('Due last week').closest('li')).toHaveTextContent(/overdue/i);
    expect(screen.getByText('1 action item overdue.')).toBeInTheDocument();
  });

  it('shows an error with retry — not “Nothing on your plate” — when loading fails (WEB-19)', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ error: { code: 'ERR', message: 'down' } }, 500) : undefined);
    renderIt(<MyActionItemsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your action items/i);
    expect(screen.queryByText(/nothing on your plate/i)).not.toBeInTheDocument();
  });

  it('keeps Arabic descriptions right-to-left (ARB-02), isolated inline (bdi) so they stay beside their status row', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ data: [item({ description: 'مراجعة العقد' })] }) : undefined);
    renderIt(<MyActionItemsPage />);
    const text = await screen.findByText('مراجعة العقد');
    // <bdi> takes the text's own direction (right-to-left here) without moving it to the other side.
    expect(text.tagName).toBe('BDI');
    expect(text.closest('[dir="auto"]')).toBeNull();
  });

  it('on a phone puts the status picker under the item instead of squeezing it; a long meeting name shows in full on hover', async () => {
    const long = 'Reliability review — Quarterly cross-department infrastructure reliability review and remediation planning';
    routes = (u) => (u.includes('/me/action-items') ? json({ data: [item({ meetingId: 'm1', description: 'Book the room' })] }) : u.endsWith('/meetings') ? json({ data: [{ id: 'm1', title: long }] }) : undefined);
    renderIt(<MyActionItemsPage />);
    const link = await screen.findByRole('link', { name: new RegExp(long) });
    expect(link).toHaveAttribute('title', long);
    // One column on a phone (words, then where it came from, then the status); side by side from 40em.
    const row = screen.getByText('Book the room').closest('li')!;
    expect(row.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(row.className).toMatch(/sm:grid-cols-/);
  });

  it('lines the items up in columns on a wide screen — item, meeting, due, status — with the status said once', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ data: [item({ meetingId: 'm1', description: 'Order new switches' })] }) : u.endsWith('/meetings') ? json({ data: [{ id: 'm1', title: '1st OCT IT Project Meeting' }] }) : undefined);
    renderIt(<MyActionItemsPage />);
    const row = (await screen.findByText('Order new switches')).closest('li')!;
    expect(row.className).toMatch(/lg:grid-cols-/);
    // The item's words keep at least 12rem: at 1024px the meeting column took it all and they broke a word a line.
    expect(row.className).toMatch(/lg:grid-cols-\[minmax\(12rem,1fr\)/);
    // The status picker says it; no badge repeating "Open" beside the words.
    expect(within(row).getAllByText(/^open$/i).filter((el) => el.tagName !== 'OPTION')).toHaveLength(0);
    expect(within(row).getByRole('combobox', { name: /status for order new switches/i })).toHaveValue('OPEN');
    expect(row).toHaveTextContent('No due date');
    // The meeting's icon and name stay on one line (the link is a row of its own, with or without a touch screen).
    const link = within(row).getByRole('link', { name: /1st OCT IT Project Meeting/ });
    expect(link.className).toMatch(/(^|\s)inline-flex(\s|$)/);
    // The column names, for the eye (each row's controls carry their own names).
    expect(screen.getByText('Action item').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('when there is nothing to do, says where action items come from and offers the way to Meetings', async () => {
    renderIt(<MyActionItemsPage />);
    expect(await screen.findByText('Nothing on your plate')).toBeInTheDocument();
    expect(screen.getByText(/assigned to you in a meeting/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to meetings/i })).toHaveAttribute('href', '/meetings');
  });

  it('marks the meeting link with a drawn icon, not a text arrow', async () => {
    routes = (u) => (u.includes('/me/action-items') ? json({ data: [item({ meetingId: 'm1' })] }) : u.endsWith('/meetings') ? json({ data: [{ id: 'm1', title: 'Weekly review' }] }) : undefined);
    renderIt(<MyActionItemsPage />);
    const link = await screen.findByRole('link', { name: /Weekly review|meeting/ });
    expect(link.textContent).not.toContain('↗');
    expect(link.querySelector('svg')).not.toBeNull();
  });
});

describe('MeetingsPage', () => {
  it('shows meeting times in company time and titles isolated inline (bdi), not pushed to the other side', async () => {
    routes = (u) =>
      u.endsWith('/meetings')
        ? json({ data: [{ id: 'm1', title: 'مراجعة المشروع', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1', location: null, onlineLink: null, startAt: '2026-10-01T06:00:00.000Z', endAt: null, timeZone: null, recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1', createdAt: '', updatedAt: '' }] })
        : undefined;
    renderIt(<MeetingsPage />);
    // The card's title (the meeting is over, so "Nothing coming up" on top names it too).
    const title = (await screen.findAllByText('مراجعة المشروع')).find((el) => el.closest('[data-meeting-card]'))!;
    // <bdi> keeps the Arabic text's own direction while it stays aligned with the row's details.
    expect(title.tagName).toBe('BDI');
    expect(title.closest('[dir="auto"]')).toBeNull();
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThan(0);
  });

  it('offers a retry when meetings fail to load', async () => {
    routes = (u) => (u.endsWith('/meetings') ? json({ error: { code: 'ERR', message: 'x' } }, 500) : undefined);
    renderIt(<MeetingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load meetings/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
