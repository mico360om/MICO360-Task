import { describe, it, expect } from 'vitest';
import {
  MAX_REMINDER_OFFSET_MINUTES,
  REMINDER_GRACE_MS,
  fireAtOf,
  mayAddReminder,
  mayChangeReminder,
  mayMuteReminder,
  maySeeReminder,
  reminderNotice,
  reminderSpecProblem,
  reminderState,
} from './task-reminders';

const TZ = 'Asia/Muscat'; // UTC+4, working day from 08:00
const ctx = { timeZone: TZ, dayStart: '08:00' };
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

describe('personal reminders on tasks (owner, 11 Nov)', () => {
  it('a set date and time, or a time before the start or due', () => {
    const task = { startDate: day('2026-11-15'), dueDate: new Date('2026-11-20T10:00:00.000Z') };
    expect(fireAtOf({ at: at('2026-11-14T05:00:00Z'), anchor: null, offsetMinutes: null }, task, ctx)).toEqual(at('2026-11-14T05:00:00Z'));
    // A timed due date: 2 hours before it.
    expect(fireAtOf({ at: null, anchor: 'due', offsetMinutes: 120 }, task, ctx)).toEqual(at('2026-11-20T08:00:00Z'));
    // A date-only start counts from the start of that working day (08:00 company time = 04:00 UTC): 1 day before.
    expect(fireAtOf({ at: null, anchor: 'start', offsetMinutes: 24 * 60 }, task, ctx)).toEqual(at('2026-11-14T04:00:00Z'));
    // On the morning of the due day.
    expect(fireAtOf({ at: null, anchor: 'due', offsetMinutes: 0 }, { startDate: null, dueDate: day('2026-11-20') }, ctx)).toEqual(at('2026-11-20T04:00:00Z'));
    // No such date on the task (any more): no time.
    expect(fireAtOf({ at: null, anchor: 'start', offsetMinutes: 60 }, { startDate: null, dueDate: day('2026-11-20') }, ctx)).toBeNull();
    // The automatic start (the moment the task was made) is not a start anyone chose: no time.
    expect(fireAtOf({ at: null, anchor: 'start', offsetMinutes: 0 }, { startDate: at('2026-11-10T07:12:33.000Z'), dueDate: day('2026-11-20') }, ctx)).toBeNull();
  });

  it('checks what is asked: one time, or an anchor with up to 60 days before it', () => {
    expect(MAX_REMINDER_OFFSET_MINUTES).toBe(60 * 24 * 60);
    expect(reminderSpecProblem({ at: at('2026-11-14T05:00:00Z') })).toBeNull();
    expect(reminderSpecProblem({ anchor: 'due', offsetMinutes: 0 })).toBeNull();
    expect(reminderSpecProblem({})).toMatch(/Choose when/);
    expect(reminderSpecProblem({ at: at('2026-11-14T05:00:00Z'), anchor: 'due', offsetMinutes: 10 })).toMatch(/Choose when/);
    expect(reminderSpecProblem({ anchor: 'due' })).toMatch(/how long before/);
    expect(reminderSpecProblem({ anchor: 'due', offsetMinutes: -5 })).toMatch(/how long before/);
    expect(reminderSpecProblem({ anchor: 'due', offsetMinutes: MAX_REMINDER_OFFSET_MINUTES + 1 })).toMatch(/60 days/);
  });

  it('goes once at its time; again only if its time changes (a moved due date) — never more than a day late', () => {
    const task = { startDate: null, dueDate: day('2026-11-20'), completedAt: null, deletedAt: null };
    const r = { at: null, anchor: 'due' as const, offsetMinutes: 0, mutedAt: null, snoozedUntil: null, sentFor: null };
    const fire = at('2026-11-20T04:00:00Z');
    expect(reminderState(r, task, at('2026-11-20T03:59:00Z'), ctx)).toEqual({ state: 'wait', fireAt: fire });
    expect(reminderState(r, task, at('2026-11-20T04:00:00Z'), ctx)).toEqual({ state: 'send', fireAt: fire });
    expect(reminderState({ ...r, sentFor: fire }, task, at('2026-11-20T05:00:00Z'), ctx)).toEqual({ state: 'sent', fireAt: fire });
    // The due date moved a week: it goes again then.
    const moved = { ...task, dueDate: day('2026-11-27') };
    expect(reminderState({ ...r, sentFor: fire }, moved, at('2026-11-21T05:00:00Z'), ctx).state).toBe('wait');
    // More than a day past (the server was off, or the date moved into the past): not sent.
    expect(REMINDER_GRACE_MS).toBe(24 * 3600_000);
    expect(reminderState(r, task, new Date(fire.getTime() + REMINDER_GRACE_MS + 1), ctx).state).toBe('missed');
  });

  it('snoozed: goes at the snooze time; muted by its person: never', () => {
    const task = { startDate: null, dueDate: day('2026-11-20'), completedAt: null, deletedAt: null };
    const fire = at('2026-11-20T04:00:00Z');
    const r = { at: null, anchor: 'due' as const, offsetMinutes: 0, mutedAt: null, snoozedUntil: at('2026-11-20T05:00:00Z'), sentFor: fire };
    expect(reminderState(r, task, at('2026-11-20T04:30:00Z'), ctx)).toEqual({ state: 'wait', fireAt: at('2026-11-20T05:00:00Z') });
    expect(reminderState(r, task, at('2026-11-20T05:00:00Z'), ctx).state).toBe('send');
    expect(reminderState({ ...r, mutedAt: at('2026-11-19T00:00:00Z') }, task, at('2026-11-20T05:00:00Z'), ctx).state).toBe('muted');
  });

  it('kept but hidden (not sent) while the task is done, binned or archived; back when it is reopened (call 2)', () => {
    const r = { at: at('2026-11-20T04:00:00Z'), anchor: null, offsetMinutes: null, mutedAt: null, snoozedUntil: null, sentFor: null };
    const now = at('2026-11-20T04:00:00Z');
    const base = { startDate: null, dueDate: day('2026-11-20'), completedAt: null, deletedAt: null };
    expect(reminderState(r, { ...base, completedAt: at('2026-11-19T00:00:00Z') }, now, ctx).state).toBe('hidden');
    expect(reminderState(r, { ...base, deletedAt: at('2026-11-19T00:00:00Z') }, now, ctx).state).toBe('hidden');
    expect(reminderState(r, { ...base, archivedAt: at('2026-11-19T00:00:00Z') }, now, ctx).state).toBe('hidden');
    expect(reminderState(r, base, now, ctx).state).toBe('send');
  });

  it('who: anyone who can see the task sets their own; its creator or whoever runs the project, for its assignees', () => {
    const task = { assigneeIds: ['ali', 'mona'], createdById: 'sara' };
    expect(mayAddReminder({ viewerId: 'zed', recipientId: 'zed', task, runsProject: false })).toBe(true);
    expect(mayAddReminder({ viewerId: 'ali', recipientId: 'mona', task, runsProject: false })).toBe(false);
    expect(mayAddReminder({ viewerId: 'sara', recipientId: 'mona', task, runsProject: false })).toBe(true);
    expect(mayAddReminder({ viewerId: 'boss', recipientId: 'ali', task, runsProject: true })).toBe(true);
    expect(mayAddReminder({ viewerId: 'boss', recipientId: 'zed', task, runsProject: true })).toBe(false);
  });

  it('each person sees their own and the ones they set; only the setter changes or removes one; its person mutes one set for them (call 3)', () => {
    const r = { userId: 'ali', setById: 'sara' };
    expect(maySeeReminder('ali', r)).toBe(true);
    expect(maySeeReminder('sara', r)).toBe(true);
    expect(maySeeReminder('boss', r)).toBe(false);
    expect(mayChangeReminder('sara', r)).toBe(true);
    expect(mayChangeReminder('ali', r)).toBe(false);
    expect(mayMuteReminder('ali', r)).toBe(true);
    expect(mayMuteReminder('sara', r)).toBe(false);
    // One's own: changed and removed, not muted.
    expect(mayChangeReminder('ali', { userId: 'ali', setById: 'ali' })).toBe(true);
    expect(mayMuteReminder('ali', { userId: 'ali', setById: 'ali' })).toBe(false);
  });

  it('the notice: the task’s number and title, when it is due or starts, who set it', () => {
    const task = { key: 'RIG-12', title: 'Pour the slab', startDate: day('2026-11-15'), dueDate: day('2026-11-20') };
    expect(reminderNotice({ task, anchor: 'due', setByName: null, timeZone: TZ, now: at('2026-11-19T05:00:00Z') })).toEqual({
      title: 'Reminder: RIG-12 Pour the slab',
      body: 'Due Fri 20 Nov.',
    });
    expect(reminderNotice({ task, anchor: 'start', setByName: 'Sara Ali', timeZone: TZ, now: at('2026-11-14T05:00:00Z') })).toEqual({
      title: 'Reminder: RIG-12 Pour the slab',
      body: 'Starts Sun 15 Nov. Set by Sara Ali.',
    });
    expect(reminderNotice({ task: { ...task, dueDate: new Date('2026-11-20T10:30:00.000Z') }, anchor: null, setByName: null, timeZone: TZ, now: at('2026-11-19T05:00:00Z') }).body).toBe('Due Fri 20 Nov at 14:30.');
    expect(reminderNotice({ task: { ...task, dueDate: null, startDate: null }, anchor: null, setByName: null, timeZone: TZ, now: at('2026-11-19T05:00:00Z') }).body).toBeNull();
    expect(reminderNotice({ task: { ...task, dueDate: day('2027-01-04') }, anchor: 'due', setByName: null, timeZone: TZ, now: at('2026-11-19T05:00:00Z') }).body).toBe('Due Mon 4 Jan 2027.');
  });
});
