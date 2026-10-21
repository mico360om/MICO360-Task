import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { boardCard, cardView, composeBoard, personInitials, type BoardCard } from './board';
import type { ApiColumn, ApiTask } from './types';

const col = (id: string, patch: Partial<ApiColumn> = {}): ApiColumn => ({ id, projectId: 'p1', name: id, category: 'TODO', position: 0, color: '#1E5A8B', enabled: true, ...patch });
const task = (id: string, patch: Partial<ApiTask> & Record<string, unknown> = {}): ApiTask =>
  ({
    id,
    key: `MICO-${id}`,
    title: `Task ${id}`,
    description: null,
    projectId: 'p1',
    columnId: 'c1',
    position: 0,
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    progress: 0,
    completedAt: null,
    ...patch,
  }) as ApiTask;

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T08:00:00Z');

describe('a board card shows what the website’s card shows (4b)', () => {
  it('takes its colour from its column, and is blocked, repeating, a milestone or finished as on the website', () => {
    const blocked = col('b', { category: 'BLOCKED', color: '#B5432E' });
    const done = col('d', { category: 'DONE', color: '#2E7D53' });
    expect(boardCard(task('1', { columnId: 'b' }), blocked)).toMatchObject({ accentColor: '#B5432E', blocked: true, done: false });
    expect(boardCard(task('2', { columnId: 'd' }), done)).toMatchObject({ done: true, blocked: false });
    expect(boardCard(task('3', { completedAt: '2026-10-20T10:00:00Z' }), col('c1'))).toMatchObject({ done: true });
    expect(boardCard(task('4', { recurrenceRule: { freq: 'DAILY', interval: 1 }, isMilestone: true }), col('c1'))).toMatchObject({ recurring: true, milestone: true });
  });

  it('says Overdue only once the due day is past in company time, and never for finished work', () => {
    const late = cardView(boardCard(task('1', { dueDate: '2026-10-20' }), col('c1')), { now: NOW, timeZone: TZ });
    expect(late).toMatchObject({ overdue: true, dueText: 'Overdue · Oct 20, 2026' });
    const today = cardView(boardCard(task('2', { dueDate: '2026-10-21' }), col('c1')), { now: NOW, timeZone: TZ });
    expect(today).toMatchObject({ overdue: false, dueText: 'Oct 21, 2026' });
    const finished = cardView(boardCard(task('3', { dueDate: '2026-10-01', columnId: 'd' }), col('d', { category: 'DONE' })), { now: NOW, timeZone: TZ });
    expect(finished).toMatchObject({ overdue: false, dueText: 'Oct 1, 2026' });
    expect(cardView(boardCard(task('4'), col('c1')), { now: NOW, timeZone: TZ })).toMatchObject({ hasDue: false, dueText: null });
  });

  it('shows up to three people and “+N”, the one person’s name, and the counts only when there are some', () => {
    const people = [1, 2, 3, 4, 5].map((n) => ({ id: `u${n}`, name: `Person ${n}` }));
    const many = cardView(boardCard(task('1', { assignees: people as never, counts: { comments: 2, attachments: 0, checklistDone: 1, checklistTotal: 3 } }), col('c1')), { now: NOW, timeZone: TZ });
    expect(many.shown.map((p) => p.id)).toEqual(['u1', 'u2', 'u3']);
    expect(many.extra).toBe(2);
    expect(many.singleName).toBeNull();
    expect(many.counts).toEqual([
      { kind: 'checklist', value: '1/3', label: 'Subtasks done: 1 of 3' },
      { kind: 'comments', value: '2', label: '2 comments' },
    ]);
    const one = cardView(boardCard(task('2', { assignees: [{ id: 'u1', name: 'Ann Lee' }] as never }), col('c1')), { now: NOW, timeZone: TZ });
    expect(one).toMatchObject({ singleName: 'Ann Lee', extra: 0, counts: [] });
    // The full people the create answer carries are named the same way.
    const full = boardCard(task('3', { assignees: [{ id: 'u9', username: 'cy', email: 'c@x', firstName: 'Cy', lastName: 'Do' }] }), col('c1'));
    expect(full.assignees).toEqual([{ id: 'u9', name: 'Cy Do' }]);
  });

  it('reads everything it shows to TalkBack, in words', () => {
    const card = boardCard(
      task('1', {
        title: 'Fix pump',
        priority: 'HIGH',
        dueDate: '2026-10-20',
        progress: 40,
        isMilestone: true,
        assignees: [{ id: 'u1', name: 'Ann Lee' }] as never,
        counts: { comments: 1, attachments: 2, checklistDone: 0, checklistTotal: 0 },
      }),
      col('b', { category: 'BLOCKED', name: 'Waiting' }),
    );
    expect(cardView(card, { now: NOW, timeZone: TZ }).label).toBe('MICO-1, Fix pump. High priority. Blocked. Milestone. Overdue, due Oct 20, 2026. 40% done. Ann Lee. 1 comment. 2 files.');
  });
});

