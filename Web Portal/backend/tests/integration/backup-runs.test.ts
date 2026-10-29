import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaBackupRepository, createPrismaBackupLock } from '../../src/modules/backups/prisma-backup-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaBackupRepository(prisma);
const LOCK = 'backup-run-test';

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await prisma.backupRun.deleteMany({});
  await prisma.jobLock.deleteMany({ where: { name: LOCK } });
});
afterAll(async () => {
  await prisma.backupRun.deleteMany({});
  await prisma.jobLock.deleteMany({ where: { name: LOCK } });
  await prisma.$disconnect();
});

const at = (iso: string) => new Date(iso);

describe('backup_runs (integration)', () => {
  it('creates a RUNNING row, finishes it, and reads sizes back as numbers', async () => {
    const row = await repo.create({ trigger: 'NIGHTLY', localDate: '2026-10-30', startedAt: at('2026-10-29T22:00:00Z'), requestedById: null });
    expect(row).toMatchObject({ status: 'RUNNING', trigger: 'NIGHTLY', localDate: '2026-10-30', fileName: null, sizeBytes: null, encrypted: false });
    const done = await repo.update(row.id, { status: 'OK', fileName: 'x.tar.gz', sizeBytes: 5_000_000_000, sha256: 'c'.repeat(64), tableCount: 65, rowCount: 12, fileCount: 3, finishedAt: at('2026-10-29T22:01:00Z') });
    expect(done).toMatchObject({ status: 'OK', sizeBytes: 5_000_000_000, tableCount: 65 });
    expect(typeof done.sizeBytes).toBe('number');
    expect(await repo.find(row.id)).toEqual(done);
  });

  it('updateIfRunning changes only a row that is still RUNNING', async () => {
    const row = await repo.create({ trigger: 'MANUAL', localDate: '2026-10-30', startedAt: at('2026-10-30T06:00:00Z'), requestedById: 'u1' });
    expect(await repo.updateIfRunning(row.id, { status: 'FAILED', error: 'stopped' })).toBe(true);
    expect(await repo.updateIfRunning(row.id, { status: 'FAILED', error: 'again' })).toBe(false);
    expect((await repo.find(row.id))!.error).toBe('stopped');
  });

  it('lists good copies newest first, running ones, a night’s nightly tries; removes and prunes', async () => {
    const mk = async (trigger: 'NIGHTLY' | 'MANUAL', day: string, status: 'OK' | 'FAILED' | 'RUNNING') => {
      const r = await repo.create({ trigger, localDate: day, startedAt: at(`${day}T02:00:00+04:00`), requestedById: null });
      if (status !== 'RUNNING') await repo.update(r.id, { status });
      return r.id;
    };
    const a = await mk('NIGHTLY', '2026-10-28', 'OK');
    const b = await mk('NIGHTLY', '2026-10-29', 'OK');
    const c = await mk('NIGHTLY', '2026-10-30', 'FAILED');
    const d = await mk('MANUAL', '2026-10-30', 'RUNNING');
    const old = await mk('NIGHTLY', '2026-08-01', 'FAILED');
    expect((await repo.ok()).map((r) => r.id)).toEqual([b, a]);
    expect((await repo.running()).map((r) => r.id)).toEqual([d]);
    expect((await repo.nightlyOn('2026-10-30')).map((r) => r.id)).toEqual([c]);
    expect((await repo.recent(2)).map((r) => r.id).sort()).toEqual([c, d].sort());
    expect(await repo.pruneFailed(at('2026-10-01T00:00:00Z'))).toBe(1);
    expect(await repo.find(old)).toBeNull();
    await repo.remove([a, b]);
    expect(await repo.ok()).toEqual([]);
  });
});

describe('one backup at a time (job_locks lease)', () => {
  it('a second server can’t take the lock until the first releases it or stops renewing it', async () => {
    const first = createPrismaBackupLock(prisma, { name: LOCK, leaseMs: 5 * 60 * 1000 });
    const second = createPrismaBackupLock(prisma, { name: LOCK, leaseMs: 5 * 60 * 1000 });
    const t0 = at('2026-10-30T02:00:00Z');
    expect(await first.acquire(t0)).toBe(true);
    expect(await second.acquire(t0)).toBe(false);
    expect(await second.isHeld(t0)).toBe(true);
    // Renewed at 02:04, it is still held at 02:08.
    await first.renew(at('2026-10-30T02:04:00Z'));
    expect(await second.acquire(at('2026-10-30T02:08:00Z'))).toBe(false);
    // A server that stopped renewing: the lease runs out.
    expect(await second.acquire(at('2026-10-30T02:10:00Z'))).toBe(true);
    // The first one's release no longer frees what the second holds.
    await first.release();
    expect(await first.isHeld(at('2026-10-30T02:10:30Z'))).toBe(true);
    await second.release();
    expect(await first.isHeld(at('2026-10-30T02:10:30Z'))).toBe(false);
    expect(await first.acquire(at('2026-10-30T02:11:00Z'))).toBe(true);
    await first.release();
  });
});
