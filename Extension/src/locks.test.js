import { describe, it, expect } from 'vitest';
import { withLock } from './locks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [name, locks] of [['navigator.locks', undefined], ['in-process fallback', null]]) {
  describe(`withLock (${name})`, () => {
    it('runs holders of the same lock one at a time', async () => {
      const log = [];
      const job = (id) => withLock(`t-serial-${name}`, async () => {
        log.push(`start ${id}`);
        await sleep(5);
        log.push(`end ${id}`);
        return id;
      }, { locks });
      const results = await Promise.all([job(1), job(2), job(3)]);
      expect(results.map((r) => r.value)).toEqual([1, 2, 3]);
      expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
    });

    it('ifAvailable skips instead of waiting when the lock is held', async () => {
      let release;
      const held = withLock(`t-avail-${name}`, () => new Promise((r) => { release = r; }), { locks });
      await sleep(1);
      const skipped = await withLock(`t-avail-${name}`, async () => 'ran', { locks, ifAvailable: true });
      expect(skipped).toEqual({ acquired: false });
      release('done');
      expect(await held).toEqual({ acquired: true, value: 'done' });
      expect(await withLock(`t-avail-${name}`, async () => 'ran', { locks, ifAvailable: true })).toEqual({ acquired: true, value: 'ran' });
    });

    it('releases the lock when the holder throws', async () => {
      await expect(withLock(`t-throw-${name}`, async () => { throw new Error('boom'); }, { locks })).rejects.toThrow('boom');
      expect((await withLock(`t-throw-${name}`, async () => 1, { locks })).value).toBe(1);
    });
  });
}
