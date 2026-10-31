import { it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

// Stage 2 Task 8: the website's board card marks, and short empty columns on a phone.
it('the card shows the eye after the milestone and the inspection chip after the approval chip', () => {
  const s = src('components/board/BoardCard.tsx');
  expect(s).toMatch(/card\.clientVisible \? <Icon name="misc\.eye"/); expect(s.indexOf('<ApprovalChip')).toBeLessThan(s.indexOf('<InspectionChip'));
  expect(s.indexOf('name="misc.milestone"')).toBeLessThan(s.indexOf('name="misc.eye"')); expect(s.indexOf('name="misc.eye"')).toBeLessThan(s.indexOf('name="kit.repeat"'));
  // The facts row: approval, inspection, the due day, the counts — one row, as the website's.
  expect(s.indexOf('<InspectionChip')).toBeLessThan(s.indexOf('view.dueText ?'));
  expect(s).toMatch(/view\.waiting \|\| card\.inspection \|\| view\.hasDue \|\| view\.counts\.length/);
});
it('a column takes the board’s height only when it fills', () => expect(src('components/board/BoardColumnView.tsx')).toMatch(/columnFill\([^)]*\) === 'fill' \? \{ height \}/));
it('both boards let short columns stay short', () => { for (const f of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) expect(src(f), f).toMatch(/alignItems: 'flex-start'/); });
it.skipIf(!hasWeb('frontend/src/components/KanbanBoard.tsx'))('the website shrinks empty columns below md (768 px)', () => expect(readWeb('frontend/src/components/KanbanBoard.tsx')).toContain('max-md:items-start'));
