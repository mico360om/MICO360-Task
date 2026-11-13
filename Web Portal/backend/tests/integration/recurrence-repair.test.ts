import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService, REPAIR_WINDOW_DAYS } from '../../src/modules/tasks/recurrence-service';
import { createStatusChangeEffects } from '../../src/modules/tasks/task-status-effects';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import type { RecurrenceRule } from '../../src/modules/tasks/recurrence';
import { runBackfill } from './company-helpers';
import { batch4aWorld } from './batch4a-helpers';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { testPrisma } from './test-prisma';

// Review fix #14 (13 Nov 2026): completing a repeating task commits the move first, then makes the next
// copy; when that step failed once, the series stopped for good — a retry changed nothing (same column)
// and the hourly sweep only handled on-schedule series. The hourly sweep now makes the missing next copy
// of a recently completed on-completion series, strictly: only when no copy of it exists anywhere (in
// the Recycle Bin, archived, merged or moved to another project), within the last REPAIR_WINDOW_DAYS,
// for a rule still running. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// As the server's client (lib/prisma.ts): save conflicts are tried again, as on the live site (1.23.31).
const prisma = testPrisma();
const world = batch4aWorld(prisma, 'RRP');
const TZ = 'Asia/Muscat';
const DAY = 24 * 60 * 60 * 1000;
const daily: RecurrenceRule = { freq: 'DAILY', interval: 1 };
const errors: string[] = [];
const port = createPrismaRecurrencePort(prisma, { timeZone: TZ });
const recurrence = createRecurrenceService({ tasks: port, timeZone: TZ, onError: (_e, id) => void errors.push(id) });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  errors.length = 0;
  await world.clean();
});
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

