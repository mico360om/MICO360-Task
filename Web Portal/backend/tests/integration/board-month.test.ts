import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaArchiveLookup } from '../../src/modules/companies/archive-guard';
import { todayKey } from '../../src/lib/due-date';
import { monthDays, shiftMonth } from '../../src/modules/tasks/board-month';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Kanban Board: Monthly View — GET /tasks?month= over the real Prisma repository: the database window
// plus the month rule, each date combination, the company time zone (Muscat, UTC+4) at month edges,
// and who may see what (a project's board, All projects, an archived project read-only).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const cur = today.slice(0, 7);
const prev = shiftMonth(cur, -1);
const next = shiftMonth(cur, 1);
const old = shiftMonth(cur, -3);
const lastOfPrev = monthDays(prev).last;
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

let w: CompanyWorld;
let api: CompanyApp;
let paTodo = '';
let paDone = '';
let pbTodo = '';
const ids: Record<string, string> = {};

type Row = { id: string; key: string; projectId: string };
const keysOf = (rows: unknown) => (rows as Row[]).map((r) => r.key).sort();
const K = (name: string) => `MO${w.tag.toUpperCase()}-${name}`;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  paTodo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PA } })).id;
  paDone = (await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Done', category: 'DONE', position: 1 } })).id;
  pbTodo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PB } })).id;
  const make = async (name: string, data: Record<string, unknown>, projectId = w.projects.PA, columnId = paTodo) => {
    ids[name] = (await prisma.task.create({ data: { key: K(name), title: `${name} month`, projectId, columnId, createdById: w.people.ana, ...data } })).id;
  };
  await make('span', { startDate: day(`${prev}-05`), dueDate: day(`${next}-20`) });
  await make('dueOnly', { dueDate: day(`${next}-10`) });
  await make('startOld', { startDate: day(`${old}-03`) });
  // An automatic start at 21:30 UTC on the last day of last month is 01:30 on the 1st in Muscat.
  await make('startEdge', { startDate: new Date(`${lastOfPrev}T21:30:00.000Z`) });
  // Completed at 00:30 on the 1st in Muscat — and at 23:59 on the last day of last month.
  await make('doneEdge', { completedAt: new Date(`${lastOfPrev}T20:30:00.000Z`), dueDate: day(`${old}-01`) }, w.projects.PA, paDone);
  await make('doneLate', { completedAt: new Date(`${lastOfPrev}T19:59:00.000Z`) }, w.projects.PA, paDone);
  await make('donePrev', { completedAt: new Date(`${prev}-15T08:00:00.000Z`), dueDate: day(`${next}-01`) }, w.projects.PA, paDone);
  // In a Done column with no completion time (older data): the month it last changed.
  await make('legacyDone', { updatedAt: new Date(`${prev}-12T08:00:00.000Z`) }, w.projects.PA, paDone);
  await make('overdue', { startDate: day(`${old}-02`), dueDate: day(`${old}-15`) });
  await make('pbNow', { dueDate: day(`${cur}-20`) }, w.projects.PB, pbTodo);
  // @updatedAt is stamped on create: set the older change time afterwards.
  await prisma.task.update({ where: { id: ids.legacyDone }, data: { updatedAt: new Date(`${prev}-12T08:00:00.000Z`) } });
  // PB is archived: its board can be looked at, not changed.
  await prisma.project.update({ where: { id: w.projects.PB }, data: { status: 'ARCHIVED' } });
  api = await buildCompanyApp(prisma, () => ({ archiveLookup: createPrismaArchiveLookup(prisma) }));
});

afterAll(async () => {
  await api?.close();
  if (w) {
    await prisma.meeting.deleteMany({ where: { projectId: { in: Object.values(w.projects) } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

const monthOf = async (month: string, query = '') => (await api.getRaw(w.as.ana, `/tasks?projectId=${w.projects.PA}&month=${month}${query}`)).json() as { data: Row[]; meta: { month: string; undated: number } };

describe('the month view over the database', () => {
  it('this month: spans, open starts, the start and the completion just after midnight on the 1st, overdue carry-over; two without dates', async () => {
    const res = await monthOf(cur);
    expect(keysOf(res.data)).toEqual(['span', 'startOld', 'startEdge', 'doneEdge', 'overdue'].map(K).sort());
    expect(res.meta).toEqual({ month: cur, undated: 2 });
  });

  it('last month: the span, the old start, completions in it (23:59 on its last day too) and the older Done task — no carry-over', async () => {
    expect(keysOf((await monthOf(prev)).data)).toEqual(['span', 'startOld', 'doneLate', 'donePrev', 'legacyDone'].map(K).sort());
  });

  it('next month: the span, the due date, the open starts — the overdue task never shows in a future month', async () => {
    expect(keysOf((await monthOf(next)).data)).toEqual(['span', 'dueOnly', 'startOld', 'startEdge'].map(K).sort());
  });

  it('the overdue task’s own months show it; the months between do not', async () => {
    expect(keysOf((await monthOf(old)).data)).toEqual(['startOld', 'overdue'].map(K).sort());
    if (shiftMonth(old, 1) !== prev) expect(keysOf((await monthOf(shiftMonth(old, 1))).data)).toEqual([K('startOld')]);
  });

  it('undated=true adds the tasks without dates (the world’s TA1 and TA2)', async () => {
    const res = await monthOf(cur, '&undated=true');
    expect(res.data.map((r) => r.id)).toEqual(expect.arrayContaining([w.tasks.TA1, w.tasks.TA2]));
    expect(res.data).toHaveLength(7);
  });
});

describe('who sees which month', () => {
  it('someone outside the project: 403', async () => {
    expect((await api.getRaw(w.as.bob, `/tasks?projectId=${w.projects.PA}&month=${cur}`)).statusCode).toBe(403);
  });

  it('All projects: only the person’s own projects', async () => {
    const rows = (await api.get(w.as.ana, `/tasks?month=${cur}&undated=true`)) as Row[];
    expect(new Set(rows.map((r) => r.projectId))).toEqual(new Set([w.projects.PA, w.projects.PAB]));
    const admin = (await api.get(w.as.admin, `/tasks?month=${cur}`)) as Row[];
    expect(admin.map((r) => r.key)).toContain(K('pbNow'));
  });

  it('an archived project’s month can be looked at, not changed: a move is refused', async () => {
    const res = await api.getRaw(w.as.ben, `/tasks?projectId=${w.projects.PB}&month=${cur}`);
    expect(res.statusCode).toBe(200);
    expect(keysOf((res.json() as { data: Row[] }).data)).toEqual([K('pbNow')]);
    const token = await api.bearer(w.as.ben);
    const move = await api.app.inject({ method: 'PATCH', url: `/api/v1/tasks/${ids.pbNow}/move`, headers: { authorization: token }, payload: { columnId: pbTodo, position: 0 } });
    expect(move.statusCode).toBe(409);
    expect((move.json() as { error: { code: string } }).error.code).toBe('PROJECT_ARCHIVED');
  });
});