describe('the cards follow the website’s card rules (drift)', () => {
  const web = (p: string) => readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src', p), 'utf8');
  type Fn = (...a: unknown[]) => unknown;

  it('the website’s composeBoard gives the same columns, order and card fields', () => {
    const { code } = transformSync(web('lib/board.ts'), { loader: 'ts', format: 'cjs' });
    const mod = { exports: {} as Record<string, Fn> };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({ STATUS_META: {}, STATUS_ORDER: [] }));
    const columns = [col('c2', { position: 1, category: 'BLOCKED', color: '#B5432E' }), col('c1', { position: 0 }), col('off', { position: 2, enabled: false })];
    const tasks = [
      task('1', { columnId: 'c1', position: 1, dueDate: '2026-10-20', assignees: [{ id: 'u1', name: 'Ann' }] as never }),
      task('2', { columnId: 'c1', position: 0, recurrenceRule: { freq: 'DAILY', interval: 1 }, isMilestone: true }),
      task('3', { columnId: 'c2', completedAt: '2026-10-01T00:00:00Z', counts: { comments: 1, attachments: 0, checklistDone: 0, checklistTotal: 0 } }),
      task('4', { columnId: 'off' }),
    ];
    const theirs = mod.exports.composeBoard!(columns, tasks) as { id: string; color: string; tasks: Record<string, unknown>[] }[];
    const ours = composeBoard(columns, tasks).map((b) => ({ id: b.column.id, color: b.column.color, tasks: b.tasks.map((t) => boardCard(t, b.column)) }));
    expect(ours.map((c) => c.id)).toEqual(theirs.map((c) => c.id));
    const fields = ['key', 'title', 'priority', 'dueDate', 'progress', 'assignees', 'counts', 'accentColor', 'blocked', 'recurring', 'milestone', 'done'] as const;
    theirs.forEach((column, i) => {
      expect(ours[i]!.color).toBe(column.color);
      const mine = ours[i]!.tasks.map((card: BoardCard) => Object.fromEntries(fields.map((f) => [f, card[f]])));
      expect(mine).toEqual(column.tasks.map((t) => Object.fromEntries(fields.map((f) => [f, t[f]]))));
    });
  });

  it('the website’s card: Overdue in company time and never when done, the due text, three faces and +N, counts only when there are some', () => {
    const card = web('components/TaskCard.tsx');
    expect(card).toMatch(/const overdue = !task\.done && isOverdue\(task\.dueDate, timeZone\);/);
    expect(card).toMatch(/const dueText = formatDueDay\(task\.dueDate, timeZone\) \|\| 'No due date';/);
    expect(card).toMatch(/\{overdue \? `Overdue · \$\{dueText\}` : dueText\}/);
    expect(card).toMatch(/const shownAssignees = task\.assignees\.slice\(0, 3\);/);
    expect(card).toMatch(/c && c\.checklistTotal > 0 \?/);
    expect(card).toMatch(/c && c\.comments > 0 \?/);
    expect(card).toMatch(/c && c\.attachments > 0 \?/);
    expect(card).toMatch(/task\.assignees\.length === 1 \?/);
    expect(web('lib/due-display.ts')).toMatch(/opts: Intl\.DateTimeFormatOptions = \{ month: 'short', day: 'numeric', year: 'numeric' \}/);
  });
});

describe('a face without a photo shows initials, as the website’s Avatar does (4b)', () => {
  it('the first letters of the first two words', () => {
    expect(personInitials('Ann Lee')).toBe('AL');
    expect(personInitials('  maryam  al balushi ')).toBe('MA');
    expect(personInitials('omar')).toBe('O');
    expect(readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src/components/ui/Avatar.tsx'), 'utf8')).toMatch(/\.split\(\/\\s\+\/\)\s*\.map\(\(part\) => part\[0\] \?\? ''\)\s*\.slice\(0, 2\)/);
  });
});
