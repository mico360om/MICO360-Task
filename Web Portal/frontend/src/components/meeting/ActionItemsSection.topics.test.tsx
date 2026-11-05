import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionItemsSection } from './ActionItemsSection';

// 1.23.0: action items under agenda topics — the Topic picker on the add form, the topic on each item.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string, patch: Record<string, unknown> = {}) => ({
  id, meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: id, assigneeId: null,
  priority: 'NORMAL', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'u1', createdAt: '', updatedAt: '', overdue: false, ...patch,
});
const topic = (id: string, title: string, position: number) => ({ id, meetingId: 'm1', title, ownerId: null, expectedMinutes: null, position, completed: false, linkedPrevActionId: null, createdAt: '' });
let agenda: unknown[];
let items: unknown[];
let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  agenda = [topic('a1', 'Site progress', 0), topic('a2', 'Safety', 1)];
  items = [item('Order rebar', { agendaItemId: 'a1' }), item('Book crane', { sourceNoteId: 'n1' }), item('Call client')];
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/meetings/m1/action-items') && method === 'GET') return json({ data: items });
    if (u.endsWith('/meetings/m1/action-items') && method === 'POST') return json({ data: item('new') }, 201);
    if (u.endsWith('/meetings/m1/agenda')) return json({ data: agenda });
    if (u.endsWith('/meetings/m1/notes')) return json({ data: [{ id: 'n1', meetingId: 'm1', agendaItemId: 'a2', authorId: 'u1', type: 'ACTION', body: 'x', highlighted: false, taskId: null, actionItemId: null, decisionId: null, createdAt: '', editedAt: null }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActionItemsSection meetingId="m1" directory={[{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', avatarUrl: null }]} canEdit pollMs={false} timeZone="UTC" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Action items under agenda topics (1.23.0)', () => {
  it('each item names its topic — its own, else its note’s', async () => {
    renderIt();
    const rebar = (await screen.findByText('Order rebar')).closest('li')!;
    expect(await within(rebar).findByText('1. Site progress')).toBeInTheDocument();
    const crane = screen.getByText('Book crane').closest('li')!;
    expect(await within(crane).findByText('2. Safety')).toBeInTheDocument();
    const client = screen.getByText('Call client').closest('li')!;
    expect(within(client).queryByText(/Site progress|Safety/)).toBeNull();
  });

  it('the add form has a Topic picker (no topic at first) and sends the chosen topic', async () => {
    const user = userEvent.setup();
    renderIt();
    const picker = await screen.findByRole('button', { name: 'Topic of the new item' });
    expect(picker).toHaveTextContent('No topic');
    await user.click(picker);
    await user.click(screen.getByRole('option', { name: '2. Safety' }));
    await user.type(screen.getByRole('textbox', { name: 'New action item' }), 'Fence the pit');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ description: 'Fence the pit', agendaItemId: 'a2' }));
  });

  it('a meeting with no topics has no Topic picker', async () => {
    agenda = [];
    renderIt();
    await screen.findByText('Order rebar');
    expect(screen.queryByRole('button', { name: 'Topic of the new item' })).toBeNull();
  });
});
