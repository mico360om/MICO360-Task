import { describe, it, expect } from 'vitest';
import { computeProjectProgress } from './project-progress';

const now = new Date('2026-09-08T12:00:00.000Z');
const past = new Date('2026-09-01T00:00:00.000Z');
const future = new Date('2026-12-01T00:00:00.000Z');

describe('computeProjectProgress', () => {
  it('is all-zero for an empty project', () => {
    expect(computeProjectProgress([], now)).toEqual({
      total: 0, completed: 0, inProgress: 0, todo: 0, overdue: 0, completionPct: 0, byCategory: {},
    });
  });

  it('counts by category and computes completion %', () => {
    const p = computeProjectProgress(
      [
        { columnCategory: 'DONE' },
        { columnCategory: 'DONE' },
        { columnCategory: 'IN_PROGRESS' },
        { columnCategory: 'TODO' },
      ],
      now,
    );
    expect(p.total).toBe(4);
    expect(p.completed).toBe(2);
    expect(p.inProgress).toBe(1);
    expect(p.todo).toBe(1);
    expect(p.completionPct).toBe(50);
    expect(p.byCategory).toEqual({ DONE: 2, IN_PROGRESS: 1, TODO: 1 });
  });

  it('counts overdue as past-due and not done (a done task is never overdue)', () => {
    const p = computeProjectProgress(
      [
        { columnCategory: 'TODO', dueDate: past },
        { columnCategory: 'IN_PROGRESS', dueDate: future },
        { columnCategory: 'DONE', dueDate: past }, // completed → not overdue
      ],
      now,
    );
    expect(p.overdue).toBe(1);
  });

  it('does not count a task due today as overdue, even after 04:00 Muscat (UTC midnight)', () => {
    const due = new Date('2026-09-30T00:00:00.000Z');
    const tenAmMuscat = new Date('2026-09-30T06:00:00.000Z');
    expect(computeProjectProgress([{ columnCategory: 'TODO', dueDate: due }], tenAmMuscat, 'Asia/Muscat').overdue).toBe(0);
    const nextDayMuscat = new Date('2026-09-30T20:30:00.000Z'); // 00:30 on 1 Oct in Muscat
    expect(computeProjectProgress([{ columnCategory: 'TODO', dueDate: due }], nextDayMuscat, 'Asia/Muscat').overdue).toBe(1);
  });

  it('counts a task with a completion time as done (the shared rule), never overdue', () => {
    const p = computeProjectProgress([{ columnCategory: 'IN_PROGRESS', dueDate: past, completedAt: past }], now);
    expect(p.completed).toBe(1);
    expect(p.overdue).toBe(0);
  });

  it('treats a missing column category as TODO', () => {
    const p = computeProjectProgress([{}, {}], now);
    expect(p.todo).toBe(2);
    expect(p.byCategory).toEqual({ TODO: 2 });
  });
});
