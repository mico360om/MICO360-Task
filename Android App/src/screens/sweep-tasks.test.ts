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

it('the Dashboard counts are stat tiles', () => expect(src('screens/DashboardScreen.tsx').match(/<StatTile /g)?.length).toBe(4));

it('the Dashboard tiles: Overdue, Due today, Upcoming, Completed in their tones, and an empty day says so with an icon', () => {
  const s = src('screens/DashboardScreen.tsx');
  for (const [label, icon, tone] of [['Overdue', 'ui.alert', 'danger'], ['Due today', 'kit.calendar', 'warning'], ['Upcoming', 'kit.clock', 'info'], ['Completed', 'kit.checkCircle', 'success']]) {
    expect(s, label).toMatch(new RegExp(`<StatTile label="${label}" value=\\{[^}]+\\} icon="${icon}" tone="${tone}" />`));
  }
  expect(s).toMatch(/<EmptyState icon="kit\.checkCircle" title="Nothing due today\." \/>/);
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
