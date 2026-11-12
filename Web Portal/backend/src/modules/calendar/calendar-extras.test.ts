import { describe, it, expect } from 'vitest';
import { createMemoryCalendarStore, type CalTaskBrief } from './calendar-store';
import { createCalendarExtras } from './calendar-extras';

const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-12T06:00:00Z');

const task = (id: string, projectId: string, extra: Partial<CalTaskBrief> = {}): CalTaskBrief => ({
  id, key: `K-${id}`, title: `Task ${id}`, projectId, startDate: null, dueDate: day('2026-11-20'), completedAt: null, deletedAt: null, ...extra,
});

async function setup() {
  const tasks = new Map<string, CalTaskBrief>([
    ['t1', task('t1', 'p1')],
    ['t2', task('t2', 'p2')],
    ['t3', task('t3', 'p1', { completedAt: at('2026-11-11T00:00:00Z') })],
    ['t4', task('t4', 'p1', { deletedAt: at('2026-11-11T00:00:00Z') })],
    ['t5', task('t5', 'p9', { projectArchived: true })],
  ]);
  const mem = createMemoryCalendarStore(tasks);
  const block = (taskId: string, userId: string, startIso: string, plannedById = userId) =>
    mem.store.addBlock({ taskId, userId, plannedById, startAt: at(startIso), endAt: new Date(at(startIso).getTime() + 3600_000) });
  await block('t1', 'ali', '2026-11-12T05:00:00Z'); // mine
  await block('t2', 'ali', '2026-11-13T05:00:00Z'); // mine, in p2
  await block('t1', 'mona', '2026-11-12T07:00:00Z', 'boss'); // Mona's, in p1 (run by boss)
  await block('t2', 'zed', '2026-11-12T07:00:00Z'); // Zed's, in p2
  await block('t3', 'ali', '2026-11-14T05:00:00Z'); // a done task's, still to come: hidden
  await block('t3', 'ali', '2026-11-10T05:00:00Z'); // a done task's, past: history
  await block('t4', 'ali', '2026-11-12T09:00:00Z'); // a binned task's: hidden
  await block('t1', 'ali', '2026-12-30T05:00:00Z'); // outside the range
  await mem.store.addReminder({ taskId: 't1', userId: 'ali', setById: 'ali', at: null, anchor: 'due', offsetMinutes: 24 * 60, nextAt: null });
  await mem.store.addReminder({ taskId: 't2', userId: 'ali', setById: 'sara', at: at('2026-11-13T10:00:00Z'), anchor: null, offsetMinutes: null, nextAt: null });
  await mem.store.addReminder({ taskId: 't3', userId: 'ali', setById: 'ali', at: at('2026-11-13T10:00:00Z'), anchor: null, offsetMinutes: null, nextAt: null });
  await mem.store.addReminder({ taskId: 't1', userId: 'mona', setById: 'mona', at: at('2026-11-13T10:00:00Z'), anchor: null, offsetMinutes: null, nextAt: null });
  // An archived project's: planned time shown but not changeable, reminders not shown (they aren't sent).
  await block('t5', 'ali', '2026-11-15T05:00:00Z');
  await mem.store.addReminder({ taskId: 't5', userId: 'ali', setById: 'ali', at: at('2026-11-14T10:00:00Z'), anchor: null, offsetMinutes: null, nextAt: null });
  const extras = createCalendarExtras({
    store: mem.store,
    names: async (ids) => new Map(ids.map((id) => [id, id === 'sara' ? 'Sara Ali' : id])),
    clock: async () => ({ timeZone: 'Asia/Muscat', dayStart: '08:00' }),
    teamProjects: async (viewer, list) => (viewer.roles.includes('ADMIN') ? list : viewer.id === 'boss' ? ['p1'] : []),
    now: () => NOW,
  });
  return { extras, mem };
}
const range = { from: '2026-11-08', to: '2026-11-21' };

describe('GET /calendar’s work blocks, reminders and Team view', () => {
  it('a person sees their own blocks in the range — not a binned task’s, nor a done task’s still to come', async () => {
    const { extras } = await setup();
    const out = await extras({ viewer: { id: 'ali', roles: ['EMPLOYEE'] }, ...range, own: null, list: null, team: false });
    expect(out.workBlocks.map((b) => `${b.taskId} ${b.startAt}`)).toEqual(['t3 2026-11-10T05:00:00.000Z', 't1 2026-11-12T05:00:00.000Z', 't2 2026-11-13T05:00:00.000Z', 't5 2026-11-15T05:00:00.000Z']);
    expect(out.workBlocks[1]).toMatchObject({ taskKey: 'K-t1', taskTitle: 'Task t1', projectId: 'p1', userId: 'ali', mine: true, canChange: true });
    // A done task's past block is history, an archived project's read-only: neither changeable.
    expect(out.workBlocks[0]).toMatchObject({ taskId: 't3', canChange: false, done: true });
    expect(out.workBlocks[3]).toMatchObject({ taskId: 't5', canChange: false });
    expect(out.team).toEqual({ available: false, on: false });
  });

  it('“Show my projects only” / the picked company narrow them (own scope)', async () => {
    const { extras } = await setup();
    const out = await extras({ viewer: { id: 'ali', roles: ['EMPLOYEE'] }, ...range, own: ['p1'], list: ['p1'], team: false });
    expect(out.workBlocks.map((b) => b.taskId)).toEqual(['t3', 't1']);
    expect(out.reminders.map((r) => r.taskId)).toEqual(['t1']);
  });

  it('Team: whoever runs projects sees the blocks of people on them — only those projects; others never get it', async () => {
    const { extras } = await setup();
    const boss = await extras({ viewer: { id: 'boss', roles: ['EMPLOYEE'] }, ...range, own: null, list: null, team: true });
    expect(boss.team).toEqual({ available: true, on: true });
    expect(boss.workBlocks.map((b) => `${b.userId} ${b.taskId}`)).toEqual(['ali t3', 'ali t1', 'mona t1']);
    expect(boss.workBlocks.find((b) => b.userId === 'mona')).toMatchObject({ userName: 'mona', plannedByName: 'boss', mine: false, canChange: true });
    const ali = await extras({ viewer: { id: 'ali', roles: ['EMPLOYEE'] }, ...range, own: null, list: null, team: true });
    expect(ali.team).toEqual({ available: false, on: false });
    expect(ali.workBlocks.every((b) => b.userId === 'ali')).toBe(true);
    const admin = await extras({ viewer: { id: 'root', roles: ['ADMIN'] }, ...range, own: ['p2'], list: ['p2'], team: true });
    expect(admin.workBlocks.map((b) => b.userId)).toEqual(['zed', 'ali']);
  });

  it('their own reminders, at their time (a done task’s hidden), with who set one for them', async () => {
    const { extras } = await setup();
    const out = await extras({ viewer: { id: 'ali', roles: ['EMPLOYEE'] }, ...range, own: null, list: null, team: false });
    expect(out.reminders.map((r) => [r.taskId, r.fireAt, r.state, r.setByName])).toEqual([
      ['t2', '2026-11-13T10:00:00.000Z', 'wait', 'Sara Ali'],
      ['t1', '2026-11-19T04:00:00.000Z', 'wait', null],
    ]);
  });
});
