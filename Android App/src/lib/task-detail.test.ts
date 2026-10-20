import { describe, it, expect } from 'vitest';
import { activityFeed, blockerRefs, canDeleteTask, conflictText, dueFieldValue, dueState, meetingLine, moveBy, taskLoadProblem } from './task-detail';
import { ApiError, NetworkError } from './api-client';
import type { ApiActivityEntry, ApiColumn, ApiTask } from './types';

const NOW = new Date('2026-10-10T08:00:00Z'); // 12:00 in Muscat

describe('canDeleteTask', () => {
  const members = [
    { id: 'u1', role: 'MEMBER' as const },
    { id: 'u2', role: 'MANAGER' as const },
  ];
  it('lets admins and the project’s managers delete, nobody else', () => {
    expect(canDeleteTask({ id: 'u9', roles: ['ADMIN'] }, members)).toBe(true);
    expect(canDeleteTask({ id: 'u2', roles: ['EMPLOYEE'] }, members)).toBe(true);
    expect(canDeleteTask({ id: 'u1', roles: ['EMPLOYEE'] }, members)).toBe(false);
    expect(canDeleteTask(null, members)).toBe(false);
  });
});

describe('dueState', () => {
  it('says when it is due, and flags an overdue open task', () => {
    expect(dueState({ dueDate: '2026-10-12T12:00:00Z', completedAt: null }, NOW, 'en-US')).toEqual({ text: 'Due Oct 12', overdue: false, dayKey: '2026-10-12' });
    expect(dueState({ dueDate: '2026-10-08T12:00:00Z', completedAt: null }, NOW, 'en-US')).toEqual({ text: 'Overdue · Oct 8', overdue: true, dayKey: '2026-10-08' });
  });
  it('never calls a finished task overdue; no date, no text', () => {
    expect(dueState({ dueDate: '2026-10-08T12:00:00Z', completedAt: '2026-10-09T00:00:00Z' }, NOW, 'en-US').overdue).toBe(false);
    expect(dueState({ dueDate: null, completedAt: null }, NOW, 'en-US')).toEqual({ text: null, overdue: false, dayKey: null });
  });
});

