import { describe, it, expect } from 'vitest';
import { COLUMN_FIT_BELOW, boardCard, cardView, columnFill, composeBoard } from './board';
import { allBoardCard } from './all-board';
import type { ApiColumn, ApiTask } from './types';

const col = (id: string, position: number, enabled = true): ApiColumn => ({
  id,
  projectId: 'p1',
  name: id,
  category: 'TODO',
  position,
  color: '#8B1E1E',
  enabled,
});

const task = (id: string, columnId: string, position: number): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId,
  position,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
});

describe('composeBoard', () => {
  it('orders columns by position and nests each column its own tasks in order', () => {
    const columns = [col('b', 1), col('a', 0)];
    const tasks = [task('t2', 'a', 1), task('t1', 'a', 0), task('t3', 'b', 0)];
    const board = composeBoard(columns, tasks);
    expect(board.map((b) => b.column.id)).toEqual(['a', 'b']);
    expect(board[0]!.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(board[1]!.tasks.map((t) => t.id)).toEqual(['t3']);
  });

  it('excludes disabled columns', () => {
    const board = composeBoard([col('a', 0), col('hidden', 1, false)], [task('t1', 'hidden', 0)]);
    expect(board.map((b) => b.column.id)).toEqual(['a']);
  });

  it('returns empty task lists for columns with no tasks', () => {
    const board = composeBoard([col('a', 0)], []);
    expect(board).toEqual([{ column: col('a', 0), tasks: [] }]);
  });
});

// ── Stage 2 Task 8: the client and inspection marks; empty columns shrink on a phone ──
const NOW = new Date('2026-10-30T08:00:00Z');
const TZ = 'Asia/Muscat';
/** cardTask(o): a minimal task in the To do column, changed by `o`. */
const cardTask = (o: Partial<ApiTask> = {}): ApiTask => ({ ...task('t1', 'c1', 0), key: 'RIG-1', title: 'Check pumps', ...o });
const todoColumn = col('c1', 0);

describe('board cards: the client and inspection marks (the website’s TaskCard)', () => {
  it('a card carries the client and inspection marks, in words for TalkBack', () => {
    const card = boardCard(cardTask({ clientVisible: true, inspectionFormId: 'f1' }), todoColumn);
    expect(card).toMatchObject({ clientVisible: true, inspection: true });
    expect(cardView(card, { now: NOW, timeZone: TZ }).label).toMatch(/Visible to client\.[^]*Inspection\./);
    expect(boardCard(cardTask({}), todoColumn)).toMatchObject({ clientVisible: false, inspection: false });
    expect(cardView(boardCard(cardTask({}), todoColumn), { now: NOW, timeZone: TZ }).label).not.toMatch(/Visible to client|Inspection/);
    // The All projects board's cards are the same cards (allBoardCard spreads boardCard).
    expect(allBoardCard(cardTask({ clientVisible: true, inspectionFormId: 'f1' }), 'TODO', { name: 'Rig', code: 'RIG', color: null, icon: null, imageUrl: null }, '#888')).toMatchObject({ clientVisible: true, inspection: true });
  });
  it('the words follow the card: the eye after the milestone, before the repeat; Inspection after waiting, before the due day', () => {
    const card = boardCard(cardTask({ clientVisible: true, inspectionFormId: 'f1', isMilestone: true, recurrenceRule: { freq: 'DAILY', interval: 1 }, approvalRequestedAt: '2026-10-29T08:00:00Z', dueDate: '2026-10-31' }), todoColumn);
    expect(cardView(card, { now: NOW, timeZone: TZ }).label).toBe('RIG-1, Check pumps. Normal priority. Milestone. Visible to client. Repeats. Waiting for approval. Inspection. Due 31 Oct 2026. 0% done. Nobody assigned.');
  });
});

describe('columnFill: on a phone an empty column is only as tall as its "No tasks" (the website’s max-md)', () => {
  it('on a phone an empty column is only as tall as its "No tasks"', () => {
    expect(columnFill({ cards: 0, screenWidth: 360 })).toBe('fit'); expect(columnFill({ cards: 2, screenWidth: 360 })).toBe('fill'); expect(columnFill({ cards: 0, screenWidth: 800 })).toBe('fill');
    expect(COLUMN_FIT_BELOW).toBe(768);
    expect(columnFill({ cards: 0, screenWidth: 767 })).toBe('fit'); expect(columnFill({ cards: 0, screenWidth: 768 })).toBe('fill');
  });
});
