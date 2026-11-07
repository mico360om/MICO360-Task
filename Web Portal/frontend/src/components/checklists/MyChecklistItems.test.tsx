import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MyChecklistItems } from './MyChecklistItems';
import type { MyChecklistItem } from '../../api/checklist';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mine = (patch: Partial<MyChecklistItem>): MyChecklistItem => ({
  id: 'i1',
  text: 'Label circuits',
  done: false,
  dueDate: null,
  isParent: false,
  openSubItems: 0,
  taskId: 't1',
  taskKey: 'MICO-142',
  taskTitle: 'Fit out the plant room',
  projectId: 'p1',
  listId: 'L1',
  listTitle: 'Electrical',
  ...patch,
});

let items: MyChecklistItem[];
let calls: { url: string; method: string; body: unknown }[];
let refuse: string | null;
let holdPut: string | null;
let releasePut: (() => void) | null;
beforeEach(() => {
  calls = [];
  refuse = null;
  holdPut = null;
  releasePut = null;
  items = [mine({ dueDate: '2020-01-03' }), mine({ id: 'i2', text: 'Wiring', isParent: true, openSubItems: 2, dueDate: '2099-02-01' }), mine({ id: 'i3', text: 'Pipes', taskId: 't2', taskKey: 'MICO-9', listTitle: 'Plumbing' })];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/me/checklist-items')) return json({ data: items });
      if (method === 'PUT') {
        if (refuse) return json({ error: { code: 'CHECKLIST_PARENT', message: refuse } }, 400);
        const id = String(url).split('/').pop()!;
        if (id === holdPut) await new Promise<void>((r) => (releasePut = r));
        // Done: it leaves the list.
        items = items.filter((i) => i.id !== id);
        return json({ data: { id, done: true } });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Where() {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
}
function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/my-tasks']}>
        <MyChecklistItems />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const row = (text: string) => screen.getAllByTestId('my-checklist-item').find((li) => li.textContent?.includes(text))!;

describe('My Tasks: Checklist items for me (1.23.3)', () => {
  it('lists the open items assigned to me: task number, checklist, item and due date (late in red)', async () => {
    renderIt();
    const section = await screen.findByRole('region', { name: 'Checklist items for me (3)' });
    const first = row('Label circuits');
    expect(within(first).getByText('MICO-142')).toBeInTheDocument();
    expect(first).toHaveTextContent('Electrical');
    expect(within(first).getByText('Overdue · 3 Jan 2020')).toHaveClass('text-danger');
    expect(within(row('Wiring')).getByText('1 Feb 2099')).toBeInTheDocument();
    expect(within(section).getAllByTestId('my-checklist-item')).toHaveLength(3);
  });

  it('only real to-do items can be ticked: a parent says how many sub-items are still open', async () => {
    renderIt();
    await screen.findByRole('region', { name: /Checklist items for me/ });
    expect(within(row('Wiring')).queryByRole('checkbox')).toBeNull();
    expect(within(row('Wiring')).getByText('2 sub-items still open')).toBeInTheDocument();
  });

  it('ticks an item at once, saves it and refreshes the list', async () => {
    renderIt();
    await screen.findByRole('region', { name: /Checklist items for me/ });
    const box = screen.getByRole('checkbox', { name: 'Label circuits (MICO-142)' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ body: { done: true } }));
    expect(calls.find((c) => c.method === 'PUT')!.url).toMatch(/\/checklist\/i1$/);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/me/checklist-items'))).toHaveLength(2));
  });

  it('puts the tick back and says why when it is refused', async () => {
    refuse = '2 sub-items still open';
    renderIt();
    await screen.findByRole('region', { name: /Checklist items for me/ });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pipes (MICO-9)' }));
    expect(await within(row('Pipes')).findByRole('alert')).toHaveTextContent('2 sub-items still open');
    expect(screen.getByRole('checkbox', { name: 'Pipes (MICO-9)' })).not.toBeChecked();
  });

  it('opens the task at the item', async () => {
    renderIt();
    await screen.findByRole('region', { name: /Checklist items for me/ });
    await userEvent.click(screen.getByRole('button', { name: 'Open MICO-9 at “Pipes”' }));
    expect(screen.getByTestId('where')).toHaveTextContent('?task=t2&item=i3');
  });

  it('is not there when nothing is assigned to me', async () => {
    items = [];
    renderIt();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/me/checklist-items'))).toBe(true));
    expect(screen.queryByRole('region', { name: /Checklist items for me/ })).toBeNull();
  });

  it('a second quick tick isn’t undone when the first one’s refresh comes back', async () => {
    holdPut = 'i3';
    renderIt();
    await screen.findByRole('region', { name: /Checklist items for me/ });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pipes (MICO-9)' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Label circuits (MICO-142)' }));
    // "Label circuits" is saved and the list read again (without it); "Pipes" still waits.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Label circuits (MICO-142)' })).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Pipes (MICO-9)' })).toBeChecked();
    releasePut!();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Pipes (MICO-9)' })).toBeNull());
  });
});
