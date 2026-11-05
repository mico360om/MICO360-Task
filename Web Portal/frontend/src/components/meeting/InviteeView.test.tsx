import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InviteeView } from './InviteeView';
import type { ActionItem, FinalMinutes, Meeting } from '../../api/meetings';
import { useAuthStore } from '../../stores/auth-store';

/** The meeting as someone invited from another company sees it (MC2 Task 7): read-only. */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ma = {
  id: 'ma', title: 'Alpha review', description: 'The quarterly review', category: null, status: 'COMPLETED', projectId: 'pa', organizerId: 'ana',
  location: 'Room 2', onlineLink: null, startAt: '2026-10-30T06:00:00.000Z', endAt: '2026-10-30T07:00:00.000Z', timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: '2026-10-28T06:00:00.000Z', reminderSentAt: null,
  createdById: 'ana', createdAt: '', updatedAt: '', canEdit: false, view: 'invitee', companyId: null,
} as Meeting;
const bobItem: ActionItem = {
  id: 'ai1', meetingId: 'ma', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Send the Beta figures', assigneeId: 'bob', priority: 'HIGH',
  status: 'OPEN', dueDate: '2026-11-05T00:00:00.000Z', progress: 0, completedAt: null, taskId: null, taskKey: null, createdById: 'ana', createdAt: '', updatedAt: '', overdue: false,
};
const finalMinutes: FinalMinutes = {
  status: 'FINAL',
  content: { summary: 'We agreed the plan.', discussion: [], decisions: ['Go ahead in November'], risks: [], nextSteps: [] },
  savedAt: '2026-10-30T08:00:00.000Z', approvedBy: { id: 'ana', name: 'Ana Alpha' }, approvedAt: '2026-10-30T08:00:00.000Z', canEdit: false,
};

let calls: string[];
beforeEach(() => {
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'bob', email: 'b@x', username: 'bob', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/ma/agenda')) return json({ data: [{ id: 'g1', meetingId: 'ma', title: 'Figures', description: null, ownerId: null, position: 0, expectedMinutes: 10, completed: false, createdAt: '', updatedAt: '' }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderView(props: Partial<React.ComponentProps<typeof InviteeView>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <InviteeView meeting={ma} minutes={null} myActionItems={[bobItem]} attendees={[]} directory={[]} timeZone="Asia/Muscat" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const section = (name: string | RegExp) => screen.getByRole('region', { name });

describe('InviteeView', () => {
  it('invitee view shows no notes, decisions or edit controls', async () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha review' })).toBeInTheDocument();
    expect(screen.getByText('You can see this meeting because you were invited.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Notes/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Notes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit|Invite|Send minutes|More meeting actions/ })).toBeNull();
    expect(screen.getByText('The minutes aren’t ready yet.')).toBeInTheDocument();
    expect(within(section('Your action items')).getAllByRole('listitem')).toHaveLength(1);
    expect(within(section('Your action items')).getByText('Send the Beta figures')).toBeInTheDocument();
    // Its agenda, read only.
    expect(await screen.findByText('Figures')).toBeInTheDocument();
    expect(within(section(/^Agenda/)).getByText('Figures')).toBeInTheDocument();
    expect(calls.some((u) => u.endsWith('/meetings/ma/notes'))).toBe(false);
  });

  it('approved minutes show, with their PDF', () => {
    renderView({ minutes: finalMinutes });
    expect(screen.getByText('We agreed the plan.')).toBeInTheDocument();
    expect(screen.getByText('Go ahead in November')).toBeInTheDocument();
    expect(screen.queryByText('The minutes aren’t ready yet.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download minutes (PDF)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('no action items of mine: says so', () => {
    renderView({ myActionItems: [] });
    expect(within(section('Your action items')).getByText('You have no action items from this meeting.')).toBeInTheDocument();
  });

  it('while its action items load, it doesn’t say there are none', () => {
    renderView({ myActionItems: [], actionItemsLoading: true });
    expect(within(section('Your action items')).queryByText('You have no action items from this meeting.')).toBeNull();
    expect(within(section('Your action items')).getByText('Loading…')).toBeInTheDocument();
  });

  it('1.23.0: List | Table — the table shows the agenda and only their own items, nothing to change', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderView({ myActionItems: [{ ...bobItem, agendaItemId: 'g1' }] });
    await user.click(await screen.findByRole('button', { name: 'Table view' }));
    const table = await screen.findByRole('table', { name: 'Agenda and action items' });
    expect(within(table).getByText('Figures')).toBeInTheDocument();
    expect(within(table).getByText('Send the Beta figures')).toBeInTheDocument();
    expect(within(table).queryAllByRole('button', { name: /^Change|^Status of|^Owner of|^Topic of|^Presenter|^Covered/ })).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'New action item' })).toBeNull();
    // Their notes are not theirs to read: the table never asks for them.
    expect(calls.some((u) => u.endsWith('/meetings/ma/notes'))).toBe(false);
  });
});

describe('1.23 integration: an invitee’s meeting in a series, in the Table view', () => {
  const series = {
    series: { id: 's1', name: 'Monthly review', projectId: 'pa', companyId: null, auto: false },
    meetings: [
      { id: 'm0', title: 'Alpha review 1', status: 'COMPLETED' as const, startAt: '2026-10-03T06:00:00.000Z', endAt: null, timeZone: null, minutesFinal: false, repeats: false },
      { id: 'ma', title: 'Alpha review', status: 'COMPLETED' as const, startAt: '2026-10-30T06:00:00.000Z', endAt: null, timeZone: null, minutesFinal: true, repeats: false, current: true },
    ],
    position: 2, total: 2, previous: { id: 'm0', title: 'Alpha review 1', startAt: '2026-10-03T06:00:00.000Z' }, next: null,
    openFromEarlier: [
      { id: 'c1', description: 'Bring the Beta drawings', assigneeId: 'bob', assigneeName: 'Bob Beta', status: 'OPEN' as const, priority: 'NORMAL' as const, dueDate: null, overdue: false, taskId: null, taskKey: null, createdById: 'ana', meeting: { id: 'm0', title: 'Alpha review 1', startAt: '2026-10-03T06:00:00.000Z' } },
    ],
    canManage: false, canRemove: false, keepsRepeat: false,
  };

  it('their own carried items are the table’s last group, to read — not a section of their own', async () => {
    localStorage.clear();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderView({ series });
    expect(screen.getByRole('heading', { name: /open from earlier meetings/i })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Table view' }));
    const table = await screen.findByRole('table', { name: 'Agenda and action items' });
    expect(screen.queryByRole('heading', { name: /open from earlier meetings/i })).toBeNull();
    const last = within(table).getAllByRole('rowgroup').at(-1)!;
    expect(last).toHaveTextContent('Open from earlier meetings');
    expect(last).toHaveTextContent('Bring the Beta drawings');
    expect(within(last).getByRole('link', { name: /^from 3 oct: alpha review 1/i })).toBeInTheDocument();
    expect(within(table).queryAllByRole('button', { name: /^Status of|^Owner of/ })).toHaveLength(0);
  });
});

