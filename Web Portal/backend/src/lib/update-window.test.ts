import { describe, it, expect } from 'vitest';
import { createUpdateWindow, UPDATE_SETTLE_MS } from './update-window';

// 1.23.14 — the live Error log's "The database couldn't be reached (P1001)" came at deploy restarts: the
// old server stopping (SIGTERM) and the new one's first moments. That window is the update's.
describe('createUpdateWindow: is the server in an update restart?', () => {
  it('open for its first minute after starting, then closed', () => {
    let t = 1_000_000;
    const w = createUpdateWindow({ now: () => t, startedAt: t });
    expect(UPDATE_SETTLE_MS).toBe(60_000);
    expect(w.isOpen()).toBe(true);
    t += 59_999;
    expect(w.isOpen()).toBe(true);
    t += 2;
    expect(w.isOpen()).toBe(false);
  });

  it('open again from the moment it is told to stop (SIGTERM), for good', () => {
    let t = 0;
    const w = createUpdateWindow({ now: () => t, startedAt: 0 });
    t = 3_600_000;
    expect(w.isOpen()).toBe(false);
    w.markStopping();
    expect(w.isOpen()).toBe(true);
    t += 3_600_000;
    expect(w.isOpen()).toBe(true);
  });
});
