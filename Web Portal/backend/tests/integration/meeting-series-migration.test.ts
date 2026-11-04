import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';
import { SERIES_BACKFILL_SQL_PATH } from '../../src/modules/meetings/named-series';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. `migrate deploy` has run the
// series backfill once already (on whatever the database held then); meetings made here afterwards
// have no series, as meetings on a site upgraded from 1.22 do. The backfill is then run again,
// statement by statement — twice — and its results checked.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

const TAG = 'smig';
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;
const CO = `company_${TAG}`;
const WEEKLY = { freq: 'WEEKLY', interval: 1, weekdays: [2] } as Prisma.InputJsonValue;

function statements(): string[] {
  return readFileSync(SERIES_BACKFILL_SQL_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
const runBackfill = async () => {
  for (const s of statements()) await prisma.$executeRawUnsafe(s);
};

const ids: Record<string, string> = {};
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 6, 0));

async function meeting(
  key: string,
  data: { title?: string; start: number; parent?: string; rule?: Prisma.InputJsonValue | typeof Prisma.JsonNull; projectId?: string | null; companyId?: string | null; deleted?: boolean; seriesId?: string; createdBy?: string },
) {
  const m = await prisma.meeting.create({
    data: {
      title: data.title ?? key,
      startAt: day(data.start),
      organizerId: `${TAG}_org`,
      createdById: data.createdBy ?? `${TAG}_maker`,
      projectId: data.projectId === undefined ? P1 : data.projectId,
      companyId: data.companyId ?? null,
      recurrenceParentId: data.parent ? ids[data.parent] : null,
      recurrenceStart: data.parent || data.rule ? day(data.start) : null,
      ...(data.rule !== undefined ? { recurrenceRule: data.rule } : {}),
      deletedAt: data.deleted ? new Date() : null,
      seriesId: data.seriesId ?? null,
    },
  });
  ids[key] = m.id;
  return m;
}

async function cleanup() {
  await prisma.meeting.deleteMany({ where: { organizerId: `${TAG}_org` } });
  await prisma.meetingSeries.deleteMany({ where: { OR: [{ projectId: { in: [P1, P2] } }, { companyId: CO }, { id: { startsWith: `${TAG}_` } }] } });
  await prisma.company.deleteMany({ where: { id: CO } });
}

