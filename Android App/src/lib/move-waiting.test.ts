/** A move into Done that waits for approval says so, and the card stays where the server put it (source text: the screens and hooks need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('the board and the task screen tell the person when the task went to wait', () => {
  expect(src('screens/TaskDetailScreen.tsx')).toMatch(/approvalNotice\(vars\.columnId, moved\)/);
  // The board's move goes through moveCard, which asks approvalNotice and answers 'waiting' (board-writes.test.ts).
  for (const f of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) expect(src(f), f).toMatch(/out\.kind === 'waiting'[^]*?notice\(out\.message\)|notice\(out\.message\)[^]*?out\.kind === 'waiting'/);
  expect(src('lib/board-writes.ts')).toMatch(/approvalNotice\(req\.toColumnId, /);
});

it('the move hooks write the server’s answer into the caches', () => {
  expect(src('core/queries.ts')).toMatch(/onSuccess: \(moved[^]*placeAsServerSays/);
  expect(src('core/all-board-queries.ts')).toMatch(/placeAsServerSays/);
  expect(src('core/all-board-queries.ts')).toMatch(/approvalNotice\(/);
});

it('bulk Complete hands the server’s answers back so the waiting ones are counted', () => {
  expect(src('core/my-tasks-queries.ts')).toMatch(/const moved = await sendTaskMove\([^]*?return moved;/);
});
