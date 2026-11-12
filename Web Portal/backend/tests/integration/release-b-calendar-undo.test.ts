import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { boardDateFromKey } from '../../src/modules/tasks/board-date';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Release B x tasks for the future (1.23.17): the Calendar moves a task's bar (start and due together, as
// planShift sends them) and Undo sends both back (planDatesUndo). The server's start-day rule moves a task
// nobody has started onto its new start day's board (it waits — "It will wait until …"), and Undo puts it on
// TODAY's board, never back on an older, past board day (the calendar lane's merge note).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const anchorIso = (key: string) => `${key}T12:00:00.000Z`;

let w: CompanyWorld;
let app: CompanyApp;
let todo = '';
let doing = '';
type Task = { id: string; boardDate: string | null; startDate: string | null; dueDate: string | null; version: number };

async function put(id: string, body: Record<string, unknown>): Promise<Task> {
  const res = await app.put(w.as.ana, `/tasks/${id}`, body);
  if (res.statusCode !== 200) throw new Error(`PUT /tasks/${id} → ${res.statusCode}: ${res.body}`);
  return (res.json() as { data: Task }).data;
}

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  todo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PA, category: 'TODO' } })).id;
  doing = (await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Doing', category: 'IN_PROGRESS', position: 1 } })).id;
  app = await buildCompanyApp(prisma);
});

afterAll(async () => {
  await app?.close();
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

async function taskOnPastBoard(columnId: string): Promise<Task> {
  const res = await app.post(w.as.ana, '/tasks', { title: 'Calendar undo', projectId: w.projects.PA, columnId, assigneeIds: [w.people.ana], startDate: shiftDayKey(today, -2), dueDate: shiftDayKey(today, 2) });
  if (res.statusCode !== 201) throw new Error(`POST /tasks → ${res.statusCode}: ${res.body}`);
  const t = (res.json() as { data: Task }).data;
  // It has sat on a past day's board (the nightly carry-forward hasn't run for it).
  await prisma.task.update({ where: { id: t.id }, data: { boardDate: boardDateFromKey(shiftDayKey(today, -2)) } });
  return (await app.get(w.as.ana, `/tasks/${t.id}`)) as Task;
}

describe('the Calendar’s move and Undo on a task nobody has started', () => {
  it('moving the bar later makes it wait on its new start day; Undo puts it on today’s board (not its old past day)', async () => {
    const t = await taskOnPastBoard(todo);
    const moved = await put(t.id, { startDate: shiftDayKey(today, 8), dueDate: shiftDayKey(today, 12), expectedVersion: t.version });
    expect(moved.boardDate).toBe(new Date(anchorIso(shiftDayKey(today, 8))).toISOString());
    const undone = await put(t.id, { startDate: shiftDayKey(today, -2), dueDate: shiftDayKey(today, 2), expectedVersion: moved.version });
    expect(undone.boardDate).toBe(new Date(anchorIso(today)).toISOString());
    expect(undone.startDate?.slice(0, 10)).toBe(shiftDayKey(today, -2));
  });

  it('a task already under way keeps its board day whatever the calendar does to its start', async () => {
    const t = await taskOnPastBoard(doing);
    const moved = await put(t.id, { startDate: shiftDayKey(today, 8), dueDate: shiftDayKey(today, 12), expectedVersion: t.version });
    expect(moved.boardDate).toBe(new Date(anchorIso(shiftDayKey(today, -2))).toISOString());
  });
});