const seriesOf = async (key: string) => (await prisma.meeting.findUniqueOrThrow({ where: { id: ids[key] } })).seriesId;
const snapshot = async () => ({
  series: await prisma.meetingSeries.findMany({ where: { OR: [{ projectId: { in: [P1, P2] } }, { companyId: CO }] }, orderBy: { id: 'asc' } }),
  links: (await prisma.meeting.findMany({ where: { organizerId: `${TAG}_org` }, select: { id: true, seriesId: true }, orderBy: { id: 'asc' } })),
});

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  await prisma.company.create({ data: { id: CO, name: 'Series Migration Co', code: 'SMIG' } });
  // A: a weekly family; one of its meetings deleted.
  await meeting('A0', { title: 'Weekly site meeting', start: 0, rule: WEEKLY });
  await meeting('A1', { title: 'Weekly site meeting (moved)', start: 7, parent: 'A0' });
  await meeting('A2', { start: 14, parent: 'A0', deleted: true });
  await meeting('A3', { start: 21, parent: 'A0' });
  // B: a family split earlier — its old first meeting (ended) and the new first meeting of the rest.
  await meeting('B0', { title: 'Monthly review', start: 1, rule: { ...(WEEKLY as object), until: '2026-09-09' } as Prisma.InputJsonValue });
  await meeting('B1', { title: 'Monthly review', start: 8, parent: 'B0' });
  await meeting('B2', { title: 'Monthly review (new time)', start: 15, rule: WEEKLY });
  await meeting('B3', { title: 'Monthly review (new time)', start: 22, parent: 'B2' });
  // C: a family with one meeting moved on its own to another project.
  await meeting('C0', { title: 'Design sync', start: 2, rule: WEEKLY });
  await meeting('C1', { start: 9, parent: 'C0' });
  await meeting('C2', { title: 'Design sync (moved)', start: 16, parent: 'C0', projectId: P2 });
  // D: a family without a project, in a company.
  await meeting('D0', { title: 'Company huddle', start: 3, rule: WEEKLY, projectId: null, companyId: CO, createdBy: `${TAG}_d_maker` });
  await meeting('D1', { start: 10, parent: 'D0', projectId: null, companyId: CO });
  // E: a one-off. G: a one-off whose rule is JSON null (not a repeat).
  await meeting('E', { start: 4 });
  await meeting('G', { start: 5, rule: Prisma.JsonNull });
  // F: a family whose first meeting was deleted: named after its earliest meeting still there.
  await meeting('F0', { title: 'Old title', start: 6, rule: WEEKLY, deleted: true });
  await meeting('F1', { title: 'Supplier call', start: 13, parent: 'F0' });
  await meeting('F2', { title: 'Supplier call later', start: 20, parent: 'F0' });
  // H: a family already in a series (made in 1.23): left as it is.
  await prisma.meetingSeries.create({ data: { id: `${TAG}_manual`, name: 'Hand-made', projectId: P1, createdById: `${TAG}_maker` } });
  await meeting('H0', { start: 11, rule: WEEKLY, seriesId: `${TAG}_manual` });
  await meeting('H1', { start: 18, parent: 'H0', seriesId: `${TAG}_manual` });
  await runBackfill();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Meeting series backfill (migration 20261105110100)', () => {
  it('gives each repeat family its own series, named after its first meeting, with every meeting still there', async () => {
    const a = await seriesOf('A0');
    expect(a).toBeTruthy();
    expect(await seriesOf('A1')).toBe(a);
    expect(await seriesOf('A3')).toBe(a);
    expect(await seriesOf('A2')).toBeNull(); // deleted meetings are left alone
    const row = await prisma.meetingSeries.findUniqueOrThrow({ where: { id: a! } });
    expect(row).toMatchObject({ name: 'Weekly site meeting', projectId: P1, companyId: null, auto: true, createdById: `${TAG}_maker` });
  });

  it('makes a family that was split earlier two series (the migration does not guess)', async () => {
    const old = await seriesOf('B0');
    const fresh = await seriesOf('B2');
    expect(old).toBeTruthy();
    expect(fresh).toBeTruthy();
    expect(old).not.toBe(fresh);
    expect(await seriesOf('B1')).toBe(old);
    expect(await seriesOf('B3')).toBe(fresh);
    expect((await prisma.meetingSeries.findUniqueOrThrow({ where: { id: fresh! } })).name).toBe('Monthly review (new time)');
  });

  it('keeps a series to one project: a meeting moved to another project gets a series there', async () => {
    const here = await seriesOf('C0');
    expect(await seriesOf('C1')).toBe(here);
    const there = await seriesOf('C2');
    expect(there).toBeTruthy();
    expect(there).not.toBe(here);
    expect(await prisma.meetingSeries.findUniqueOrThrow({ where: { id: there! } })).toMatchObject({ projectId: P2, name: 'Design sync (moved)' });
  });

  it('files a family without a project under its company', async () => {
    const d = await seriesOf('D0');
    expect(await seriesOf('D1')).toBe(d);
    expect(await prisma.meetingSeries.findUniqueOrThrow({ where: { id: d! } })).toMatchObject({ projectId: null, companyId: CO, name: 'Company huddle', createdById: `${TAG}_d_maker` });
  });

  it('names a family whose first meeting was deleted after its earliest meeting still there', async () => {
    const f = await seriesOf('F1');
    expect(await seriesOf('F2')).toBe(f);
    expect(await seriesOf('F0')).toBeNull();
    expect((await prisma.meetingSeries.findUniqueOrThrow({ where: { id: f! } })).name).toBe('Supplier call');
  });

  it('leaves one-off meetings and meetings already in a series alone', async () => {
    expect(await seriesOf('E')).toBeNull();
    expect(await seriesOf('G')).toBeNull();
    expect(await seriesOf('H0')).toBe(`${TAG}_manual`);
    expect(await seriesOf('H1')).toBe(`${TAG}_manual`);
    // A: 1, B: 2, C: 2, D: 1, F: 1 — and the hand-made one.
    const made = await prisma.meetingSeries.count({ where: { OR: [{ projectId: { in: [P1, P2] } }, { companyId: CO }] } });
    expect(made).toBe(8);
  });

  it('is safe to run again: nothing changes', async () => {
    const before = await snapshot();
    await runBackfill();
    await runBackfill();
    expect(await snapshot()).toEqual(before);
  });

  it('does nothing on a database without repeating meetings (an empty or a fresh site)', async () => {
    await cleanup();
    const series = await prisma.meetingSeries.count();
    await runBackfill();
    expect(await prisma.meetingSeries.count()).toBe(series);
  });
});
