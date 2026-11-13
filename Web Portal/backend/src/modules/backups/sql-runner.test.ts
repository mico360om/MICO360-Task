import { describe, it, expect, vi } from 'vitest';
import { prismaSqlRunner } from './sql-runner';
import { withSaveRetries } from '../../lib/save-retry';

// 1.23.29 — the server's client tries a transaction again whole after a save conflict (lib/save-retry), but a
// backup or restore transaction runs ONCE: a backup writes its table files during it, a restore reads its
// upload stream once and its DROP TABLE commits on its own. A conflict there fails the run, as before.
describe('prismaSqlRunner on the server’s client (with the save retry layer)', () => {
  it('a backup or restore transaction is never tried again by the layer', async () => {
    const conflict = Object.assign(new Error('Raw query failed. Code: `1213`.'), { code: 'P2010', meta: { code: '1213' } });
    const tx = { $queryRawUnsafe: vi.fn(async () => []), $executeRawUnsafe: vi.fn(async () => 0) };
    const client = {
      $use: vi.fn(),
      $queryRawUnsafe: vi.fn(async () => []),
      $executeRawUnsafe: vi.fn(async () => 0),
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
        await fn(tx);
        throw conflict;
      }),
    };
    const own = client.$transaction;
    withSaveRetries(client, { pause: async () => {} });
    const runner = prismaSqlRunner(client as never);
    let runs = 0;
    await expect(
      runner.transaction(async (t) => {
        runs++;
        await t.execute('DROP TABLE IF EXISTS `x`');
      }),
    ).rejects.toBe(conflict);
    expect(runs).toBe(1);
    expect(own).toHaveBeenCalledTimes(1);
  });
});
