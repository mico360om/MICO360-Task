import { describe, it, expect } from 'vitest';
import { taskRowA11yLabel } from './task-a11y';
import type { ApiTask } from './types';

const base: ApiTask = {
  id: 't1',
  key: 'ENG-12',
  title: 'Wire up the export',
  priority: 'HIGH',
  progress: 0,
  dueDate: null,
  completedAt: null,
} as ApiTask;

describe('taskRowA11yLabel', () => {
  it('always voices the priority (which is otherwise a color-only bar)', () => {
    expect(taskRowA11yLabel(base, null, false)).toBe('ENG-12, High priority, Wire up the export');
  });

  it('includes the due date when present', () => {
    expect(taskRowA11yLabel(base, 'Mar 3', false)).toBe('ENG-12, High priority, Wire up the export, due Mar 3');
  });

  it('reads progress when partially complete and not done', () => {
    expect(taskRowA11yLabel({ ...base, progress: 40 }, null, false)).toBe(
      'ENG-12, High priority, Wire up the export, 40% complete',
    );
  });

  it('says "done" and omits progress for a completed task', () => {
    expect(taskRowA11yLabel({ ...base, progress: 40 }, 'Mar 3', true)).toBe(
      'ENG-12, High priority, Wire up the export, due Mar 3, done',
    );
  });

  it('maps every priority to a human word', () => {
    expect(taskRowA11yLabel({ ...base, priority: 'LOW' }, null, false)).toContain('Low priority');
    expect(taskRowA11yLabel({ ...base, priority: 'NORMAL' }, null, false)).toContain('Normal priority');
    expect(taskRowA11yLabel({ ...base, priority: 'URGENT' }, null, false)).toContain('Urgent priority');
  });
});
