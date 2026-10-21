import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RecurrenceRule } from './recurrence';
import {
  isRecurring, inSeries, withFreq, pickFreq, withInterval, toggleWeekday, withMonthlyMode, withNth,
  withEnds, withCreateNext, togglePaused, nthWeekdayOf, isEarlierCopy, repeatDraftDone,
} from './recurrence-edit';

describe('series membership', () => {
  it('the newest copy carries the rule; every copy links to the series', () => {
    expect(isRecurring({ recurrenceRule: { freq: 'DAILY', interval: 1 } })).toBe(true);
    expect(isRecurring({ recurrenceRule: null, recurrenceParentId: 'x' })).toBe(false);
    expect(inSeries({ recurrenceRule: null, recurrenceParentId: 'x' })).toBe(true);
    expect(inSeries({})).toBe(false);
  });

  it('an earlier copy is one that already has its next copy', () => {
    expect(isEarlierCopy({ recurrenceParentId: 'x', recurrenceNextId: 'y' })).toBe(true);
    // The newest copy with its repeat switched off can turn it back on.
    expect(isEarlierCopy({ recurrenceParentId: 'x', recurrenceRule: null, recurrenceNextId: null })).toBe(false);
    expect(isEarlierCopy({})).toBe(false);
  });
});

describe('editing a rule', () => {
  it('starts, changes and stops repeating, keeping how it ends and when copies are made', () => {
    expect(withFreq(null, 'WEEKLY')).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(withFreq({ freq: 'MONTHLY', interval: 2, dayOfMonth: 5, count: 3, createNext: 'ON_SCHEDULE' }, 'WEEKLY'))
      .toEqual({ freq: 'WEEKLY', interval: 2, count: 3, createNext: 'ON_SCHEDULE' });
    expect(withFreq({ freq: 'DAILY', interval: 1 }, 'NONE')).toBeNull();
  });

  it('tapping the repeat already chosen changes nothing: its days stay, and nothing is saved', () => {
    // As on the website: "Picking the same repeat again keeps its days".
    const weekly: RecurrenceRule = { freq: 'WEEKLY', interval: 1, weekdays: [1, 3], count: 6 };
    const monthly: RecurrenceRule = { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } };
    const onDay: RecurrenceRule = { freq: 'QUARTERLY', interval: 1, dayOfMonth: 15 };
    expect(pickFreq(weekly, 'WEEKLY')).toBeUndefined();
    expect(pickFreq(monthly, 'MONTHLY')).toBeUndefined();
    expect(pickFreq(onDay, 'QUARTERLY')).toBeUndefined();
    expect(pickFreq(null, 'NONE')).toBeUndefined();
    // Another one is a change, as before.
    expect(pickFreq(weekly, 'MONTHLY')).toEqual({ freq: 'MONTHLY', interval: 1, count: 6 });
    expect(pickFreq(weekly, 'NONE')).toBeNull();
    expect(pickFreq(null, 'DAILY')).toEqual({ freq: 'DAILY', interval: 1 });
  });

  it('both repeat editors — a task’s and a meeting’s — are the one editor, whose chips go through pickFreq', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
    const editor = src('../components/RecurrenceEditor.tsx');
    expect(editor).toMatch(/pickFreq\(rule, f\)/);
    expect(editor).toMatch(/pickFreq\(rule, 'NONE'\)/);
    expect(editor).not.toMatch(/withFreq\(/);
    for (const user of ['../components/task-detail/DetailsCard.tsx', '../screens/NewTaskScreen.tsx', '../screens/MeetingFormScreen.tsx']) {
      expect(src(user), user).toMatch(/<RecurrenceEditor\b/);
    }
  });

  it('sets the interval (at least 1) and toggles weekdays in order', () => {
    expect(withInterval({ freq: 'DAILY', interval: 1 }, 3)).toEqual({ freq: 'DAILY', interval: 3 });
    expect(withInterval({ freq: 'DAILY', interval: 1 }, 0)).toEqual({ freq: 'DAILY', interval: 1 });
    expect(toggleWeekday({ freq: 'WEEKLY', interval: 1, weekdays: [4] }, 0)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [0, 4] });
    expect(toggleWeekday({ freq: 'WEEKLY', interval: 1, weekdays: [0, 4] }, 4)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [0] });
  });

  it('switches a monthly rule between a date and "the 2nd Tuesday" (suggested from the due date)', () => {
    expect(nthWeekdayOf('2026-10-13')).toEqual({ week: 2, day: 2 });
    expect(nthWeekdayOf('2026-10-30')).toEqual({ week: -1, day: 5 });
    expect(withMonthlyMode({ freq: 'MONTHLY', interval: 1, dayOfMonth: 13, anchorDay: 13 }, 'WEEKDAY', '2026-10-13'))
      .toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } });
    expect(withMonthlyMode({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, 'DATE')).toEqual({ freq: 'MONTHLY', interval: 1 });
    expect(withNth({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, { week: -1 })).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 2 } });
  });

  it('sets how the series ends', () => {
    const r: RecurrenceRule = { freq: 'DAILY', interval: 1 };
    expect(withEnds(r, 'COUNT')).toEqual({ ...r, count: 10, until: null });
    expect(withEnds(r, 'UNTIL', '2026-11-01')).toEqual({ ...r, until: '2026-11-01', count: null });
    expect(withEnds({ ...r, count: 4 }, 'NEVER')).toEqual({ ...r, count: null, until: null });
  });

  it('chooses when copies are made and pauses', () => {
    expect(withCreateNext({ freq: 'DAILY', interval: 1 }, 'ON_SCHEDULE')).toEqual({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' });
    expect(withCreateNext({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, 'ON_COMPLETE')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(togglePaused({ freq: 'DAILY', interval: 1 })).toEqual({ freq: 'DAILY', interval: 1, paused: true });
    expect(togglePaused({ freq: 'DAILY', interval: 1, paused: true })).toEqual({ freq: 'DAILY', interval: 1, paused: false });
  });
});

describe('repeatDraftDone — the repeat editor goes back to the task’s own rule after a save', () => {
  const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 1 };

  it('keeps the draft while it is being saved', () => {
    expect(repeatDraftDone({ rule, from: 5, saved: false }, 5)).toBe(false);
    expect(repeatDraftDone({ rule, from: 5, saved: false }, 6)).toBe(false);
  });

  it('keeps it after the save until the task has reloaded (no flash of the old rule)', () => {
    expect(repeatDraftDone({ rule, from: 5, saved: true }, 5)).toBe(false);
  });

  it('drops it once a newer copy of the task is in — this save, or a change made elsewhere', () => {
    expect(repeatDraftDone({ rule, from: 5, saved: true }, 6)).toBe(true);
    expect(repeatDraftDone({ rule, from: 5, saved: true }, 9)).toBe(true);
  });

  it('without versions (an older server) drops it as soon as the save went through', () => {
    expect(repeatDraftDone({ rule, from: undefined, saved: true }, undefined)).toBe(true);
    expect(repeatDraftDone({ rule: null, from: 5, saved: true }, undefined)).toBe(true);
  });

  it('nothing to drop without a draft', () => {
    expect(repeatDraftDone(undefined, 6)).toBe(false);
  });
});
