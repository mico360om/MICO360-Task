import { describe, it, expect } from 'vitest';
import { FORMERLY_HINT, activityFeed, aiFailureText, blockerRefs, canDeleteTask, conflictText, deleteChoice, dueFieldValue, dueState, formerKeysText, meetingLine, moveBy, taskLoadProblem, taskSections } from './task-detail';
import { hasWeb, readWeb } from '../testing/web-source';
import { ApiError, NetworkError } from './api-client';
import type { ApiActivityEntry, ApiColumn, ApiTask } from './types';

const NOW = new Date('2026-10-10T08:00:00Z'); // 12:00 in Muscat

describe('canDeleteTask', () => {
  const members = [
    { id: 'u1', role: 'MEMBER' as const },
    { id: 'u2', role: 'MANAGER' as const },
  ];
  it('without the project’s canManage (an older server): admins and the project’s managers delete, nobody else', () => {
    expect(canDeleteTask({ id: 'u9', roles: ['ADMIN'] }, {}, members)).toBe(true);
    expect(canDeleteTask({ id: 'u2', roles: ['EMPLOYEE'] }, {}, members)).toBe(true);
    expect(canDeleteTask({ id: 'u1', roles: ['EMPLOYEE'] }, {}, members)).toBe(false);
    expect(canDeleteTask(null, {}, members)).toBe(false);
  });

  it('deleting a task and changing columns follow the project’s canManage', () => {
    const emp = { id: 'u2', roles: ['EMPLOYEE'] };
    expect(canDeleteTask(emp, { canManage: true })).toBe(true);
    expect(canDeleteTask(emp, { canManage: false }, [{ id: 'u2', role: 'MANAGER' }])).toBe(false);
  });
});

describe('deleteChoice (who may delete this task: its creator, or the one person it’s assigned to)', () => {
  const REASON = 'Only the person who created this task, or the one person it’s assigned to, can delete it.';
  const SERIES = 'Only the person who created this repeating task can delete the entire series.';
  const runner = { id: 'u2', roles: ['EMPLOYEE'] };
  const runs = { canManage: true };

  it('not offered at all to someone who may not delete tasks (as before)', () => {
    expect(deleteChoice({ id: 'u1', roles: ['EMPLOYEE'] }, { canManage: false }, [], { createdById: 'u1', canDelete: false }, ['u1'])).toEqual({ offered: false, blocked: null, seriesBlocked: null });
    expect(deleteChoice(null, runs, [], { createdById: 'u1' }, [])).toEqual({ offered: false, blocked: null, seriesBlocked: null });
  });

  it('the server says: offered, greyed out with the reason when it says no', () => {
    expect(deleteChoice(runner, runs, [], { createdById: 'u9', canDelete: false, canDeleteSeries: false }, ['u2'])).toEqual({ offered: true, blocked: REASON, seriesBlocked: SERIES });
    expect(deleteChoice(runner, runs, [], { createdById: 'u9', canDelete: true, canDeleteSeries: false }, [])).toEqual({ offered: true, blocked: null, seriesBlocked: SERIES });
    expect(deleteChoice(runner, runs, [], { createdById: 'u9', canDelete: true, canDeleteSeries: true }, [])).toEqual({ offered: true, blocked: null, seriesBlocked: null });
  });

  it('an older server that doesn’t say: the same rule from who created it and who it’s assigned to', () => {
    expect(deleteChoice(runner, runs, [], { createdById: 'u2' }, ['a', 'b'])).toEqual({ offered: true, blocked: null, seriesBlocked: null });
    expect(deleteChoice(runner, runs, [], { createdById: 'u9' }, ['u2'])).toEqual({ offered: true, blocked: null, seriesBlocked: SERIES });
    expect(deleteChoice(runner, runs, [], { createdById: 'u9' }, ['u2', 'a'])).toEqual({ offered: true, blocked: REASON, seriesBlocked: SERIES });
    expect(deleteChoice(runner, runs, [], {}, [])).toEqual({ offered: true, blocked: REASON, seriesBlocked: SERIES });
  });
});

