import { describe, it, expect, beforeEach } from 'vitest';
import { createInspectionScheduleService, type CheckRow, type InspectionScheduleSource } from './inspection-schedules';
import type { RecurrenceRule } from '../tasks/recurrence';

const TZ = 'Asia/Muscat';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const SUN_THU = [0, 1, 2, 3, 4];
const WORKING: RecurrenceRule = { freq: 'WEEKLY', interval: 1, weekdays: SUN_THU, createNext: 'ON_SCHEDULE' };
const FORM = { id: 'f1', title: 'Rig daily check', deleted: false };
const IVAN = { id: 'u-ivan', name: 'Ivan Inspector' };
const SARA = { id: 'u-sara', name: 'Sara Al Balushi' };

let rows: CheckRow[];
let inProgress: Array<{ taskId: string; inspectionId: string; inspectorId: string }>;
let now: Date;
let n = 0;
const row = (over: Partial<CheckRow> = {}): CheckRow => {
  const id = over.id ?? `t${++n}`;
  return { id, key: `RIG-${n}`, title: 'Daily rig check – Rig 3', projectId: 'P1', dueDate: day('2026-10-28'), startDate: null, completedAt: null, columnCategory: 'TODO', recurrenceRule: null, recurrenceParentId: null, inspectionPlace: 'Rig 3', form: FORM, assignees: [IVAN], ...over };
};

const source: InspectionScheduleSource = {
  checks: async (projectId, opts) => rows.filter((r) => r.projectId === projectId && (!opts.schedulesOnly || r.recurrenceRule) && (!opts.seriesIds || opts.seriesIds.includes(r.recurrenceParentId ?? r.id)) && (!opts.openOnly || (!r.completedAt && r.columnCategory !== 'DONE'))),
  seriesSizes: async (ids) => new Map(ids.map((id) => [id, rows.filter((r) => (r.recurrenceParentId ?? r.id) === id).length])),
  inProgress: async (taskIds) => inProgress.filter((x) => taskIds.includes(x.taskId)),
  formUsage: async (formId) => (formId === 'f1' ? { schedules: rows.filter((r) => r.form.id === formId && r.recurrenceRule).length, openChecks: rows.filter((r) => r.form.id === formId && !r.completedAt).length } : null),
  workingDays: async () => SUN_THU,
};
const visible = new Set(['u-ivan', 'u-sara', 'u-admin']);
const service = () =>
  createInspectionScheduleService({
    source,
    canViewProject: async (userId, roles, projectId) => projectId === 'P1' && (roles.includes('ADMIN') || visible.has(userId)),
    userNames: async (ids) => new Map(ids.flatMap((id) => (id === IVAN.id ? [[id, IVAN.name] as const] : id === SARA.id ? [[id, SARA.name] as const] : []))),
    timeZone: TZ,
    now: () => now,
  });
const ivan = { id: 'u-ivan', roles: ['EMPLOYEE'] };
const outsider = { id: 'u-out', roles: ['EMPLOYEE'] };

beforeEach(() => {
  rows = [];
  inProgress = [];
  n = 0;
  now = new Date('2026-10-28T06:00:00Z'); // Wednesday 28 Oct, 10:00 in Muscat
});

const status = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as { status?: number } | null)?.status;