async function setup() {
  const owner = await world.user(true);
  const b = await world.project(owner.id);
  await runBackfill(prisma);
  return { owner, ...b };
}
/** A repeating task completed `daysAgo` days ago whose next copy was never made (the rule is still on it). */
async function brokenHead(b: Awaited<ReturnType<typeof setup>>, opts: { daysAgo?: number; rule?: RecurrenceRule; extra?: Record<string, unknown> } = {}) {
  const at = new Date(Date.now() - (opts.daysAgo ?? 1) * DAY);
  return world.task(b.p.id, b.p.code, b.done.id, b.owner.id, {
    dueDate: new Date(at.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
    completedAt: at,
    progress: 100,
    recurrenceRule: (opts.rule ?? daily) as unknown as Prisma.InputJsonValue,
    ...opts.extra,
  });
}
const copiesOf = (id: string) => prisma.task.count({ where: { recurrenceSourceId: id } });

describe('the hourly sweep repairs a missed next copy (review fix #14)', () => {
  it('the repro: the copy fails once at completion; a retry makes none; the sweep makes exactly one, and a second sweep none', async () => {
    const b = await setup();
    let failOnce = true;
    const flaky = {
      ...port,
      spawnNext: async (...a: Parameters<typeof port.spawnNext>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('simulated transient database error');
        }
        return port.spawnNext(...a);
      },
    };
    const onComplete = createRecurrenceService({ tasks: flaky, timeZone: TZ });
    const effects = createStatusChangeEffects({
      column: (id) => prisma.kanbanColumn.findUnique({ where: { id }, select: { name: true, category: true } }),
      nextCopy: (task) => onComplete.onTaskCompleted({ id: task.id, dueDate: task.dueDate, recurrenceRule: task.recurrenceRule, recurrenceParentId: task.recurrenceParentId }),
      announceCopy: async () => {},
      followActionItems: async () => {},
      recipients: async () => [],
      notify: async () => {},
      record: async () => {},
      onError: () => {},
    });
    const svc = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, onMoved: (t, prev, actor, extra) => effects(t, prev, actor, extra ?? {}) });
    const t = await world.task(b.p.id, b.p.code, b.todo.id, b.owner.id, { dueDate: new Date(), recurrenceRule: daily as unknown as Prisma.InputJsonValue });
    await svc.moveTask(t.id, b.done.id, undefined, b.owner.id).catch(() => undefined);
    await svc.moveTask(t.id, b.done.id, undefined, b.owner.id).catch(() => undefined);
    expect(await copiesOf(t.id)).toBe(0);
    expect(await recurrence.runSchedule()).toEqual([]);
    const made = await recurrence.repairMissedCopies();
    expect(made).toEqual([{ headId: t.id, copy: expect.objectContaining({ projectId: b.p.id }) }]);
    expect(await copiesOf(t.id)).toBe(1);
    const copy = await prisma.task.findFirstOrThrow({ where: { recurrenceSourceId: t.id } });
    expect(copy.recurrenceRule).toMatchObject({ freq: 'DAILY', interval: 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).recurrenceRule).toBeNull();
    expect(await recurrence.repairMissedCopies()).toEqual([]);
    expect(await copiesOf(t.id)).toBe(1);
  });

  it('a copy that exists anywhere is never made again: in the Recycle Bin, archived, merged, or moved to another project', async () => {
    const b = await setup();
    const elsewhere = await world.project(b.owner.id);
    const places: Array<[string, Record<string, unknown>]> = [
      ['binned', { deletedAt: new Date() }],
      ['archived', { archivedAt: new Date() }],
      ['merged', { deletedAt: new Date(), mergedAt: new Date() }],
      ['moved', { projectId: elsewhere.p.id, columnId: elsewhere.todo.id }],
    ];
    const heads: string[] = [];
    for (const [, where] of places) {
      // A head that still carries its rule beside an existing copy (as data an older server could leave).
      const head = await brokenHead(b);
      heads.push(head.id);
      await world.task(b.p.id, b.p.code, b.todo.id, b.owner.id, { recurrenceSourceId: head.id, recurrenceParentId: head.id, ...where });
    }
    expect(await recurrence.repairMissedCopies()).toEqual([]);
    for (const id of heads) expect(await copiesOf(id)).toBe(1);
  });

  it('only recent completions: one finished more than the window ago is left alone', async () => {
    const b = await setup();
    const old = await brokenHead(b, { daysAgo: REPAIR_WINDOW_DAYS + 1 });
    const recent = await brokenHead(b, { daysAgo: REPAIR_WINDOW_DAYS - 1 });
    const made = await recurrence.repairMissedCopies();
    expect(made.map((m) => m.headId)).toEqual([recent.id]);
    expect(await copiesOf(old.id)).toBe(0);
  });

  it('a rule that has ended or was switched off makes nothing: past its end date, its count reached, paused', async () => {
    const b = await setup();
    const ended = await brokenHead(b, { rule: { ...daily, until: new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10) } });
    const full = await brokenHead(b, { rule: { ...daily, count: 1 } });
    const paused = await brokenHead(b, { rule: { ...daily, paused: true } });
    expect(await recurrence.repairMissedCopies()).toEqual([]);
    for (const t of [ended, full, paused]) expect(await copiesOf(t.id)).toBe(0);
  });

  it('only on-completion series: an on-schedule one is the schedule sweep’s; an open task, a binned head and one in a completed project are left alone', async () => {
    const b = await setup();
    const scheduled = await brokenHead(b, { rule: { ...daily, createNext: 'ON_SCHEDULE' } });
    const open = await world.task(b.p.id, b.p.code, b.todo.id, b.owner.id, { dueDate: new Date(), recurrenceRule: daily as unknown as Prisma.InputJsonValue });
    // Reopened after it was finished (its date can linger from before): not done now.
    const reopened = await world.task(b.p.id, b.p.code, b.todo.id, b.owner.id, { completedAt: new Date(), recurrenceRule: daily as unknown as Prisma.InputJsonValue });
    const binned = await brokenHead(b, { extra: { deletedAt: new Date() } });
    const closed = await world.project(b.owner.id);
    await prisma.project.update({ where: { id: closed.p.id }, data: { status: 'COMPLETED' } });
    const inClosed = await world.task(closed.p.id, closed.p.code, closed.done.id, b.owner.id, { completedAt: new Date(), recurrenceRule: daily as unknown as Prisma.InputJsonValue });
    expect(await recurrence.repairMissedCopies()).toEqual([]);
    for (const t of [scheduled, open, reopened, binned, inClosed]) expect(await copiesOf(t.id)).toBe(0);
  });

  it('an archived finished head (tidied away) still gets its series’ next copy, as a scheduled series does', async () => {
    const b = await setup();
    const head = await brokenHead(b, { extra: { archivedAt: new Date() } });
    expect((await recurrence.repairMissedCopies()).map((m) => m.headId)).toEqual([head.id]);
  });

  it('a head reopened just before its repair gets no copy (the repair re-checks “still done” under the hold)', async () => {
    const b = await setup();
    const head = await brokenHead(b);
    const racing = createPrismaRecurrencePort(prisma, {
      timeZone: TZ,
      beforeCopy: async (id) => {
        await prisma.task.update({ where: { id }, data: { columnId: b.todo.id, completedAt: null, progress: 0 } });
      },
    });
    const svc = createRecurrenceService({ tasks: racing, timeZone: TZ });
    expect(await svc.repairMissedCopies()).toEqual([]);
    expect(await copiesOf(head.id)).toBe(0);
  });

  it('review: an edit to the series between the sweep’s reading and its copy (paused here) makes no copy — the next sweep reads it again', async () => {
    const b = await setup();
    const head = await brokenHead(b);
    const racing = createPrismaRecurrencePort(prisma, {
      timeZone: TZ,
      beforeCopy: async (id) => {
        await prisma.task.update({ where: { id }, data: { recurrenceRule: { ...daily, paused: true } as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      },
    });
    expect(await createRecurrenceService({ tasks: racing, timeZone: TZ }).repairMissedCopies()).toEqual([]);
    expect(await copiesOf(head.id)).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: head.id } })).recurrenceRule).toMatchObject({ paused: true });
  });

  it('review: every candidate is read, page by page — finished on-schedule or ended series can’t crowd out one to repair', async () => {
    const b = await setup();
    for (let i = 0; i < 5; i++) await brokenHead(b, { daysAgo: 10, rule: { ...daily, createNext: 'ON_SCHEDULE' } });
    const broken = await brokenHead(b, { daysAgo: 2 });
    const paged = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, repairPageSize: 2 }), timeZone: TZ });
    expect((await paged.repairMissedCopies()).map((m) => m.headId)).toEqual([broken.id]);
  });

  it('the sweep and a completion at the same moment: one copy', async () => {
    const b = await setup();
    for (let i = 0; i < 8; i++) {
      const head = await brokenHead(b);
      await Promise.allSettled([recurrence.repairMissedCopies(), recurrence.onTaskCompleted({ id: head.id, dueDate: head.dueDate, recurrenceRule: daily, recurrenceParentId: null })]);
      expect(await copiesOf(head.id)).toBe(1);
    }
  });

  it('the read-only count for phpMyAdmin (run on live before deploying) counts what the sweep would look at', async () => {
    const b = await setup();
    const repairable = [await brokenHead(b), await brokenHead(b, { daysAgo: 13, extra: { archivedAt: new Date() } })];
    const ended = await brokenHead(b, { rule: { ...daily, until: new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10) } });
    await brokenHead(b, { daysAgo: REPAIR_WINDOW_DAYS + 2 });
    await brokenHead(b, { rule: { ...daily, createNext: 'ON_SCHEDULE' } });
    await brokenHead(b, { rule: { ...daily, paused: true } });
    await brokenHead(b, { extra: { deletedAt: new Date() } });
    const copied = await brokenHead(b);
    await world.task(b.p.id, b.p.code, b.todo.id, b.owner.id, { recurrenceSourceId: copied.id, deletedAt: new Date() });
    const mine = { projectId: b.p.id };
    const sql = PHPMYADMIN_COUNT_SQL.replace('WHERE t.deletedAt IS NULL', `WHERE t.projectId = '${mine.projectId}' AND t.deletedAt IS NULL`);
    expect(portabilityProblems(PHPMYADMIN_COUNT_SQL)).toEqual([]);
    const [row] = await prisma.$queryRawUnsafe<Array<{ series_to_repair: bigint | number }>>(sql);
    // An upper bound: a series past its end date (or count) is counted but makes nothing.
    expect(Number(row!.series_to_repair)).toBe(repairable.length + 1);
    const made = await recurrence.repairMissedCopies();
    expect(made.map((m) => m.headId).sort()).toEqual(repairable.map((t) => t.id).sort());
    expect(await copiesOf(ended.id)).toBe(0);
  });
});

