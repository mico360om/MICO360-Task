import { describe, it, expect, vi, afterEach } from 'vitest';
import { createShutdown } from './shutdown';

afterEach(() => vi.useRealTimers());

// 1.23.1 — a deploy restart stops the old server (SIGTERM/SIGINT). Before, nothing was stopped: its
// every-minute jobs met the database going away and the Error log recorded "Can't reach database
// server". Now the jobs stop first and the database client disconnects last.
describe('shutdown: jobs stop before the database client disconnects', () => {
  function steps(over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
    const order: string[] = [];
    const exit = vi.fn((code: number) => void order.push(`exit ${code}`));
    const s = {
      stopJobs: async () => void order.push('jobs'),
      stopTimers: () => void order.push('timers'),
      closeServer: async () => void order.push('server'),
      flush: async () => void order.push('error log'),
      disconnect: async () => void order.push('database'),
      exit,
      ...over,
    };
    return { order, exit, shutdown: createShutdown(s) };
  }

  it('in this order: jobs, other timers, the server, the Error log’s writes, the database — then exits 0', async () => {
    const { order, shutdown } = steps();
    await shutdown('SIGTERM');
    expect(order).toEqual(['jobs', 'timers', 'server', 'error log', 'database', 'exit 0']);
  });

  it('a second signal while stopping changes nothing (one stop)', async () => {
    const { order, shutdown } = steps();
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(order.filter((s) => s === 'database')).toHaveLength(1);
    expect(order.filter((s) => s.startsWith('exit'))).toHaveLength(1);
  });

  it('a step failing never stops the next ones (the database still disconnects)', async () => {
    const { order, shutdown } = steps({ closeServer: async () => { throw new Error('already closed'); } });
    await shutdown('SIGTERM');
    expect(order).toEqual(['jobs', 'timers', 'error log', 'database', 'exit 0']);
  });

  it('a step that hangs: it exits anyway at the deadline', async () => {
    vi.useFakeTimers();
    const { exit, shutdown } = steps({ stopJobs: () => new Promise<void>(() => {}), deadlineMs: 15_000 });
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
