import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionItemsSection } from './ActionItemsSection';
import { todayKey, shiftDayKey } from '../../lib/due-date';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const base = {
  id: 'ai1', meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: 'Book the conference room', assigneeId: 'u1',
  priority: 'LOW', status: 'OPEN', dueDate: '2026-10-30T00:00:00.000Z', progress: 0, completedAt: null, taskId: null, createdById: 'u1', createdAt: '', updatedAt: '',
};
let items: Array<Record<string, unknown>>;
let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  items = [base];
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith('/meetings/m1/action-items') && method === 'GET') return json({ data: items });
    if (u.includes('/action-items/') && method === 'PATCH') return json({ data: base });
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
        <ActionItemsSection
          meetingId="m1"
          directory={[{ id: 'u1', username: 'aisha', firstName: 'Aisha', lastName: 'Khan', avatarUrl: null }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Said', avatarUrl: null }]}
          canEdit
          pollMs={false}
          timeZone="Asia/Muscat"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const patched = () => calls.filter((c) => c.method === 'PATCH').at(-1)?.body;
const rowOf = async (text: string) => (await screen.findByText(text)).closest('li')!;

describe('Meeting page: action items, one line each', () => {
  it('the title, then chips: the owner, the due date ("30 Oct 2026"), the priority and the status', async () => {
    renderIt();
    const row = await rowOf('Book the conference room');
    expect(within(row).getByRole('button', { name: 'Owner of Book the conference room: Aisha Khan' })).toHaveTextContent('Aisha Khan');
    expect(within(row).getByRole('button', { name: 'Due date for Book the conference room: 30 Oct 2026, overdue' })).toHaveTextContent('30 Oct 2026');
    expect(within(row).getByRole('button', { name: 'Priority for Book the conference room: Low' })).toHaveTextContent('Low');
    expect(within(row).getByRole('button', { name: 'Status for Book the conference room: Open' })).toHaveTextContent('Open');
    // Chips, not form boxes.
    for (const b of within(row).getAllByRole('button', { name: /for Book|of Book/ })) expect(b.className).toMatch(/rounded-full/);
    expect(row.querySelector('select, input')).toBeNull();
  });

  it('a chip is clicked to change it, saved as today', async () => {
    renderIt();
    const row = await rowOf('Book the conference room');
    await userEvent.click(within(row).getByRole('button', { name: /^Status for/ }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Completed' }));
    await waitFor(() => expect(patched()).toEqual({ status: 'COMPLETED' }));
    await userEvent.click(within(row).getByRole('button', { name: /^Priority for/ }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'High' }));
    await waitFor(() => expect(patched()).toEqual({ priority: 'HIGH' }));
    await userEvent.click(within(row).getByRole('button', { name: /^Owner of/ }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Omar Said/ }));
    await waitFor(() => expect(patched()).toEqual({ assigneeId: 'u2' }));
    await userEvent.click(within(row).getByRole('button', { name: /^Due date for/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Choose a day' })).getByRole('button', { name: 'Sat 31 Oct 2026' }));
    await waitFor(() => expect(patched()).toEqual({ dueDate: '2026-10-31T00:00:00.000Z' }));
    await userEvent.click(within(row).getByRole('button', { name: /^Due date for/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Choose a day' })).getByRole('button', { name: 'No due date' }));
    await waitFor(() => expect(patched()).toEqual({ dueDate: null }));
  });

  it('"No due date"; due today isn’t overdue, due yesterday is (in red)', async () => {
    const today = todayKey('Asia/Muscat');
    items = [
      { ...base, id: 'a', description: 'No date item', dueDate: null },
      { ...base, id: 'b', description: 'Today item', dueDate: `${today}T00:00:00.000Z` },
      { ...base, id: 'c', description: 'Yesterday item', dueDate: `${shiftDayKey(today, -1)}T00:00:00.000Z` },
    ];
    renderIt();
    expect(within(await rowOf('No date item')).getByRole('button', { name: /^Due date for/ })).toHaveTextContent('No due date');
    expect(await rowOf('Today item')).not.toHaveTextContent(/overdue/i);
    const late = within(await rowOf('Yesterday item')).getByRole('button', { name: /^Due date for/ });
    expect(late).toHaveTextContent(/overdue/i);
    expect(late.className).toMatch(/text-danger/);
  });

  it('done items are struck through and quieter; "From a note" and the task key chip are kept', async () => {
    items = [{ ...base, status: 'COMPLETED', sourceNoteId: 'n1', taskId: 't7', taskKey: 'FAL-7' }];
    renderIt();
    const title = await screen.findByText('Book the conference room');
    expect(title.closest('p')!.className).toMatch(/line-through/);
    const row = title.closest('li')!;
    expect(row.className).toMatch(/opacity-/);
    expect(row).toHaveTextContent('From a note');
    expect(within(row).getByRole('link', { name: /FAL-7/ })).toHaveAttribute('href', expect.stringContaining('task=t7'));
  });

  it('a finished meeting with none: one line, "No action items · Add one", which opens the form', async () => {
    items = [];
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ActionItemsSection meetingId="m1" directory={[]} canEdit pollMs={false} timeZone="Asia/Muscat" ended />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const card = (await screen.findByText('No action items')).closest('section')!;
    expect(screen.queryByLabelText('New action item')).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Add one' }));
    expect(screen.getByLabelText('New action item')).toHaveFocus();
  });

  it('the new item’s owner, date, priority and Add wrap in pairs by the room they have', async () => {
    renderIt();
    const owner = await screen.findByRole('button', { name: /owner of the new item/i });
    expect(owner.closest('.relative')!.className).toMatch(/flex-\[1_1_12rem\]/);
    expect(owner.closest('.relative')!.parentElement).toContainElement(screen.getByRole('button', { name: /^Due date of the new item/ }));
    // The site's own pickers beside the owner's, not the browser's date box and dropdown (1.22).
    expect(screen.getByRole('button', { name: 'Due date of the new item: No due date' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByRole('button', { name: 'Priority of the new item' })).toHaveAttribute('aria-haspopup', 'listbox');
    expect(document.querySelector('input[type="date"], select')).toBeNull();
  });
});
