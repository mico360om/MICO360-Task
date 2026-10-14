import { describe, it, expect } from 'vitest';
import { filterTasks } from './task-picker';

const tasks = [
  { id: 't1', key: 'MICO-1', title: 'Prepare report' },
  { id: 't2', key: 'MICO-2', title: 'Review the report' },
  { id: 't3', key: 'MICO-12', title: 'Book the venue' },
  { id: 't4', key: 'RIG-3', title: 'Calibrate sensor' },
];

describe('filterTasks (the blocker picker)', () => {
  it('matches the key or the title, ignoring case; keys that start with the query first', () => {
    expect(filterTasks(tasks, 'report', new Set()).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(filterTasks(tasks, 'mico-1', new Set()).map((t) => t.id)).toEqual(['t1', 't3']);
    expect(filterTasks(tasks, 'SENSOR', new Set()).map((t) => t.id)).toEqual(['t4']);
    expect(filterTasks(tasks, 'venue', new Set()).map((t) => t.id)).toEqual(['t3']);
  });
  it('leaves out the excluded tasks (this task, ones already linked, ones it blocks)', () => {
    expect(filterTasks(tasks, '', new Set(['t1', 't3'])).map((t) => t.id)).toEqual(['t2', 't4']);
  });
  it('lists at most `limit`', () => {
    expect(filterTasks(tasks, '', new Set(), 2)).toHaveLength(2);
  });
});
