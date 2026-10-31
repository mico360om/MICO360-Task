import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The Task 16 sweep: the Dashboard, My Tasks, the boards and the calendar in the website's look. */

it('cards and rows mark a task waiting for approval with the chip', () => {
  for (const f of ['components/board/BoardCard.tsx', 'components/my-tasks/MyTaskItem.tsx']) expect(src(f), f).toMatch(/\{(view|row)\.(waiting|awaitingApproval) \? \(\s*<View importantForAccessibility="no-hide-descendants">\s*<ApprovalChip/);
});

it('priority is the website’s badge (Normal neutral), faces are Avatars', () => {
  expect(src('components/TaskRow.tsx')).toMatch(/<PriorityBadge priority=/);
  expect(src('components/board/BoardCard.tsx')).toMatch(/<Avatar /);
  for (const f of ['components/board/BoardCard.tsx', 'components/my-tasks/MyTaskItem.tsx']) {
    expect(src(f), f).toMatch(/<PriorityBadge priority=/);
    expect(src(f), f).toMatch(/<Avatar name=/);
    expect(src(f), f).not.toMatch(/priorityColor/);
  }
});

// Stage 2: the website's four tiles, one StatTile per tile (components/dashboard/DashboardTiles.tsx).
it('the Dashboard counts are stat tiles', () => {
  const s = src('components/dashboard/DashboardTiles.tsx');
  expect(s).toMatch(/tiles\.map\(\(t\) => \([^]*?<StatTile/);
  expect(s.match(/<StatTile/g)?.length).toBe(1);
  expect(src('screens/DashboardScreen.tsx')).toMatch(/<DashboardTiles tiles=\{tiles\}/);
});

// Stage 2: each tile's tone and drawn icon are the website's (lib/dashboard dashboardTiles, tested in
// lib/dashboard.test.ts); an empty Due soon says so with the check icon.
it('the Dashboard tiles in their tones and icons, and an empty Due soon says so with an icon', () => {
  expect(src('components/dashboard/DashboardTiles.tsx')).toMatch(/icon=\{t\.icon\}\s*tone=\{t\.tone\}/);
  expect(src('components/dashboard/DueSoonCard.tsx')).toMatch(/<Icon name="kit\.checkCircle" size=\{16\} color=\{c\.successText\} \/>\s*<Text[^>]*>\{DASHBOARD_TEXT\.allClear\}/);
});

it('day and month steppers are icon buttons: back, and back turned for next', () => {
  for (const f of ['components/board/BoardDayBar.tsx', 'components/calendar/CalendarSheets.tsx', 'screens/CalendarScreen.tsx']) {
    expect(src(f), f).toMatch(/<IconButton icon="ui\.back" label=/);
    expect(src(f), f).toMatch(/<IconButton icon="ui\.back" rotate=\{180\} label=/);
  }
});

it('the card’s counts, milestone, repeat and menu are drawn icons', () => {
  const card = src('components/board/BoardCard.tsx');
  expect(card).toMatch(/checklist: 'misc\.check', comments: 'ui\.message', files: 'ui\.paperclip'/);
  expect(card).toMatch(/name="misc\.milestone"/);
  expect(card).toMatch(/name="kit\.repeat"/);
});

it('a first load shows skeletons on these screens', () => {
  for (const f of ['screens/DashboardScreen.tsx', 'screens/MyTasksScreen.tsx', 'screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx', 'screens/BoardColumnsScreen.tsx', 'screens/CalendarScreen.tsx']) {
    expect(src(f), f).toMatch(/<SkeletonList /);
  }
});

it('My Tasks’ filter pills are the shared chips', () => expect(src('screens/MyTasksScreen.tsx').match(/<Chip label=/g)?.length).toBe(4));
