import { describe, it, expect, vi } from 'vitest';
import { createSerialRunner, jumpStep } from './chat-jump';

describe('jumping to a message (a reply’s quote, a search result) — 3b review', () => {
  const base = { found: false, fetching: false, nextPageError: false, hasNextPage: true, pagesTried: 0, maxPages: 10 };
  it('shows it when it is loaded; waits while the thread is being read; loads the page before otherwise', () => {
    expect(jumpStep({ ...base, found: true })).toBe('show');
    expect(jumpStep({ ...base, fetching: true })).toBe('wait');
    expect(jumpStep(base)).toBe('load');
  });
  it('stops when an older page couldn’t be loaded (offline) — not "isn’t in this conversation"', () => {
    expect(jumpStep({ ...base, nextPageError: true })).toBe('failed');
  });
  it('says it is gone only when the whole history has been looked through (or too far back)', () => {
    expect(jumpStep({ ...base, hasNextPage: false })).toBe('gone');
    expect(jumpStep({ ...base, pagesTried: 10 })).toBe('gone');
  });
});

describe('files sent one after another; a discarded one is never sent (3b review)', () => {
  it('runs them in order, and skips one discarded while it waited its turn', async () => {
    const runner = createSerialRunner();
    const order: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    void runner.run('a', async () => {
      order.push('a');
      await first;
    });
    const b = vi.fn(async () => void order.push('b'));
    const c = vi.fn(async () => void order.push('c'));
    void runner.run('b', b);
    const last = runner.run('c', c);
    runner.cancel('b');
    expect(runner.waiting('c')).toBe(true);
    release();
    await last;
    expect(order).toEqual(['a', 'c']);
    expect(b).not.toHaveBeenCalled();
    expect(runner.waiting('c')).toBe(false);
  });
  it('a key run again after cancelling is sent', async () => {
    const runner = createSerialRunner();
    const task = vi.fn(async () => undefined);
    runner.cancel('a');
    await runner.run('a', task);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