/** Review fix #14: the owner's read-only count (MariaDB and MySQL alike), given in the ledger and the report. */
const PHPMYADMIN_COUNT_SQL = `SELECT COUNT(*) AS series_to_repair
FROM tasks t
JOIN kanban_columns c ON c.id = t.columnId
JOIN projects p ON p.id = t.projectId
WHERE t.deletedAt IS NULL
  AND t.recurrenceRule IS NOT NULL
  AND c.category = 'DONE'
  AND t.completedAt >= UTC_TIMESTAMP() - INTERVAL 14 DAY
  AND p.deletedAt IS NULL AND p.status NOT IN ('COMPLETED', 'ARCHIVED')
  AND (NOT EXISTS (SELECT 1 FROM project_companies lpc WHERE lpc.projectId = p.id)
       OR EXISTS (SELECT 1 FROM project_companies lpc JOIN companies lc ON lc.id = lpc.companyId WHERE lpc.projectId = p.id AND lc.status = 'ACTIVE'))
  AND (t.inspectionFormId IS NULL OR EXISTS (SELECT 1 FROM inspection_forms f WHERE f.id = t.inspectionFormId AND f.deletedAt IS NULL))
  AND REPLACE(CAST(t.recurrenceRule AS CHAR), ' ', '') NOT LIKE '%"createNext":"ON_SCHEDULE"%'
  AND REPLACE(CAST(t.recurrenceRule AS CHAR), ' ', '') NOT LIKE '%"paused":true%'
  AND NOT EXISTS (SELECT 1 FROM tasks n WHERE n.recurrenceSourceId = t.id);`;
