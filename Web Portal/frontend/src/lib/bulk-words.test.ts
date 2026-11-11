import { describe, it, expect } from 'vitest';
import type { BulkResult } from '../api/bulk';
import { BULK_LIMIT_TEXT, DUPLICATE_LIMIT_TEXT } from './bulk-selection';
import {
  BULK_UNDO_SECONDS,
  bulkBarActions,
  confirmLines,
  confirmTitle,
  skippedLabel,
  summaryText,
  taskIdsOfLiveEvent,
  undoText,
  type BarContext,
} from './bulk-words';

const ctx = (over: Partial<BarContext> = {}): BarContext => ({
  count: 3,
  projectIds: ['p1'],
  unknownProject: false,
  isAdmin: false,
  managedProjectIds: [],
  move: { canMove: true, reason: null },
  merge: null,
  ...over,
});
const ids = (list: { id: string }[]) => list.map((a) => a.id);
const why = (list: { id: string; unavailable: string | null }[], id: string) => list.find((a) => a.id === id)?.unavailable;

describe('the bar’s actions: who sees what', () => {
  it('an employee: the changes everyone can try (task by task), never Archive, Unarchive or Delete', () => {
    const list = bulkBarActions(ctx());
    expect(ids(list)).toEqual(['status', 'priority', 'assign', 'reassign', 'unassign', 'dueDate', 'project', 'category', 'guests', 'duplicate']);
    expect(list.every((a) => a.unavailable === null)).toBe(true);
  });

  it('administrators, and people who run one of the selected tasks’ projects, also see Archive, Unarchive and Delete', () => {
    expect(ids(bulkBarActions(ctx({ isAdmin: true })))).toEqual(expect.arrayContaining(['archive', 'unarchive', 'delete']));
    expect(ids(bulkBarActions(ctx({ projectIds: ['p1', 'p2'], managedProjectIds: ['p2'] })))).toEqual(expect.arrayContaining(['archive', 'unarchive', 'delete']));
    expect(ids(bulkBarActions(ctx({ managedProjectIds: ['p9'] })))).not.toContain('archive');
  });

  it('Category and Guests only when every selected task is in one project (else unavailable, saying why)', () => {
    const many = bulkBarActions(ctx({ projectIds: ['p1', 'p2'] }));
    expect(why(many, 'category')).toBe('Select tasks of one project to change their categories.');
    expect(why(many, 'guests')).toBe('Select tasks of one project to add guests.');
    // A task brought back by its id alone ("Select the skipped"): its project isn't known.
    expect(why(bulkBarActions(ctx({ unknownProject: true })), 'category')).not.toBeNull();
  });

  it('more than 500: every change is unavailable with the limit; Duplicate stops at 50', () => {
    const over = bulkBarActions(ctx({ count: 501, isAdmin: true, merge: { show: true, reason: null } }));
    expect(over.every((a) => a.unavailable === BULK_LIMIT_TEXT)).toBe(true);
    expect(why(bulkBarActions(ctx({ count: 51 })), 'duplicate')).toBe(DUPLICATE_LIMIT_TEXT);
    expect(why(bulkBarActions(ctx({ count: 51 })), 'status')).toBeNull();
  });

  it('Project and Merge follow today’s rules (Merge only when offered)', () => {
    expect(why(bulkBarActions(ctx({ move: { canMove: false, reason: 'No.' } })), 'project')).toBe('No.');
    expect(ids(bulkBarActions(ctx({ move: null })))).not.toContain('project');
    expect(why(bulkBarActions(ctx({ merge: { show: true, reason: 'Merge at most 10 tasks at a time.' } })), 'merge')).toBe('Merge at most 10 tasks at a time.');
    expect(ids(bulkBarActions(ctx({ merge: { show: false, reason: null } })))).not.toContain('merge');
  });
});

