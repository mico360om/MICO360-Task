import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkSummary } from './BulkSummary';
import type { BulkResult } from '../../api/bulk';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const RESULT: BulkResult = {
  action: 'status',
  dryRun: false,
  total: 4,
  changed: [
    { id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1' },
    { id: 't2', key: 'RIG-2', title: 'Set out', projectId: 'p1' },
  ],
  skipped: [
    { id: 't3', key: 'OPS-3', title: 'Order steel', code: 'FORBIDDEN', reason: 'You can’t move tasks in Rig 3.' },
    { id: 't4', code: 'NOT_FOUND', reason: 'Task not found.' },
  ],
  undo: { id: 'b1', until: '2026-11-12T08:00:30.000Z' },
};

let posts: string[] = [];
let undoAnswer: () => Response;
beforeEach(() => {
  posts = [];
  undoAnswer = () => json({ data: { restored: [{ id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1' }], skipped: [{ id: 't2', key: 'RIG-2', title: 'Set out', code: 'CHANGED_SINCE', reason: 'Changed since — left as it is.' }] } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push(String(url));
    return undoAnswer();
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function show(result: BulkResult = RESULT) {
  const props = { onSelectSkipped: vi.fn(), onOpenTask: vi.fn(), onDismiss: vi.fn(), onUndone: vi.fn() };
  render(<BulkSummary result={result} {...props} />);
  return props;
}

describe('BulkSummary', () => {
  it('"2 updated · 2 not changed" (a status), with the skipped ones listed on demand: number, title, reason — never naming one they can’t open', async () => {
    show();
    expect(screen.getByRole('status')).toHaveTextContent('2 updated · 2 not changed');
    const toggle = screen.getByRole('button', { name: 'Show the 2 skipped' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Not changed' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('OPS-3');
    expect(rows[0]).toHaveTextContent('Order steel');
    expect(rows[0]).toHaveTextContent('You can’t move tasks in Rig 3.');
    expect(rows[1]).toHaveTextContent('A task you can’t open');
    expect(rows[1]).toHaveTextContent('Task not found.');
  });

  it('"Select the 2 skipped" gives them back as the selection, for another try', async () => {
    const p = show();
    await userEvent.click(screen.getByRole('button', { name: 'Select the 2 skipped' }));
    expect(p.onSelectSkipped).toHaveBeenCalledWith(['t3', 't4']);
  });

  it('Undo counts down from 15 seconds, waits while pointed at, and is gone when the time is up', async () => {
    vi.useFakeTimers();
    const p = show();
    expect(screen.getByRole('button', { name: /^Undo \(15 s\)/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('button', { name: /^Undo \(10 s\)/ })).toBeInTheDocument();
    const box = screen.getByRole('button', { name: /^Undo/ }).closest('[data-bulk-summary]')!;
    fireEvent.mouseEnter(box);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('button', { name: /^Undo \(10 s\)/ })).toBeInTheDocument();
    fireEvent.mouseLeave(box);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    // Skipped tasks to read: the summary stays until dismissed.
    expect(p.onDismiss).not.toHaveBeenCalled();
  });

  it('nothing skipped: the summary goes once Undo’s time is up', () => {
    vi.useFakeTimers();
    const p = show({ ...RESULT, skipped: [] });
    expect(screen.getByRole('status')).toHaveTextContent('2 updated');
    act(() => vi.advanceTimersByTime(15_000));
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it('Undo puts them back and says how it went ("1 put back · 1 left as it was: changed since")', async () => {
    const p = show();
    await userEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(await screen.findByText('1 put back · 1 left as it was: changed since')).toBeInTheDocument();
    expect(posts).toEqual([expect.stringMatching(/\/tasks\/bulk\/b1\/undo$/)]);
    expect(p.onUndone).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select the/ })).not.toBeInTheDocument();
  });

  it('Undo too late says the server’s words', async () => {
    undoAnswer = () => json({ error: { code: 'UNDO_EXPIRED', message: 'Undo is no longer available.' } }, 409);
    show();
    await userEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Undo is no longer available.');
  });

  it('no Undo when the server offers none', () => {
    show({ ...RESULT, undo: null });
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it('Duplicate: the copies can be opened', async () => {
    const p = show({
      ...RESULT,
      action: 'duplicate',
      skipped: [],
      changed: [
        { id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1', copy: { id: 'c1', key: 'RIG-9' } },
        { id: 't2', key: 'RIG-2', title: 'Set out', projectId: 'p1', copy: { id: 'c2', key: 'RIG-10' } },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('2 copied');
    await userEvent.click(screen.getByRole('button', { name: 'Show the 2 copies' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open RIG-10' }));
    expect(p.onOpenTask).toHaveBeenCalledWith('c2');
  });

  it('Dismiss closes it', async () => {
    const p = show();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(p.onDismiss).toHaveBeenCalled();
  });
});
