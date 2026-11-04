import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaErrorLogRepository } from '../../src/modules/error-log/prisma-error-log-repository';
import { createErrorLogService } from '../../src/modules/error-log/error-log-service';
import { createMapStore } from '../../src/modules/error-log/stack';
import { createPrismaSettingsRepository } from '../../src/modules/settings/prisma-settings-repository';
import { createSettingsService } from '../../src/modules/settings/settings-service';
import type { NewOccurrence } from '../../src/modules/error-log/error-log-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaErrorLogRepository(prisma);
let clock = new Date('2026-11-05T08:00:00Z');
const service = createErrorLogService({
  repo,
  maps: createMapStore({ webRoot: null }),
  now: () => clock,
  timeZone: 'Asia/Muscat',
  serverVersion: () => '1.22.4',
  collecting: async () => true,
  warn: (m, meta) => {
    throw new Error(`unexpected warning: ${m} ${JSON.stringify(meta)}`);
  },
});

const occurrence = (over: Partial<NewOccurrence['event']> = {}, fingerprint = 'a'.repeat(64)): NewOccurrence => ({
  fingerprint,
  kind: 'ERROR',
  title: 'TypeError: x is undefined',
  topFile: 'src/pages/BoardPage.tsx',
  topLine: 42,
  topFunction: 'loadBoard',
  event: {
    at: clock,
    kind: 'ERROR',
    detail: 'error',
    message: 'TypeError: x is undefined',
    stack: 'TypeError\n    at q (src/pages/BoardPage.tsx:42:1)',
    page: '/board',
    job: null,
    resource: null,
    value: null,
    count: 1,
    version: '1.22.4',
    browser: 'Chrome 130',
    system: 'Windows',
    screen: '1440x900',
    userId: 'u1',
    signedIn: true,
    ...over,
  },
});

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await prisma.errorEvent.deleteMany({});
  await prisma.errorGroup.deleteMany({});
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'errorLog.' } } });
  clock = new Date('2026-11-05T08:00:00Z');
});
afterAll(async () => {
  await prisma.errorEvent.deleteMany({});
  await prisma.errorGroup.deleteMany({});
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'errorLog.' } } });
  await prisma.$disconnect();
});

