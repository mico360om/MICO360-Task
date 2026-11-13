import { describe, it, expect } from 'vitest';
import { assigneeDueOf, mergedDue, mergedRuleCourses } from './training-one-course';

// The one-course conversion's date rules (D2 and the lane ruling), pure.
describe('mergedDue (D2: one assignment per target)', () => {
  const change = '2026-11-20';
  it('no due date only when none of them had one', () => {
    expect(mergedDue([{ dueDay: null, dueDays: null }, { dueDay: null, dueDays: null }], change)).toEqual({ dueDay: null, dueDays: null });
    expect(mergedDue([{ dueDay: null, dueDays: null }, { dueDay: '2026-11-25', dueDays: null }], change)).toEqual({ dueDay: '2026-12-20', dueDays: null });
  });
  it('a fixed day: the later of the change day + 30 and the latest old day', () => {
    expect(mergedDue([{ dueDay: '2026-11-30', dueDays: null }], change)).toEqual({ dueDay: '2026-12-20', dueDays: null });
    expect(mergedDue([{ dueDay: '2027-01-19', dueDays: null }, { dueDay: '2026-11-25', dueDays: null }], change)).toEqual({ dueDay: '2027-01-19', dueDays: null });
  });
  it('relative days: the largest, at least 30', () => {
    expect(mergedDue([{ dueDay: null, dueDays: 7 }], change)).toEqual({ dueDay: null, dueDays: 30 });
    expect(mergedDue([{ dueDay: null, dueDays: 7 }, { dueDay: null, dueDays: 45 }], change)).toEqual({ dueDay: null, dueDays: 45 });
  });
  it('fixed and relative together: relative days, no fewer than the days left to the latest fixed day', () => {
    expect(mergedDue([{ dueDay: '2027-01-19', dueDays: null }, { dueDay: null, dueDays: 14 }], change)).toEqual({ dueDay: null, dueDays: 60 });
    expect(mergedDue([{ dueDay: '2026-11-25', dueDays: null }, { dueDay: null, dueDays: 14 }], change)).toEqual({ dueDay: null, dueDays: 30 });
  });
});

describe('assigneeDueOf (each person the old assignments reached)', () => {
  const floor = '2026-12-20';
  it('the latest of their own days and 30 days from the change', () => {
    expect(assigneeDueOf(['2026-11-30', '2026-11-25'], { dueDay: '2026-12-20', dueDays: null }, floor)).toBe('2026-12-20');
    expect(assigneeDueOf(['2027-01-19', null], { dueDay: '2026-12-20', dueDays: null }, floor)).toBe('2027-01-19');
  });
  it('none when none of theirs had a day and the assignment has none', () => {
    expect(assigneeDueOf([null, null], { dueDay: null, dueDays: null }, floor)).toBeNull();
  });
  it('30 days from the change when theirs had none but the assignment has a due', () => {
    expect(assigneeDueOf([null], { dueDay: null, dueDays: 30 }, floor)).toBe('2026-12-20');
  });
});

describe('mergedRuleCourses (a rule naming short courses names the one course)', () => {
  it('replaces them in place, once, keeping other courses and their order', () => {
    expect(mergedRuleCourses(['a', 'x', 'b', 'y'], new Set(['a', 'b']), 'one')).toEqual(['one', 'x', 'y']);
    expect(mergedRuleCourses(['x', 'one', 'a'], new Set(['a']), 'one')).toEqual(['x', 'one']);
  });
  it('null when the rule names none of them', () => {
    expect(mergedRuleCourses(['x', 'y'], new Set(['a']), 'one')).toBeNull();
  });
});