describe('a project’s schedules', () => {
  it('lists each schedule from its newest copy: form, place, inspectors, repeat, next due, last done, open and late counts', async () => {
    const first = row({ id: 's1', dueDate: day('2026-10-25'), completedAt: new Date('2026-10-25T07:00:00Z'), columnCategory: 'DONE', recurrenceParentId: 's1' });
    const missed = row({ id: 's2', dueDate: day('2026-10-26'), recurrenceParentId: 's1' });
    const head = row({ id: 's3', dueDate: day('2026-10-28'), recurrenceParentId: 's1', recurrenceRule: WORKING, assignees: [IVAN, SARA] });
    rows.push(first, missed, head, row({ id: 'one-off' }));
    const out = await service().schedules(ivan, 'P1');
    expect(out.workingDays).toEqual(SUN_THU);
    expect(out.schedules).toEqual([
      {
        taskId: 's3',
        key: head.key,
        title: 'Daily rig check – Rig 3',
        form: FORM,
        place: 'Rig 3',
        assignees: [IVAN, SARA],
        rule: WORKING,
        repeat: 'Every working day',
        paused: false,
        nextDue: '2026-10-28',
        lastDone: '2026-10-25T07:00:00.000Z',
        openChecks: 2,
        lateChecks: 1,
      },
    ]);
  });

  it('the next due day is the next date on the schedule once today’s is done (or past)', async () => {
    rows.push(row({ id: 'a', dueDate: day('2026-10-28'), completedAt: new Date('2026-10-28T05:00:00Z'), columnCategory: 'DONE', recurrenceRule: WORKING }));
    // Wednesday’s is done: Thursday next.
    expect((await service().schedules(ivan, 'P1')).schedules[0]!.nextDue).toBe('2026-10-29');
    now = new Date('2026-10-29T21:00:00Z'); // Friday 30 Oct in Muscat: the next working day is Sunday
    expect((await service().schedules(ivan, 'P1')).schedules[0]!.nextDue).toBe('2026-11-01');
  });

  it('words other repeats as the task form does, without the "new copy on each date" part (every schedule makes them on schedule)', async () => {
    rows.push(row({ id: 'w', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], createNext: 'ON_SCHEDULE', count: 10 } }));
    rows.push(row({ id: 'd', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', paused: true } }));
    const out = (await service().schedules(ivan, 'P1')).schedules;
    expect(out.find((s) => s.taskId === 'w')!.repeat).toBe('Repeats every week on Mon, 10 times');
    expect(out.find((s) => s.taskId === 'd')).toMatchObject({ repeat: 'Repeats every day (paused)', paused: true, nextDue: null });
  });

  it('a series that has made all its checks has no next one', async () => {
    rows.push(row({ id: 'c1', dueDate: day('2026-10-27'), recurrenceParentId: 'c1', completedAt: new Date('2026-10-27T05:00:00Z'), columnCategory: 'DONE' }));
    rows.push(row({ id: 'c2', dueDate: day('2026-10-28'), recurrenceParentId: 'c1', completedAt: new Date('2026-10-28T05:00:00Z'), columnCategory: 'DONE', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', count: 2 } }));
    expect((await service().schedules(ivan, 'P1')).schedules[0]!.nextDue).toBeNull();
  });

  it('is for the project’s team and administrators: anyone else hears "not found"', async () => {
    rows.push(row({ recurrenceRule: WORKING }));
    expect(await status(service().schedules(outsider, 'P1'))).toBe(404);
    expect((await service().schedules({ id: 'u-admin', roles: ['ADMIN'] }, 'P1')).schedules).toHaveLength(1);
  });
});

describe('a project’s due checks', () => {
  it('lists open checks, late first (with how late), then due today, then upcoming — and who is doing one now', async () => {
    rows.push(
      row({ id: 'up', dueDate: day('2026-11-02') }),
      row({ id: 'today', dueDate: day('2026-10-28'), inspectionPlace: 'الحفار ٣' }),
      row({ id: 'late2', dueDate: day('2026-10-26'), recurrenceParentId: 's1' }),
      row({ id: 'done', dueDate: day('2026-10-20'), completedAt: new Date('2026-10-21T08:00:00Z'), columnCategory: 'DONE' }),
      row({ id: 'late1', dueDate: day('2026-10-27') }),
      row({ id: 'undated', dueDate: null }),
    );
    inProgress.push({ taskId: 'today', inspectionId: 'i9', inspectorId: SARA.id });
    const out = await service().dueChecks(ivan, 'P1');
    expect(out.total).toBe(5);
    expect(out.checks.map((c) => [c.taskId, c.state, c.daysLate])).toEqual([
      ['late2', 'LATE', 2],
      ['late1', 'LATE', 1],
      ['today', 'DUE', 0],
      ['up', 'DUE', 0],
      ['undated', 'DUE', 0],
    ]);
    expect(out.checks[0]).toMatchObject({ dueDate: '2026-10-26', scheduled: true, form: FORM, place: 'Rig 3', assignees: [IVAN], inProgress: null });
    expect(out.checks[2]).toMatchObject({ place: 'الحفار ٣', scheduled: false, inProgress: { inspectionId: 'i9', inspector: SARA } });
  });

  it('a check whose form was deleted still shows, marked (it can still be done)', async () => {
    rows.push(row({ form: { id: 'f-old', title: 'Old deck check', deleted: true } }));
    expect((await service().dueChecks(ivan, 'P1')).checks[0]!.form).toEqual({ id: 'f-old', title: 'Old deck check', deleted: true });
  });

  it('is capped, with the full count', async () => {
    for (let i = 0; i < 12; i++) rows.push(row({ dueDate: day(`2026-10-${String(10 + i).padStart(2, '0')}`) }));
    const out = await service().dueChecks(ivan, 'P1', { limit: 5 });
    expect(out.total).toBe(12);
    expect(out.checks.map((c) => c.dueDate)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('is for the project’s team and administrators', async () => {
    expect(await status(service().dueChecks(outsider, 'P1'))).toBe(404);
  });
});

describe('a form’s use (for the delete confirm)', () => {
  it('counts the schedules that use it and the checks still open', async () => {
    rows.push(row({ recurrenceRule: WORKING }), row({ recurrenceRule: WORKING }), row(), row({ completedAt: new Date(), columnCategory: 'DONE' }));
    expect(await service().formUsage('f1')).toEqual({ schedules: 2, openChecks: 3 });
    expect(await status(service().formUsage('nope'))).toBe(404);
  });
});
