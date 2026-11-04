import { describe, it, expect } from 'vitest';
import { pickTasks } from './task-picker-numbers';

const tasks = [
  { id: 't1', key: 'MICO-1', title: 'Prepare report' },
  { id: 't2', key: 'MICO-2', title: 'Review the report' },
  { id: 't3', key: 'MICO-12', title: 'Book the venue' },
  { id: 't4', key: 'RIG-3', title: 'Calibrate sensor' },
  { id: 't5', key: 'MICO-120', title: 'Order 12 bolts' },
  { id: 't6', key: 'RIG-12', title: 'Pump' },
  { id: 't7', key: 'OPS-17', title: 'Moved here', formerKeys: ['RIG-4'] },
];
const ids = (q: string, exclude = new Set<string>(), limit?: number) => pickTasks(tasks, q, exclude, limit).map((t) => t.id);

describe('pickTasks (the blocker picker) finds a task number however it is typed (1.22.3)', () => {
  it('mico1, MICO 1, mico_1 and #MICO-1 find MICO-1 — exactly that number', () => {
    for (const q of ['mico1', 'MICO 1', 'mico_1', '#MICO-1']) expect(ids(q), q).toEqual(['t1']);
    expect(ids('rig 3')).toEqual(['t4']);
    expect(ids('rig4')).toEqual(['t7']); // a number it had before it moved
  });

  it('the exact number first, then what the picker always found', () => {
    expect(ids('mico-12')).toEqual(['t3', 't5']);
    // A bare number: the tasks numbered …-12 first, then the keys and titles holding it.
    expect(ids('12')).toEqual(['t3', 't6', 't5']);
  });

  it('otherwise exactly the shared picker: keys first, then titles; excluded tasks and the limit kept', () => {
    expect(ids('report')).toEqual(['t1', 't2']);
    expect(ids('mico-1')).toEqual(['t1', 't3', 't5']);
    expect(ids('mico12', new Set(['t3']))).toEqual([]);
    expect(ids('12', new Set(['t6']))).toEqual(['t3', 't5']);
    expect(ids('12', new Set(), 2)).toEqual(['t3', 't6']);
    expect(ids('', new Set(), 3)).toEqual(['t1', 't2', 't3']);
  });
});