describe('moveBy', () => {
  it('moves an item up or down one place; nothing past either end', () => {
    expect(moveBy(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveBy(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveBy(['a', 'b'], 'zz', 1)).toBeNull();
  });
});

describe('blockerRefs', () => {
  const tasks = [
    { id: 't2', key: 'MICO-2', title: 'Do first', columnId: 'c1', completedAt: null },
    { id: 't3', key: 'MICO-3', title: 'Approved', columnId: 'c9', completedAt: '2026-10-01' },
  ] as unknown as ApiTask[];
  const columns = [
    { id: 'c1', name: 'In Progress', category: 'IN_PROGRESS' },
    { id: 'c9', name: 'Done', category: 'DONE' },
  ] as unknown as ApiColumn[];
  it('gives each linked task its key, title and status', () => {
    expect(blockerRefs(['t2', 't3'], tasks, columns)).toEqual([
      { id: 't2', key: 'MICO-2', title: 'Do first', statusName: 'In Progress', statusCategory: 'IN_PROGRESS', done: false },
      { id: 't3', key: 'MICO-3', title: 'Approved', statusName: 'Done', statusCategory: 'DONE', done: true },
    ]);
  });
  it('still lists a task it can’t find (by id)', () => {
    expect(blockerRefs(['tx'], tasks, columns)).toEqual([{ id: 'tx', key: 'tx', title: 'Task not in this project list', done: false }]);
  });
});

describe('activityFeed', () => {
  it('names who did each thing, from the server or the directory', () => {
    const entries = [
      { id: 'a1', taskId: 't1', userId: 'u1', action: 'MOVED', createdAt: '2026-10-10T08:00:00Z', meta: { from: 'A', to: 'B' }, actor: { id: 'u1', name: 'Omar Ahmed' } },
      { id: 'a2', taskId: 't1', userId: 'u2', action: 'CREATED', createdAt: '2026-10-10T07:00:00Z', meta: null },
    ] as ApiActivityEntry[];
    expect(activityFeed(entries, (id) => (id === 'u2' ? 'Aisha Khan' : 'Someone'))).toEqual([
      { id: 'a1', action: 'MOVED', actorName: 'Omar Ahmed', createdAt: '2026-10-10T08:00:00Z', meta: { from: 'A', to: 'B' } },
      { id: 'a2', action: 'CREATED', actorName: 'Aisha Khan', createdAt: '2026-10-10T07:00:00Z', meta: null },
    ]);
  });
});

describe('taskLoadProblem', () => {
  it('says plainly when the task is gone or not yours to see — no point retrying', () => {
    for (const status of [403, 404]) {
      expect(taskLoadProblem(new ApiError(status, 'NOT_FOUND', 'Not found'))).toEqual({
        message: 'This task wasn’t found, or you don’t have access to it. It may have been deleted.',
        canRetry: false,
      });
    }
  });

  it('blames the connection only when there is no answer from the server', () => {
    expect(taskLoadProblem(new NetworkError('offline'))).toEqual({ message: 'Could not load this task. Check your connection and try again.', canRetry: true });
    expect(taskLoadProblem(new ApiError(500, 'INTERNAL', 'Boom'))).toEqual({ message: 'Could not load this task. Please try again.', canRetry: true });
  });
});

describe('meetingLine', () => {
  const api = 'https://task.mico360.com/api/v1';

  it('names the meeting a task was created from and links to its page on the site', () => {
    expect(meetingLine({ id: 'm 1', title: 'Weekly review', startAt: '2026-10-12T05:00:00.000Z', canView: true }, api, 'en-US', 'Asia/Muscat')).toEqual({
      text: 'From meeting: Weekly review · Mon, Oct 12',
      href: 'https://task.mico360.com/meetings/m%201',
    });
  });

  it('uses the meeting’s day in the company time zone', () => {
    // 22:30 UTC on the 11th is already the 12th in Muscat.
    expect(meetingLine({ id: 'm1', title: 'Late call', startAt: '2026-10-11T22:30:00.000Z', canView: true }, api, 'en-US', 'Asia/Muscat')?.text).toBe('From meeting: Late call · Mon, Oct 12');
  });

  it('only mentions a meeting the person may not see, without a link', () => {
    expect(meetingLine({ id: 'm1', title: null, startAt: null, canView: false }, api)).toEqual({ text: 'From a meeting you’re not part of', href: null });
  });

  it('has nothing for a task made anywhere else, or whose meeting is gone', () => {
    expect(meetingLine(undefined, api)).toBeNull();
    expect(meetingLine(null, api)).toBeNull();
  });
});

describe('dueFieldValue — the due date field shows the same day as everywhere else', () => {
  it('a timestamp is read as its company-time day, not cut at the T', () => {
    expect(dueFieldValue('2026-10-11T22:30:00.000Z')).toBe('2026-10-12'); // Muscat is UTC+4
    expect(dueFieldValue('2026-10-12T00:00:00.000Z')).toBe('2026-10-12'); // a date-only value keeps its day
    expect(dueFieldValue('2026-10-12')).toBe('2026-10-12');
    expect(dueFieldValue(null)).toBe('');
  });
});

describe('conflictText — someone else changed the task first', () => {
  it('says so for a version conflict', () => {
    expect(conflictText(new ApiError(409, 'VERSION_CONFLICT', 'This task was changed by someone else.'))).toBe('Someone else changed this task. Pull down to reload it, then try again.');
  });
  it('otherwise the usual failure text', () => {
    expect(conflictText(new ApiError(400, 'VALIDATION', 'Title is required.'), 'Couldn’t save.')).toBe('Title is required.');
    expect(conflictText(new Error(''), 'Couldn’t save.')).toBe('Couldn’t save.');
  });
});
