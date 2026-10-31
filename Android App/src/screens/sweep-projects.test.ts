import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The Task 18 sweep: Projects, project pages, User Management and Reports in the website's look. */

it('project progress is drawn in the project’s colour', () => {
  const s = src('screens/ProjectsScreen.tsx');
  expect(s).toMatch(/<ProgressBar[^>]*color=\{/);
  expect(s).toMatch(/const color = p\.color && HEX_COLOR\.test\(p\.color\) \? p\.color : DEFAULT_PROJECT_COLOR;/);
  expect(s).not.toMatch(/'#8B1E1E'/);
});

it('a project card is a Card with its picture (md) and its status badge', () => {
  const s = src('screens/ProjectsScreen.tsx');
  expect(s).toMatch(/<Card padded=\{false\} style=\{s\.card\}>/);
  expect(s).toMatch(/<ProjectAvatar project=\{p\} size="md" \/>/);
  expect(s).toMatch(/<Badge label=\{projectStatusLabel\(p\.status\)\} tone=\{projectStatusTone\(p\.status\)\} \/>/);
});

it('team and user rows use Avatar', () => {
  for (const f of ['components/project/TeamTab.tsx', 'screens/UsersScreen.tsx']) expect(src(f), f).toContain('<Avatar ');
  expect(src('components/project/TeamTab.tsx')).not.toMatch(/backgroundColor: c\.brand, alignItems/); // not the solid maroon circle
});

// Stage 2: the all-projects totals are the Dashboard's top tiles (components/dashboard/DashboardTiles.tsx).
it('Reports and the all-projects totals show their figures as stat tiles', () => {
  expect(src('screens/ReportsScreen.tsx').match(/<StatTile/g)?.length).toBe(4);
  expect(src('components/dashboard/DashboardTiles.tsx')).toMatch(/<StatTile/);
  expect(src('screens/ReportsScreen.tsx')).not.toMatch(/function Tile\(/);
});

it('a first load shows skeletons on these screens', () => {
  for (const f of ['ProjectDetail', 'ProjectForm', 'Projects', 'Reports', 'UserForm', 'Users']) expect(src(`screens/${f}Screen.tsx`), f).toMatch(/<SkeletonList /);
});

it('the project’s tasks show the website’s priority badge; milestones are the drawn flag', () => {
  const tasks = src('components/project/TasksTab.tsx');
  expect(tasks).toMatch(/<PriorityBadge priority=\{task\.priority\} \/>/);
  expect(tasks).not.toMatch(/priorityColor/);
  for (const f of ['components/project/TasksTab.tsx', 'components/project/OverviewTab.tsx']) expect(src(f), f).toMatch(/name="misc\.milestone"/);
});