describe('error_groups / error_events (integration)', () => {
  it('one row per fingerprint: counts and people add up, the newest 20 occurrences are kept', async () => {
    const first = await repo.record(occurrence());
    expect(first.created).toBe(true);
    for (let i = 0; i < 24; i++) {
      clock = new Date(clock.getTime() + 1000);
      await repo.record(occurrence({ at: clock, userId: i % 2 ? 'u2' : 'u1', count: 2 }));
    }
    const g = (await repo.get(first.groupId))!;
    expect(g).toMatchObject({ count: 49, peopleCount: 2, people: ['u1', 'u2'], lastSeenAt: clock, topFile: 'src/pages/BoardPage.tsx', topLine: 42, status: 'OPEN' });
    const events = await repo.events(first.groupId);
    expect(events).toHaveLength(20);
    expect(events[0]!.at).toEqual(clock);
    expect(await prisma.errorEvent.count({ where: { groupId: first.groupId } })).toBe(20);
  });

  it('several reports of a new error at once still make one row', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => repo.record(occurrence({ userId: `p${i}` }))));
    expect(await prisma.errorGroup.count()).toBe(1);
    const g = await prisma.errorGroup.findFirstOrThrow();
    expect(g.count).toBe(8);
    expect(await prisma.errorEvent.count()).toBe(8);
  });

  it('lists by kind, date, search and status, newest first, with a cursor; counts per kind; the most common page', async () => {
    await repo.record(occurrence());
    await repo.record(occurrence({ page: '/projects/:id' }));
    await repo.record(occurrence({ page: '/projects/:id' }));
    clock = new Date(clock.getTime() + 60_000);
    await repo.record({ ...occurrence({ at: clock, kind: 'SERVER', page: null, job: 'nightly-backup', browser: null, userId: null, signedIn: false }, 'b'.repeat(64)), kind: 'SERVER', title: 'nightly backup sweep failed: ENOSPC' });
    clock = new Date(clock.getTime() + 60_000);
    await repo.record({ ...occurrence({ at: clock, kind: 'SLOW', detail: 'load', page: '/board', value: 9000 }, 'c'.repeat(64)), kind: 'SLOW', title: 'Slow page load' });

    const since = new Date('2026-11-01T00:00:00Z');
    const all = await repo.list({ kinds: null, since, search: null, status: 'OPEN', limit: 10, before: null });
    expect(all.map((g) => g.kind)).toEqual(['SLOW', 'SERVER', 'ERROR']);
    expect((await repo.list({ kinds: ['ERROR', 'NETWORK'], since, search: null, status: 'OPEN', limit: 10, before: null })).map((g) => g.kind)).toEqual(['ERROR']);
    expect((await repo.list({ kinds: null, since, search: 'backup', status: 'OPEN', limit: 10, before: null })).map((g) => g.kind)).toEqual(['SERVER']);
    expect((await repo.list({ kinds: null, since, search: 'nightly-backup', status: 'OPEN', limit: 10, before: null })).map((g) => g.kind)).toEqual(['SERVER']); // a job's name
    expect((await repo.list({ kinds: null, since, search: 'projects', status: 'OPEN', limit: 10, before: null })).map((g) => g.kind)).toEqual(['ERROR']); // a page
    expect(await repo.list({ kinds: null, since: new Date('2026-12-01T00:00:00Z'), search: null, status: 'OPEN', limit: 10, before: null })).toEqual([]);
    const page1 = await repo.list({ kinds: null, since, search: null, status: 'OPEN', limit: 2, before: null });
    const page2 = await repo.list({ kinds: null, since, search: null, status: 'OPEN', limit: 2, before: { lastSeenAt: page1[1]!.lastSeenAt, id: page1[1]!.id } });
    expect([...page1, ...page2].map((g) => g.kind)).toEqual(['SLOW', 'SERVER', 'ERROR']);
    expect(await repo.countsByKind(since, 'OPEN')).toEqual({ ERROR: 1, SERVER: 1, SLOW: 1 });
    const pages = await repo.topPages(all.map((g) => g.id));
    expect(pages.get(all[2]!.id)).toBe('/projects/:id');
    expect(pages.get(all[1]!.id)).toBe('nightly-backup');
  });

  it('mark as fixed, back from a newer version, and “Not fixed” — through the service', async () => {
    const { groupId } = await repo.record(occurrence());
    expect(await service.markFixed(groupId, 'admin1')).toMatchObject({ status: 'FIXED', fixedInVersion: '1.22.4', fixedById: 'admin1' });
    clock = new Date(clock.getTime() + 60_000);
    expect((await repo.record(occurrence({ at: clock, version: '1.22.4' }))).reopened).toBe(false);
    expect((await repo.get(groupId))!.status).toBe('FIXED');
    clock = new Date(clock.getTime() + 60_000);
    expect((await repo.record(occurrence({ at: clock, version: '1.22.5' }))).reopened).toBe(true);
    expect(await repo.get(groupId)).toMatchObject({ status: 'OPEN', reopenedAt: clock, lastVersion: '1.22.5' });
    await service.markFixed(groupId, 'admin1');
    expect(await service.reopen(groupId)).toMatchObject({ status: 'OPEN', fixedAt: null, fixedInVersion: null });
    expect(await service.markFixed('nope', 'admin1')).toBeNull();
  });

  it('retention: occurrences older than 30 days go, and rows not seen in 30 days with them', async () => {
    const old = await repo.record(occurrence({ at: new Date('2026-09-01T00:00:00Z') }, 'd'.repeat(64)));
    const kept = await repo.record(occurrence({ at: new Date('2026-09-01T00:00:00Z') }));
    await repo.record(occurrence({ at: new Date('2026-11-05T07:00:00Z') }));
    expect(await service.sweep()).toEqual({ groups: 1, events: 2 });
    expect(await repo.get(old.groupId)).toBeNull();
    expect((await repo.events(kept.groupId)).map((e) => e.at)).toEqual([new Date('2026-11-05T07:00:00Z')]);
  });

  it('visits are hidden system setting rows: never listed by, or writable through, the settings API', async () => {
    expect(await service.visit('admin1')).toBeNull();
    clock = new Date('2026-11-06T09:00:00Z');
    expect(await service.visit('admin1')).toEqual(new Date('2026-11-05T08:00:00Z'));
    expect(await repo.lastVisit('admin1')).toEqual(clock);
    const settings = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
    expect((await settings.getAll()).map((s) => s.key).filter((k) => k.startsWith('errorLog.lastVisit'))).toEqual([]);
    await settings.set('errorLog.collectBrowserErrors', false);
    expect(await settings.collectBrowserErrors()).toBe(false);
  });
});
