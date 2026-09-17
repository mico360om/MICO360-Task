import { describe, it, expect } from 'vitest';
import { filterAndSortTasks } from './task-filter';
import type { TaskRecord } from './task-repository';

function task(over: Partial<TaskRecord>): TaskRecord {
  return {
    id: 't',
    key: 'MICO-1',
    title: 'Task',
    description: null,
    projectId: 'p1',
    columnId: 'c1',
    columnCategory: 'TODO',
    position: 0,
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    progress: 0,
    createdById: 'u',
    completedAt: null,
    boardDate: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const now = new Date('2026-09-08T12:00:00Z');

describe('filterAndSortTasks', () => {
  it('returns everything for empty criteria (reset)', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    expect(filterAndSortTasks(tasks, {}).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('filters by keyword across title, description and key', () => {
    const tasks = [
      task({ id: 'a', title: 'Ship the invoice' }),
      task({ id: 'b', description: 'about the INVOICE flow' }),
      task({ id: 'c', key: 'INVOICE-9' }),
      task({ id: 'd', title: 'unrelated' }),
    ];
    expect(filterAndSortTasks(tasks, { q: 'invoice' }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by priority, status category and tag (combined)', () => {
    const tasks = [
      task({ id: 'a', priority: 'HIGH', columnCategory: 'IN_PROGRESS', tags: [{ id: 'tag1', name: 'x', color: '#000' }] }),
      task({ id: 'b', priority: 'HIGH', columnCategory: 'TODO' }),
      task({ id: 'c', priority: 'LOW', columnCategory: 'IN_PROGRESS', tags: [{ id: 'tag1', name: 'x', color: '#000' }] }),
    ];
    expect(filterAndSortTasks(tasks, { priorities: ['HIGH'], categories: ['IN_PROGRESS'], tagIds: ['tag1'] }).map((t) => t.id)).toEqual(['a']);
  });

  it('filters by due-date range and overdue', () => {
    const tasks = [
      task({ id: 'past', dueDate: new Date('2026-09-01T00:00:00Z') }),
      task({ id: 'future', dueDate: new Date('2026-12-01T00:00:00Z') }),
      task({ id: 'nodue', dueDate: null }),
      task({ id: 'donepast', dueDate: new Date('2026-09-01T00:00:00Z'), columnCategory: 'DONE' }),
    ];
    expect(filterAndSortTasks(tasks, { dueBefore: now }).map((t) => t.id)).toEqual(['past', 'donepast']);
    expect(filterAndSortTasks(tasks, { dueAfter: now }).map((t) => t.id)).toEqual(['future']);
    // overdue excludes the done one and the no-due one
    expect(filterAndSortTasks(tasks, { overdue: true, now }).map((t) => t.id)).toEqual(['past']);
  });

  it('sorts by priority (desc) and due date (asc, nulls last)', () => {
    const tasks = [
      task({ id: 'low', priority: 'LOW' }),
      task({ id: 'urgent', priority: 'URGENT' }),
      task({ id: 'normal', priority: 'NORMAL' }),
    ];
    expect(filterAndSortTasks(tasks, { sort: 'priority', order: 'desc' }).map((t) => t.id)).toEqual(['urgent', 'normal', 'low']);

    const byDue = [
      task({ id: 'none', dueDate: null }),
      task({ id: 'late', dueDate: new Date('2026-12-01T00:00:00Z') }),
      task({ id: 'soon', dueDate: new Date('2026-09-10T00:00:00Z') }),
    ];
    expect(filterAndSortTasks(byDue, { sort: 'dueDate', order: 'asc' }).map((t) => t.id)).toEqual(['soon', 'late', 'none']);
  });

  it('combines a keyword filter with sorting', () => {
    const tasks = [
      task({ id: 'a', title: 'Fix bug', priority: 'LOW' }),
      task({ id: 'b', title: 'Fix crash', priority: 'URGENT' }),
      task({ id: 'c', title: 'Write docs', priority: 'HIGH' }),
    ];
    expect(filterAndSortTasks(tasks, { q: 'fix', sort: 'priority', order: 'desc' }).map((t) => t.id)).toEqual(['b', 'a']);
  });
});