describe('dueState', () => {
  it('says when it is due, and flags an overdue open task', () => {
    expect(dueState({ dueDate: '2026-10-12T12:00:00Z', completedAt: null }, NOW)).toEqual({ text: 'Due 12 Oct 2026', overdue: false, waiting: false, dayKey: '2026-10-12' });
    expect(dueState({ dueDate: '2026-10-08T12:00:00Z', completedAt: null }, NOW)).toEqual({ text: 'Overdue · 8 Oct 2026', overdue: true, waiting: false, dayKey: '2026-10-08' });
  });
  it('never calls a finished task overdue; no date, no text', () => {
    expect(dueState({ dueDate: '2026-10-08T12:00:00Z', completedAt: '2026-10-09T00:00:00Z' }, NOW).overdue).toBe(false);
    // In a Done column without a completion time (e.g. moved there before completion was recorded).
    expect(dueState({ dueDate: '2026-10-08T12:00:00Z', completedAt: null, columnCategory: 'DONE' }, NOW)).toEqual({ text: 'Due 8 Oct 2026', overdue: false, waiting: false, dayKey: '2026-10-08' });
    expect(dueState({ dueDate: null, completedAt: null }, NOW)).toEqual({ text: null, overdue: false, waiting: false, dayKey: null });
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
  it('still lists a task it couldn’t load (by id)', () => {
    expect(blockerRefs(['tx'], tasks, columns)).toEqual([{ id: 'tx', key: 'tx', title: 'Couldn’t load this task', done: false }]);
  });
  it('says so while a linked task is still loading', () => {
    expect(blockerRefs(['tx'], tasks, columns, new Set(['tx']))).toEqual([{ id: 'tx', key: '…', title: 'Loading…', done: false }]);
  });
  it('knows a task from another project is done by its own column', () => {
    const elsewhere = [{ id: 't7', key: 'RIG-7', title: 'Elsewhere', columnId: 'other', columnCategory: 'DONE', completedAt: null }] as unknown as ApiTask[];
    expect(blockerRefs(['t7'], elsewhere, columns)).toEqual([{ id: 't7', key: 'RIG-7', title: 'Elsewhere', statusName: undefined, statusCategory: undefined, done: true }]);
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
  it('names the meeting a task was created from, and the meeting to open in the app', () => {
    expect(meetingLine({ id: 'm 1', title: 'Weekly review', startAt: '2026-10-12T05:00:00.000Z', canView: true }, 'Asia/Muscat')).toEqual({
      text: 'From meeting: Weekly review · Mon 12 Oct',
      meetingId: 'm 1',
    });
  });

  it('uses the meeting’s day in the company time zone', () => {
    // 22:30 UTC on the 11th is already the 12th in Muscat.
    expect(meetingLine({ id: 'm1', title: 'Late call', startAt: '2026-10-11T22:30:00.000Z', canView: true }, 'Asia/Muscat')?.text).toBe('From meeting: Late call · Mon 12 Oct');
  });

  it('only mentions a meeting the person may not see, with nothing to open', () => {
    expect(meetingLine({ id: 'm1', title: null, startAt: null, canView: false })).toEqual({ text: 'From a meeting you’re not part of', meetingId: null });
  });

  it('has nothing for a task made anywhere else, or whose meeting is gone', () => {
    expect(meetingLine(undefined)).toBeNull();
    expect(meetingLine(null)).toBeNull();
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

describe('aiFailureText — a slow AI is not a lost connection', () => {
  it('says the AI is taking longer than usual when the request timed out', () => {
    expect(aiFailureText(new NetworkError('The server took too long to respond.', { timedOut: true }), 'The AI suggestion failed.')).toBe(
      'The AI is taking longer than usual. Please try again in a minute.',
    );
  });
  it('still says offline when there was no connection at all', () => {
    expect(aiFailureText(new NetworkError('Network request failed.'), 'The AI suggestion failed.')).toMatch(/offline/);
  });
  it('shows the server’s own reason, else the fallback', () => {
    expect(aiFailureText(new ApiError(503, 'AI_UNAVAILABLE', 'AI is not set up on this server.'), 'The AI suggestion failed.')).toBe('AI is not set up on this server.');
    expect(aiFailureText(new Error(''), 'The AI suggestion failed.')).toBe('The AI suggestion failed.');
  });
});

describe('taskSections — the website’s TaskDrawer order (Stage 2)', () => {
  it('on a phone, comments come before files and dependencies (the website’s 1.19 order)', () => {
    expect(taskSections({ wide: false, waiting: false, approval: true })).toEqual({ top: [], main: ['description', 'details', 'checklist', 'comments', 'approval', 'files', 'blockers', 'activity'], side: [] });
    expect(taskSections({ wide: true, waiting: false, approval: true })).toEqual({ top: [], main: ['description', 'checklist', 'comments', 'activity'], side: ['details', 'approval', 'files', 'blockers'] });
  });
  it('a task waiting for approval opens on its Approval section, shown once', () => {
    for (const wide of [false, true]) { const s = taskSections({ wide, waiting: true, approval: true }); expect(s.top).toEqual(['approval']); expect([...s.main, ...s.side]).not.toContain('approval'); }
    expect(Object.values(taskSections({ wide: false, waiting: true, approval: false })).flat()).not.toContain('approval');
  });
  it('says the old numbers', () => { expect(formerKeysText(['RIG-4', 'OPS-2'])).toBe('Formerly RIG-4, OPS-2'); expect(formerKeysText([])).toBeNull(); expect(formerKeysText(undefined)).toBeNull(); });
});
describe.skipIf(!hasWeb('frontend/src/components/TaskDrawer.tsx', 'frontend/src/components/inspections/inspection-ui.tsx'))('the website’s words', () => {
  it('Formerly, Visible to client, Inspection', () => {
    const drawer = readWeb('frontend/src/components/TaskDrawer.tsx');
    for (const w of [FORMERLY_HINT, 'Visible to client', 'Shown on the project’s client page', 'Formerly ']) expect(drawer, w).toContain(w);
    expect(readWeb('frontend/src/components/inspections/inspection-ui.tsx')).toContain('Carried out with an inspection form');
  });
});