describe('the confirmation’s words', () => {
  it('says what changes and on how many tasks', () => {
    expect(confirmTitle({ type: 'status', status: 'DONE' }, 12)).toBe('Move 12 tasks to Done?');
    expect(confirmTitle({ type: 'priority', priority: 'HIGH' }, 1)).toBe('Set the priority of 1 task to High?');
    expect(confirmTitle({ type: 'assign', userIds: ['a', 'b'] }, 4, { people: { a: 'Sara', b: 'Omar' } })).toBe('Assign Sara and Omar to 4 tasks?');
    expect(confirmTitle({ type: 'reassign', userIds: ['a'] }, 4, { people: { a: 'Sara' } })).toBe('Reassign 4 tasks to Sara only?');
    expect(confirmTitle({ type: 'unassign' }, 4)).toBe('Unassign everyone from 4 tasks?');
    expect(confirmTitle({ type: 'unassign', userIds: ['a'] }, 4, { people: { a: 'Sara' } })).toBe('Unassign Sara from 4 tasks?');
    expect(confirmTitle({ type: 'dueDate', mode: 'set', date: '2026-11-03' }, 4, { today: '2026-11-11' })).toBe('Set the due date of 4 tasks to 3 Nov?');
    expect(confirmTitle({ type: 'dueDate', mode: 'set', date: '2027-01-03' }, 4, { today: '2026-11-11' })).toBe('Set the due date of 4 tasks to 3 Jan 2027?');
    expect(confirmTitle({ type: 'dueDate', mode: 'clear' }, 4)).toBe('Clear the due date of 4 tasks?');
    expect(confirmTitle({ type: 'dueDate', mode: 'shift', days: 3 }, 4)).toBe('Move the due dates of 4 tasks 3 days later?');
    expect(confirmTitle({ type: 'dueDate', mode: 'shift', days: -1 }, 4)).toBe('Move the due dates of 4 tasks 1 day earlier?');
    expect(confirmTitle({ type: 'category', add: ['k1'], remove: ['k2'] }, 4, { categories: { k1: 'Electrical', k2: 'Civil' } })).toBe('Add Electrical and take Civil off 4 tasks?');
    expect(confirmTitle({ type: 'category', remove: ['k2'] }, 4, { categories: { k2: 'Civil' } })).toBe('Take Civil off 4 tasks?');
    expect(confirmTitle({ type: 'guests', add: ['g1'] }, 4, { guests: { g1: 'Ahmed Al Harthy' } })).toBe('Add Ahmed Al Harthy to 4 tasks as a guest?');
    expect(confirmTitle({ type: 'duplicate' }, 4)).toBe('Duplicate 4 tasks?');
    expect(confirmTitle({ type: 'archive' }, 4)).toBe('Archive 4 tasks?');
    expect(confirmTitle({ type: 'unarchive' }, 4)).toBe('Unarchive 4 tasks?');
    expect(confirmTitle({ type: 'delete' }, 4)).toBe('Move 4 tasks to the Recycle Bin?');
    expect(confirmTitle({ type: 'project', projectId: 'p2' }, 4, { projectName: 'Operations' })).toBe('Move 4 tasks to Operations?');
  });

  const dry = (over: Partial<BulkResult>): BulkResult => ({ action: 'status', dryRun: true, total: 12, changed: [], skipped: [], undo: null, ...over });
  const changed = (n: number, note?: { code: string; text: string }) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, key: `RIG-${i}`, title: 'T', projectId: 'p1', ...(note ? { note } : {}) }));

  it('how many change, how many will be skipped and why (grouped by reason), and the notes', () => {
    const r = dry({
      changed: [...changed(8), ...changed(2, { code: 'WAITS_FOR_APPROVAL', text: 'Waits for approval' })],
      skipped: [
        { id: 's1', key: 'RIG-2', title: 'Set out', code: 'FORBIDDEN', reason: 'You can’t move tasks in Rig 3.' },
        { id: 's2', code: 'FORBIDDEN', reason: 'You can’t move tasks in Rig 3.' },
      ],
    });
    expect(confirmLines(r)).toEqual(['10 tasks will change.', '2 will be skipped: you can’t move tasks in Rig 3.', '2 will wait for approval.']);
  });

  it('everything changes: says so plainly; nothing would change: says so', () => {
    expect(confirmLines(dry({ total: 1, changed: changed(1) }))).toEqual(['1 task will change.']);
    expect(confirmLines(dry({ total: 2, skipped: [{ id: 'a', code: 'UNCHANGED', reason: 'Already Done.' }, { id: 'b', code: 'UNCHANGED', reason: 'Already Done.' }] }))).toEqual([
      'Nothing would change.',
      '2 will be skipped: already Done.',
    ]);
  });
});

describe('the summary’s words', () => {
  const done = (action: BulkResult['action'], c: number, s: number): BulkResult => ({
    action,
    dryRun: false,
    total: c + s,
    changed: Array.from({ length: c }, (_, i) => ({ id: `c${i}`, key: `K-${i}`, title: 'T', projectId: 'p' })),
    skipped: Array.from({ length: s }, (_, i) => ({ id: `s${i}`, code: 'FORBIDDEN', reason: 'No.' })),
    undo: null,
  });
  it('"18 updated · 2 not changed" (the words of the action)', () => {
    expect(summaryText(done('status', 18, 2))).toBe('18 updated · 2 not changed');
    expect(summaryText(done('priority', 3, 0))).toBe('3 updated');
    expect(summaryText(done('duplicate', 4, 1))).toBe('4 copied · 1 not copied');
    expect(summaryText(done('delete', 2, 0))).toBe('2 moved to the Recycle Bin');
    expect(summaryText(done('archive', 2, 0))).toBe('2 archived');
    expect(summaryText(done('unarchive', 2, 0))).toBe('2 unarchived');
  });

  it('a skipped task by its number and title — or "A task you can’t open"', () => {
    expect(skippedLabel({ id: 'a', key: 'RIG-2', title: 'Set out', code: 'X', reason: 'r' })).toBe('RIG-2 Set out');
    expect(skippedLabel({ id: 'a', code: 'NOT_FOUND', reason: 'r' })).toBe('A task you can’t open');
  });

  it('Undo’s answer: "12 put back · 1 left as it was: changed since"', () => {
    const restored = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, key: `K-${i}`, title: 'T', projectId: 'p' }));
    expect(undoText({ restored, skipped: [{ id: 'x', key: 'K-1', title: 'T', code: 'CHANGED_SINCE', reason: 'Changed since — left as it is.' }] })).toBe('12 put back · 1 left as it was: changed since');
    expect(undoText({ restored: restored.slice(0, 1), skipped: [] })).toBe('1 put back');
    expect(undoText({ restored: [], skipped: [{ id: 'x', code: 'CHANGED_SINCE', reason: '' }, { id: 'y', code: 'FORBIDDEN', reason: 'You can’t change it now.' }] })).toBe(
      '0 put back · 2 left as they were: 1 changed since; 1 you can’t change it now',
    );
  });

  it('Undo is offered for 15 seconds', () => {
    expect(BULK_UNDO_SECONDS).toBe(15);
  });
});

describe('live updates', () => {
  it('a bulk change’s one event per project names its tasks in ids (no id); a single change in id', () => {
    expect(taskIdsOfLiveEvent({ bulk: true, ids: ['t1', 't2', 3] })).toEqual(['t1', 't2']);
    expect(taskIdsOfLiveEvent({ id: 't9' })).toEqual(['t9']);
    expect(taskIdsOfLiveEvent(undefined)).toEqual([]);
    expect(taskIdsOfLiveEvent('nope')).toEqual([]);
  });
});
