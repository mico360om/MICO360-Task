import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgendaSection } from './AgendaSection';

const directory = [
  { id: 'u1', username: 'khalid', firstName: 'Khalid', lastName: 'Al Amri', avatarUrl: null },
  { id: 'u2', username: 'sara', firstName: 'Sara', lastName: 'Al Balushi', avatarUrl: null },
];
let calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
let draftReply: Response | null;
let agenda: unknown[];

beforeEach(() => {
  calls = [];
  draftReply = null;
  agenda = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/ai/draft-agenda')) {
        return (
          draftReply ??
          ok({
            items: [
              { title: 'Pump test results', ownerId: 'u2', minutes: 20 },
              { title: 'Budget', ownerId: null, minutes: 15 },
              { title: 'Order spare seals', ownerId: 'u1', minutes: 10 },
            ],
          })
        );
      }
      if (u.endsWith('/meetings/m1/agenda') && method === 'POST') return ok({ id: `g${calls.length}`, meetingId: 'm1', ...body, position: 0, completed: false }, 201);
      if (u.endsWith('/meetings/m1/agenda') && method === 'GET') return ok(agenda);
      return ok([]);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt(canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AgendaSection
        meetingId="m1"
        startAt="2026-10-26T06:00:00.000Z"
        endAt="2026-10-26T07:00:00.000Z"
        directory={directory}
        canEdit={canEdit}
        pollMs={false}
        draftFrom={{ title: 'Pump station review', description: 'Monthly check', projectId: 'p4', peopleIds: ['u1', 'u2'] }}
      />
    </QueryClientProvider>,
  );
}

describe('Meeting page: Draft agenda', () => {
  it('proposes items and adds only the ticked ones', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft agenda' }));
    const review = await screen.findByRole('group', { name: 'Drafted agenda' });
    expect(calls.find((c) => c.url.endsWith('/ai/draft-agenda'))!.body).toEqual({
      title: 'Pump station review',
      description: 'Monthly check',
      projectId: 'p4',
      startAt: '2026-10-26T06:00:00.000Z',
      minutes: 60,
      peopleIds: ['u1', 'u2'],
      meetingId: 'm1',
    });
    const boxes = within(review).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(review).toHaveTextContent('Sara Al Balushi');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/agenda'))).toBe(false); // nothing added yet
    await userEvent.click(within(review).getByRole('checkbox', { name: /Budget/ }));
    await userEvent.click(within(review).getByRole('button', { name: 'Add selected' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/agenda'))).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/meetings/m1/agenda')).map((c) => c.body)).toEqual([
      { title: 'Pump test results', ownerId: 'u2', expectedMinutes: 20 },
      { title: 'Order spare seals', ownerId: 'u1', expectedMinutes: 10 },
    ]);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Drafted agenda' })).not.toBeInTheDocument());
  });

  it('says so when AI isn’t configured, and the agenda still works by hand', async () => {
    draftReply = new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft agenda' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI is not configured yet');
    expect(screen.getByLabelText('New agenda item')).toBeEnabled();
  });

  it('is not offered to someone who can’t change the agenda', async () => {
    renderIt(false);
    await screen.findByText('No agenda yet.');
    expect(screen.queryByRole('button', { name: 'Draft agenda' })).not.toBeInTheDocument();
  });
});

describe('Meeting page: agenda rows', () => {
  const long = 'Quarterly cross-department infrastructure reliability review and remediation planning';
  beforeEach(() => {
    agenda = [{ id: 'a1', meetingId: 'm1', title: long, ownerId: 'u1', expectedMinutes: 30, position: 0, completed: false }];
  });

  it('shows the whole topic: it wraps instead of being cut short beside the buttons', async () => {
    renderIt();
    const title = await screen.findByText(long);
    expect(title.closest('.truncate')).toBeNull();
    // The buttons are one group that can move under the topic on a narrow screen.
    const up = screen.getByRole('button', { name: `Move "${long}" up` });
    expect(up.parentElement).toContainElement(screen.getByRole('button', { name: `Edit "${long}"` }));
  });

  it('gives the “covered” tick box a finger-sized target around it', async () => {
    renderIt();
    const box = await screen.findByRole('checkbox', { name: `Covered: "${long}"` });
    expect(box.closest('label')).not.toBeNull();
  });
});
