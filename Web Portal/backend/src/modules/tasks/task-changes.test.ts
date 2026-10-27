import { describe, it, expect } from 'vitest';
import { taskChanges, updateActivity } from './task-changes';
import type { TaskRecord } from './task-repository';

const TZ = 'Asia/Muscat';
const base = {
  id: 't1',
  title: 'Prepare report',
  description: 'Old notes',
  priority: 'NORMAL',
  dueDate: null,
  recurrenceRule: null,
  columnId: 'c1',
  progress: 0,
} as unknown as TaskRecord;
const withChanges = (patch: Partial<TaskRecord>) => ({ ...base, ...patch }) as TaskRecord;

describe('taskChanges (what an edit changed, for the activity timeline)', () => {
  it('is empty when nothing that people care about changed', () => {
    expect(taskChanges(base, base, TZ)).toEqual([]);
    // a move or a progress bump is not an edit (moves have their own entry)
    expect(taskChanges(base, withChanges({ columnId: 'c2', progress: 50 }), TZ)).toEqual([]);
  });
  it('records the old and new title and priority', () => {
    expect(taskChanges(base, withChanges({ title: 'Prepare the report', priority: 'HIGH' }), TZ)).toEqual([
      { field: 'title', from: 'Prepare report', to: 'Prepare the report' },
      { field: 'priority', from: 'NORMAL', to: 'HIGH' },
    ]);
  });
  it('notes a description edit without copying the text', () => {
    expect(taskChanges(base, withChanges({ description: 'New notes' }), TZ)).toEqual([{ field: 'description' }]);
    expect(taskChanges(base, withChanges({ description: null }), TZ)).toEqual([{ field: 'description' }]);
  });
  it('records due dates as calendar days in the company zone', () => {
    const due = new Date('2026-10-12T12:00:00Z');
    expect(taskChanges(base, withChanges({ dueDate: due }), TZ)).toEqual([{ field: 'dueDate', from: null, to: '2026-10-12' }]);
    expect(taskChanges(withChanges({ dueDate: due }), base, TZ)).toEqual([{ field: 'dueDate', from: '2026-10-12', to: null }]);
    // same day, different instant: not a change
    expect(taskChanges(withChanges({ dueDate: due }), withChanges({ dueDate: new Date('2026-10-12T08:00:00Z') }), TZ)).toEqual([]);
  });
  it('records the repeat in words', () => {
    const weekly = { freq: 'WEEKLY', interval: 1 } as TaskRecord['recurrenceRule'];
    const [change] = taskChanges(base, withChanges({ recurrenceRule: weekly }), TZ) as { field: string; from: string | null; to: string | null }[];
    expect(change).toMatchObject({ field: 'repeat', from: null });
    expect(String(change!.to)).toMatch(/week/i);
    expect(taskChanges(withChanges({ recurrenceRule: weekly }), base, TZ)).toEqual([{ field: 'repeat', from: change!.to, to: null }]);
  });
});

describe('updateActivity (the UPDATED timeline line an edit writes)', () => {
  it('is null when nothing worth a line changed', () => {
    expect(updateActivity(base, withChanges({ columnId: 'c2' }), TZ)).toBeNull();
  });
  it('lists the changes the timeline words', () => {
    expect(updateActivity(base, withChanges({ priority: 'HIGH' }), TZ)).toEqual({ changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] });
  });
  it('a change of inspection form or place is a real entry in the change list (so the line always says it)', () => {
    const before = withChanges({ inspectionFormId: 'f1', inspectionPlace: 'Rig 3' });
    expect(updateActivity(before, withChanges({ inspectionFormId: 'f2', inspectionPlace: 'Rig 3' }), TZ)).toEqual({ changes: [{ field: 'inspectionForm', from: 'f1', to: 'f2' }] });
    expect(updateActivity(before, withChanges({ inspectionFormId: 'f1', inspectionPlace: null }), TZ)).toEqual({ changes: [{ field: 'inspectionPlace', from: 'Rig 3', to: null }] });
    expect(updateActivity(base, withChanges({ title: 'Daily rig check', inspectionFormId: 'f1' }), TZ)).toEqual({
      changes: [
        { field: 'title', from: 'Prepare report', to: 'Daily rig check' },
        { field: 'inspectionForm', from: null, to: 'f1' },
      ],
    });
  });
});
