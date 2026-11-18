import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// 1.24.0 (left over from review fix #16): a move of a task saved online — from the board, the task panel's
// Status, the Table, the edit form, the dashboard, search, the calendar or an inspection — drops the mover's
// older offline board moves of that task, so one of them can't replay later and put the task back.
// The Board forgets in its own move mutations; the replay sends queued moves; everything else goes through
// moveTaskOnline (lib/offline-replay), which calls the API's move itself.
const src = resolve(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
// A task API's move: tasksApi(...).move( — also over a line break — or the usual names it is kept under.
const TASK_MOVE = /(?:\btasksApi\([^()]*\)|\b(?:api|tasks))\s*\.move\(/g;
const OWN_RULE = new Set(['components/board/Board.tsx', 'lib/offline-replay.ts']);

const movesIn = (f: string) => [...readFileSync(f, 'utf8').matchAll(TASK_MOVE)].length;

describe('online task moves and the offline queue', () => {
  it('every task move outside the Board and the replay goes through moveTaskOnline', () => {
    const offenders = files(src)
      .map((f) => ({ at: relative(src, f).replace(/\\/g, '/'), n: movesIn(f) }))
      .filter(({ at, n }) => n > 0 && !OWN_RULE.has(at));
    expect(offenders).toEqual([]);
  });

  it('the scan finds the moves it is about (the Board’s two, the replay’s one)', () => {
    expect(movesIn(join(src, 'components/board/Board.tsx'))).toBe(2);
    expect(movesIn(join(src, 'lib/offline-replay.ts'))).toBeGreaterThanOrEqual(1);
  });
});
