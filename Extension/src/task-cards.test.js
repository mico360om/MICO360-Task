import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardFacts, cardLabel, formatDueDay, personInitials, doneColumnOf, sortTasks, SORT_OPTIONS, projectFilterOptions } from './task-cards.js';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T06:00:00Z'); // 10:00 in Muscat
const task = (over = {}) => ({ id: 't1', key: 'RIG-7', title: 'Inspect the valve', priority: 'HIGH', dueDate: '2026-10-20T00:00:00.000Z', progress: 40, completedAt: null, columnCategory: 'IN_PROGRESS', isMilestone: false, recurrenceRule: null, assignees: [], ...over });

describe('what a board card shows (as the web’s TaskCard)', () => {
  it('its due day in company time, and “Overdue” once that day has passed — never for finished work', () => {
    expect(cardFacts(task(), { timeZone: TZ, now: NOW })).toMatchObject({ overdue: true, due: 'Oct 20, 2026', dueText: 'Overdue · Oct 20, 2026' });
    expect(cardFacts(task({ dueDate: '2026-10-21T00:00:00.000Z' }), { timeZone: TZ, now: NOW })).toMatchObject({ overdue: false, dueText: 'Oct 21, 2026' });
    expect(cardFacts(task({ columnCategory: 'DONE' }), { timeZone: TZ, now: NOW })).toMatchObject({ done: true, overdue: false, dueText: 'Oct 20, 2026' });
    expect(cardFacts(task({ completedAt: '2026-10-20T09:00:00Z' }), { timeZone: TZ, now: NOW }).overdue).toBe(false);
    expect(cardFacts(task({ dueDate: null }), { timeZone: TZ, now: NOW })).toMatchObject({ due: '', dueText: '' });
  });

  it('subtasks, comments and files, each only when there are some', () => {
    const counts = { comments: 3, attachments: 0, checklistDone: 2, checklistTotal: 5 };
    expect(cardFacts(task({ counts }), { timeZone: TZ, now: NOW }).counts).toEqual([
      { kind: 'checklist', label: 'Subtasks done', value: '2/5' },
      { kind: 'comments', label: 'Comments', value: '3' },
    ]);
    expect(cardFacts(task(), { timeZone: TZ, now: NOW }).counts).toEqual([]);
  });

  it('up to three people, then “+N”; one person’s name is written out', () => {
    const people = [{ id: 'u1', name: 'Omar Ahmed' }, { id: 'u2', name: 'Aisha Khan' }, { id: 'u3', name: 'Bilal' }, { id: 'u4', name: 'Sara Ali' }];
    const f = cardFacts(task({ assignees: people }), { timeZone: TZ, now: NOW });
    expect(f.people.shown.map((p) => p.initials)).toEqual(['OA', 'AK', 'B']);
    expect(f.people.extra).toBe(1);
    expect(f.people.single).toBeNull();
    expect(cardFacts(task({ assignees: people.slice(0, 1) }), { timeZone: TZ, now: NOW }).people.single).toBe('Omar Ahmed');
  });

  it('a milestone, a blocked column, a repeat; and a label that says it all', () => {
    const f = cardFacts(task({ isMilestone: true, columnCategory: 'BLOCKED', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, counts: { comments: 1, attachments: 2, checklistDone: 0, checklistTotal: 3 }, assignees: [{ id: 'u1', name: 'Omar Ahmed' }, { id: 'u2', name: 'Aisha Khan' }] }), { timeZone: TZ, now: NOW });
    expect(f).toMatchObject({ milestone: true, blocked: true, recurring: true });
    expect(cardLabel(task({ isMilestone: true, columnCategory: 'BLOCKED', recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), f)).toBe(
      'Inspect the valve, RIG-7, High priority, milestone, blocked, overdue, due Oct 20, 2026, repeats, 0 of 3 subtasks done, 1 comment, 2 attachments, assigned to Omar Ahmed and Aisha Khan',
    );
  });

  it('initials as the web’s avatars make them', () => {
    expect(personInitials('Omar  Ahmed Ali')).toBe('OA');
    expect(personInitials('bilal')).toBe('B');
    expect(personInitials('  ')).toBe('');
  });
});

describe('the project’s Done column (where “Mark done” moves a task)', () => {
  const col = (id, category, position, enabled = true) => ({ id, category, position, enabled });
  it('its first shown Done column; one switched off only when there is no other', () => {
    expect(doneColumnOf([col('a', 'TODO', 0), col('d2', 'DONE', 5), col('d1', 'DONE', 3)])).toBe('d1');
    expect(doneColumnOf([col('a', 'TODO', 0), col('d1', 'DONE', 3, false), col('d2', 'DONE', 5)])).toBe('d2');
    expect(doneColumnOf([col('a', 'TODO', 0), col('d1', 'DONE', 3, false)])).toBe('d1');
    expect(doneColumnOf([col('a', 'TODO', 0)])).toBeNull();
    expect(doneColumnOf(null)).toBeNull();
  });
});

describe('My Tasks: sort and the project filter (as the web’s My Tasks)', () => {
  const list = [
    task({ id: 'a', title: 'beta', priority: 'LOW', dueDate: '2026-10-25T00:00:00.000Z', progress: 10 }),
    task({ id: 'b', title: 'Alpha', priority: 'URGENT', dueDate: null, progress: 90 }),
    task({ id: 'c', title: 'gamma', priority: 'NORMAL', dueDate: '2026-10-22T00:00:00.000Z', progress: 50 }),
  ];
  it('by due date (no date last), priority, progress (most first) or title', () => {
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Due date', 'Priority', 'Progress', 'Title (A–Z)']);
    expect(sortTasks(list, 'due', TZ).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasks(list, 'priority', TZ).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(list, 'progress', TZ).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(list, 'title', TZ).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']); // a sorted copy
  });

  it('the projects my tasks are in, by name, after “All projects”', () => {
    const projects = [{ id: 'p2', name: 'Office Ops', code: 'OPS' }, { id: 'p1', name: 'Rig Inspection', code: 'RIG' }, { id: 'p9', name: 'Unused', code: 'UN' }];
    const mine = [task({ projectId: 'p1' }), task({ projectId: 'p2' }), task({ projectId: 'p1' }), task({ projectId: 'gone' })];
    expect(projectFilterOptions(mine, projects)).toEqual([
      { value: '', label: 'All projects' },
      { value: 'p2', label: 'Office Ops' },
      { value: 'p1', label: 'Rig Inspection' },
      { value: 'gone', label: 'Project' },
    ]);
  });
});

// The rules are the web's: its board (lib/board.ts composeBoard, targetColumnFor), its due days
// (lib/due-display.ts) and avatars. These fail when the copies drift (skipped without the website).
const repo = resolve(__dirname, '../..');
const load = (file) => (existsSync(resolve(repo, file)) ? import(pathToFileURL(resolve(repo, file)).href) : null);
const webBoard = await load('Web Portal/frontend/src/lib/board.ts');
const webDue = await load('Web Portal/frontend/src/lib/due-display.ts');

describe.skipIf(!webBoard || !webDue)('src/task-cards.js matches the web (lib/board.ts, lib/due-display.ts)', () => {
  const COLUMNS = [
    { id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true, color: '#999' },
    { id: 'c2', name: 'Blocked', category: 'BLOCKED', position: 1, enabled: true, color: '#c00' },
    { id: 'c3', name: 'Done', category: 'DONE', position: 2, enabled: true, color: '#0a0' },
    { id: 'c4', name: 'Shipped', category: 'DONE', position: 3, enabled: true, color: '#0a0' },
  ];
  const TASKS = [
    task({ id: 'a', key: 'A-1', columnId: 'c1', position: 0, isMilestone: true, counts: { comments: 1, attachments: 2, checklistDone: 1, checklistTotal: 4 }, assignees: [{ id: 'u1', name: 'Omar Ahmed' }] }),
    task({ id: 'b', key: 'A-2', columnId: 'c2', position: 0, recurrenceRule: { freq: 'DAILY', interval: 1 } }),
    task({ id: 'c', key: 'A-3', columnId: 'c3', position: 0, completedAt: null }),
    task({ id: 'd', key: 'A-4', columnId: 'c1', position: 1, completedAt: '2026-10-19T08:00:00Z', isMilestone: undefined }),
  ];

  it('a card says the same about a task as the web’s board does', () => {
    const web = new Map(webBoard.composeBoard(COLUMNS, TASKS).flatMap((c) => c.tasks).map((t) => [t.key, t]));
    for (const t of TASKS) {
      const category = COLUMNS.find((c) => c.id === t.columnId).category;
      const mine = cardFacts({ ...t, columnCategory: category }, { timeZone: TZ, now: NOW });
      const w = web.get(t.key);
      expect({ done: mine.done, blocked: mine.blocked, milestone: mine.milestone, recurring: mine.recurring }, t.key)
        .toEqual({ done: w.done, blocked: w.blocked, milestone: w.milestone, recurring: w.recurring });
    }
  });

  it('“Mark done” lands in the column the web’s board would move a card to', () => {
    expect(doneColumnOf(COLUMNS)).toBe(webBoard.targetColumnFor(COLUMNS, 'DONE'));
    const reordered = COLUMNS.map((c) => (c.id === 'c4' ? { ...c, position: -1 } : c));
    expect(doneColumnOf(reordered)).toBe(webBoard.targetColumnFor(reordered, 'DONE'));
  });

  it('the same due day, written the same way', () => {
    for (const due of [null, '', '2026-10-20T00:00:00.000Z', '2026-12-31T21:00:00+03:00', '2026-02-28', 'nope']) {
      expect(formatDueDay(due, TZ), String(due)).toBe(webDue.formatDueDay(due, TZ));
    }
  });
});
