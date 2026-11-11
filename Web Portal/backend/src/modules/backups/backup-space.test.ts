import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diskFree, estimateBackupBytes } from './backup-space';
import type { SqlRunner } from './sql-runner';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('room for a backup', () => {
  it('the free space of the disk the folder is on', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mico-bk-space-'));
    const free = await diskFree(dir);
    expect(free).toBeGreaterThan(0);
    // Asks the nearest folder that exists (the same disk; other tests may be writing to it meanwhile).
    const nested = await diskFree(join(dir, 'not-made-yet', 'deeper'));
    expect(Math.abs(nested! - free!)).toBeLessThan(512 * 1024 * 1024);
  });

  it('needs the uploads, twice the database (the work files and the copy) and 50 MB to spare', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mico-bk-space-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(1000));
    writeFileSync(join(dir, 'sub', 'b.bin'), Buffer.alloc(500));
    const sql = { query: async () => [{ n: 4000n }] } as unknown as SqlRunner;
    expect(await estimateBackupBytes(sql, dir)).toBe(1500 + 2 * 4000 + 50 * 1024 * 1024);
    expect(await estimateBackupBytes(sql, join(dir, 'missing'))).toBe(2 * 4000 + 50 * 1024 * 1024);
  });

  it('counts the private training folder too (it is in the copy)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mico-bk-space-'));
    mkdirSync(join(dir, 'uploads'));
    mkdirSync(join(dir, 'training-files'));
    writeFileSync(join(dir, 'uploads', 'a.bin'), Buffer.alloc(1000));
    writeFileSync(join(dir, 'training-files', 't.pdf'), Buffer.alloc(300));
    const sql = { query: async () => [{ n: 0 }] } as unknown as SqlRunner;
    expect(await estimateBackupBytes(sql, join(dir, 'uploads'), [join(dir, 'training-files'), join(dir, 'missing')])).toBe(1300 + 50 * 1024 * 1024);
  });
});
