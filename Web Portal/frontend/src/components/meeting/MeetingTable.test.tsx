import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingTable, type MeetingTableProps } from './MeetingTable';
import { useAuthStore } from '../../stores/auth-store';
import type { ActionItem } from '../../api/meetings';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string, description: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id, meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description, assigneeId: null,
  priority: 'NORMAL', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'u1', createdAt: '', updatedAt: '', overdue: false, ...patch,
});
const topic = (id: string, title: string, position: number, patch: Record<string, unknown> = {}) => ({ id, meetingId: 'm1', title, ownerId: null, expectedMinutes: null, position, completed: false, linkedPrevActionId: null, createdAt: '', ...patch });
const DIRECTORY = [
  { id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', avatarUrl: null },
  { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Said', avatarUrl: null },
];

let agenda: unknown[];
let items: ActionItem[];
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let refuse = false;

beforeEach(() => {
  refuse = false;
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'aisha', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  agenda = [topic('a2', 'Safety', 1, { completed: true }), topic('a1', 'Site progress', 0, { ownerId: 'u2', expectedMinutes: 15 })];
  items = [
    item('i1', 'Order rebar', { agendaItemId: 'a1', assigneeId: 'u1', priority: 'LOW', taskId: 't12', taskKey: 'MICO-12' }),
    item('i2', 'Book crane', { agendaItemId: 'a1', assigneeId: 'u2', priority: 'URGENT', status: 'COMPLETED' }),
    item('i3', 'Fence the pit', { sourceNoteId: 'n1' }),
    item('i4', 'Call client'),
  ];
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
    if (method !== 'GET' && refuse) return json({ error: { code: 'VALIDATION', message: 'That topic is not on this meeting’s agenda.' } }, 400);
    if (u.endsWith('/meetings/m1/action-items')) return json({ data: items });
    if (u.endsWith('/meetings/m1/agenda')) return json({ data: agenda });
    if (u.endsWith('/meetings/m1/notes')) return json({ data: [{ id: 'n1', meetingId: 'm1', agendaItemId: 'a2', authorId: 'u1', type: 'ACTION', body: 'x', highlighted: false, taskId: null, actionItemId: null, decisionId: null, createdAt: '', editedAt: null }] });
    if (method === 'PATCH' && u.includes('/action-items/')) {
      const id = u.split('/action-items/')[1]!;
      return json({ data: { ...items.find((i) => i.id === id)!, ...body } });
    }
    if (method === 'PATCH' && u.includes('/agenda/')) {
      const id = u.split('/agenda/')[1]!;
      return json({ data: { ...(agenda as { id: string }[]).find((a) => a.id === id)!, ...body } });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let search = '';
function Where() {
  search = useLocation().search;
  return null;
}
function show(props: Partial<MeetingTableProps> = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/meetings/m1']}>
        <MeetingTable meetingId="m1" directory={DIRECTORY} canEdit pollMs={false} timeZone="UTC" {...props} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const groups = () => screen.getAllByRole('rowgroup').slice(1);
/** A group's item rows' headers (its topic heading is a row-group header). */
const heads = (g: HTMLElement) => within(g).queryAllByRole('rowheader').filter((h) => h.getAttribute('scope') !== 'rowgroup');
const words = (g: HTMLElement) => heads(g).map((h) => h.textContent);
const allWords = () => groups().flatMap(words);
const headRow = (g: HTMLElement) => g.querySelector('tr')!;
const itemRow = (text: string) => groups().flatMap(heads).find((h) => new RegExp(text).test(h.textContent ?? ''))!.closest('tr')!;

describe('MeetingTable', () => {
  it('topics in agenda order — presenter, minutes, covered — each with its items, then Other', async () => {
    show();
    await screen.findByRole('table', { name: 'Agenda and action items' });
    await waitFor(() => expect(groups()).toHaveLength(3));
    const [g1, g2, g3] = groups();
    expect(g1).toHaveTextContent('1.');
    expect(within(g1!).getByRole('button', { name: 'Change the title of topic 1: Site progress' })).toBeInTheDocument();
    expect(within(g1!).getByRole('button', { name: 'Presenter of topic 1: Omar Said' })).toBeInTheDocument();
    expect(within(g1!).getByRole('button', { name: 'Change the planned minutes of topic 1: 15 min' })).toBeInTheDocument();
    expect(within(g1!).getByRole('button', { name: 'Covered, topic 1: Not covered' })).toBeInTheDocument();
    expect(words(g1!)).toEqual([expect.stringContaining('Order rebar'), expect.stringContaining('Book crane')]);
    // An older item made from a note sits under the note's topic.
    expect(within(g2!).getByRole('button', { name: 'Covered, topic 2: Covered ✓' })).toBeInTheDocument();
    expect(words(g2!)).toEqual([expect.stringContaining('Fence the pit')]);
    expect(g3).toHaveTextContent('Other');
    expect(words(g3!)).toEqual([expect.stringContaining('Call client')]);
    // The linked task's number.
    expect(within(itemRow('Order rebar')).getByText('MICO-12')).toBeInTheDocument();
  });

  it('a header sorts the items inside each topic; the topics keep their order', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(screen.getByRole('columnheader', { name: /Priority/ })).getByRole('button'));
    const [g1] = groups();
    expect(words(g1!)).toEqual([expect.stringContaining('Book crane'), expect.stringContaining('Order rebar')]);
    expect(groups()[2]).toHaveTextContent('Other');
  });

  it('changes an action item in place: words, owner, priority, status', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(itemRow('Call client')).getByRole('button', { name: 'Change the words of Call client: Call client' }));
    await user.clear(screen.getByRole('textbox', { name: 'The words of Call client' }));
    await user.type(screen.getByRole('textbox', { name: 'The words of Call client' }), 'Call the client{Enter}');
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/action-items/i4'), body: { description: 'Call the client' } }));
    await user.click(within(itemRow('Order rebar')).getByRole('button', { name: 'Status of Order rebar: Open' }));
    await user.click(screen.getByRole('option', { name: 'Pending' }));
    expect(within(itemRow('Order rebar')).getByRole('button', { name: 'Status of Order rebar: Pending' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.status === 'PENDING')).toBe(true));
    await user.click(within(itemRow('Order rebar')).getByRole('button', { name: 'Owner of Order rebar: Aisha Khan' }));
    await user.click(screen.getByRole('option', { name: /Omar Said/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.assigneeId === 'u2')).toBe(true));
  });

  it('moves an item to another topic with its Topic picker', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(itemRow('Call client')).getByRole('button', { name: 'Topic of Call client: No topic' }));
    await user.click(screen.getByRole('option', { name: '2. Safety' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/action-items/i4'), body: { agendaItemId: 'a2' } }));
    // Shown under Safety at once (Other has gone: nothing is left in it).
    expect(words(groups()[1]!)).toEqual([expect.stringContaining('Fence the pit'), expect.stringContaining('Call client')]);
  });

  it('an item under its note’s topic can move to another topic, but has no “No topic”', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(itemRow('Fence the pit')).getByRole('button', { name: 'Topic of Fence the pit: 2. Safety' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['1. Site progress', '2. Safety']);
  });

  it('changes a topic in place for someone who may edit the agenda', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(groups()[0]!).getByRole('button', { name: 'Covered, topic 1: Not covered' }));
    await user.click(screen.getByRole('option', { name: 'Covered ✓' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/meetings/m1/agenda/a1'), body: { completed: true } }));
    await user.click(within(groups()[0]!).getByRole('button', { name: /Change the planned minutes of topic 1/ }));
    await user.clear(screen.getByRole('spinbutton', { name: 'The planned minutes of topic 1' }));
    await user.type(screen.getByRole('spinbutton', { name: 'The planned minutes of topic 1' }), '20{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.expectedMinutes === 20)).toBe(true));
  });

  it('someone who may not edit the agenda sees its topics as words, and still changes action items', async () => {
    show({ canEdit: false });
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /topic 1/ })).toBeNull();
    const topicRow = headRow(groups()[0]!);
    expect(within(topicRow).getByText('Site progress')).toBeInTheDocument();
    expect(within(topicRow).getByText('Omar Said')).toBeInTheDocument();
    expect(within(topicRow).getByText('Not covered')).toBeInTheDocument();
    expect(within(itemRow('Order rebar')).getByRole('button', { name: /Status of Order rebar/ })).toBeInTheDocument();
  });

  it('a topic folds away with its ▾', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(groups()[0]!).getByRole('button', { name: 'Fold Site progress' }));
    expect(heads(groups()[0]!)).toHaveLength(0);
    // Folded, it says how many items it holds, in words.
    expect(within(groups()[0]!).getByText('2 action items')).toBeInTheDocument();
    await user.click(within(groups()[0]!).getByRole('button', { name: 'Unfold Site progress' }));
    expect(heads(groups()[0]!)).toHaveLength(2);
  });

  it('filters the items (Open only, owner, words), hides topics left empty, and counts', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(screen.getByText('4 action items')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter by status' }));
    await user.click(screen.getByRole('option', { name: 'Open only' }));
    expect(screen.getByText('3 of 4')).toBeInTheDocument();
    expect(screen.queryByText('Book crane')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filter by owner' }));
    await user.click(screen.getByRole('option', { name: 'Me' }));
    expect(groups()).toHaveLength(1);
    expect(allWords()).toEqual([expect.stringContaining('Order rebar')]);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'mico 12');
    expect(allWords()).toEqual([expect.stringContaining('Order rebar')]);
  });

  it('puts a refused change back and says why', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    refuse = true;
    await user.click(within(itemRow('Call client')).getByRole('button', { name: 'Topic of Call client: No topic' }));
    await user.click(screen.getByRole('option', { name: '1. Site progress' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save — That topic is not on this meeting’s agenda.');
    expect(groups()[2]).toHaveTextContent('Call client');
  });

  it('Open opens an item’s linked task', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    await user.click(within(itemRow('Order rebar')).getByRole('button', { name: 'Open MICO-12: Order rebar' }));
    expect(search).toContain('task=t12');
    expect(within(itemRow('Call client')).queryByRole('button', { name: /^Open/ })).toBeNull();
  });

  it('read-only (an invitee’s view): nothing to change', async () => {
    show({ readOnly: true, items: [items[0]!] });
    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /^Change|^Status of|^Owner of|^Topic of|topic 1/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New action item' })).toBeNull();
  });

  it('takes more groups after Other (the series’ “Open from earlier meetings”)', async () => {
    show({ extraGroups: [{ key: 'carried', label: 'Open from earlier meetings', items: [item('c1', 'Survey the yard', { meetingId: 'm0' })], note: () => 'from 3 Nov' }] });
    await waitFor(() => expect(groups()).toHaveLength(4));
    const last = groups()[3]!;
    expect(last).toHaveTextContent('Open from earlier meetings');
    expect(within(last).getByText('from 3 Nov')).toBeInTheDocument();
    // Read-only unless the group says otherwise.
    expect(within(last).queryByRole('button', { name: /^Status of/ })).toBeNull();
  });

  it('has the add forms below it', async () => {
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(screen.getByRole('textbox', { name: 'New agenda item' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New action item' })).toBeInTheDocument();
  });

  it('an item made from a note keeps to the note’s topic: no “No topic” (it would come straight back)', async () => {
    const user = userEvent.setup();
    // Since 1.23.0 an item made from a note stores the note's topic too.
    items = [item('i5', 'Fence the pit', { agendaItemId: 'a2', sourceNoteId: 'n1' })];
    show();
    await waitFor(() => expect(groups()).toHaveLength(2));
    await user.click(within(itemRow('Fence the pit')).getByRole('button', { name: 'Topic of Fence the pit: 2. Safety' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['1. Site progress', '2. Safety']);
  });

  it('a meeting of an archived project: to look at, with the project’s notice', async () => {
    show({ locked: 'archived' });
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(screen.getByText('This project is archived — reopen it first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change|^Status of|^Owner of|^Topic of|topic 1/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New agenda item' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New action item' })).toBeNull();
  });

  it('an extra group whose items may be changed shows a change at once and saves it', async () => {
    const user = userEvent.setup();
    const carried = item('c1', 'Survey the yard', { meetingId: 'm0' });
    show({ extraGroups: [{ key: 'carried', label: 'Open from earlier meetings', items: [carried], editable: () => new Set(['status'] as const) }] });
    await waitFor(() => expect(groups()).toHaveLength(4));
    await user.click(within(itemRow('Survey the yard')).getByRole('button', { name: 'Status of Survey the yard: Open' }));
    await user.click(screen.getByRole('option', { name: 'Pending' }));
    expect(within(itemRow('Survey the yard')).getByRole('button', { name: 'Status of Survey the yard: Pending' })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/action-items/c1'), body: { status: 'PENDING' } }));
    // Only what the group allows: its owner is words here.
    expect(within(itemRow('Survey the yard')).queryByRole('button', { name: /^Owner of/ })).toBeNull();
  });

  it('changes an item’s due date as that day, and takes it off with “No due date”', async () => {
    const user = userEvent.setup();
    items = [item('i9', 'Order rebar', { dueDate: '2026-03-10T00:00:00.000Z' })];
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    const chip = within(itemRow('Order rebar')).getByRole('button', { name: 'Due date of Order rebar: 10 Mar 2026, overdue' });
    expect(chip).toHaveTextContent(/Overdue · 10 Mar/);
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Fri 13 Mar 2026' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ dueDate: '2026-03-13T00:00:00.000Z' }));
    await user.click(within(itemRow('Order rebar')).getByRole('button', { name: /^Due date of Order rebar: 13 Mar 2026/ }));
    await user.click(screen.getByRole('button', { name: 'No due date' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ dueDate: null }));
  });

  it('a remembered owner who has no items in this meeting is let go', async () => {
    localStorage.setItem('mico360.u.u1.table.meeting', JSON.stringify({ sort: null, filters: { text: '', status: '', person: 'someone-else', priority: '', due: '' }, shown: ['topic'] }));
    show();
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(screen.getByRole('button', { name: 'Filter by owner' })).toHaveTextContent('Anyone');
    expect(screen.getByText('4 action items')).toBeInTheDocument();
  });
});
