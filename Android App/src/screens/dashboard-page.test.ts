import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** The Dashboard as the website's (Stage 2 Task 9), checked by source text. */

it('the page in the website’s order', () => {
  const s = src('screens/DashboardScreen.tsx');
  const at = (m: string) => s.indexOf(m);
  for (const m of ['<WelcomeBand', '<DashboardTiles', '<FirstSteps', '<AdminTotals', '<OpenTasksCard', '<ApprovalsCard', '<DueSoonCard', '<RecentActivityCard']) expect(at(m), m).toBeGreaterThan(-1);
  expect(at('<WelcomeBand')).toBeLessThan(at('<DashboardTiles'));
  expect(at('<DashboardTiles')).toBeLessThan(at('<ApprovalsCard'));
  expect(at('<ApprovalsCard')).toBeLessThan(at('<DueSoonCard'));
  expect(at('<DueSoonCard')).toBeLessThan(at('<RecentActivityCard'));
  // Day one: the first steps instead of the charts and lists.
  expect(s).toMatch(/firstDay \? \(?\s*<FirstSteps[^]*?\) : \(/);
  expect(at('<AdminTotals')).toBeLessThan(at('<OpenTasksCard'));
  expect(s).toMatch(/admin \? <AdminTotals[^]*?:\s*\(?\s*<OpenTasksCard/);
});

it('employee counts use the company’s zone and week start', () => expect(src('screens/DashboardScreen.tsx')).toMatch(/myDueCounts\([^)]*timeZone: zones\.company, weekStart: zones\.companyWeekStart/));

it('"Review all" opens To approve', () => expect(src('components/dashboard/ApprovalsCard.tsx')).toMatch(/show: 'to-approve'/));

it('the tiles: two to a row while every label fits, each opening its page', () => {
  const s = src('components/dashboard/DashboardTiles.tsx');
  expect(s).toMatch(/statTileColumns\(tiles\.map\(\(t\) => t\.label\), width, fontScale\)/);
  expect(s).toMatch(/tiles\.map\(/);
  expect(s).toMatch(/<StatTile/);
  expect(s).toMatch(/spokenValue=\{t\.failed \? TILE_FAILED\.spoken : t\.value === '—' \? 'loading' : undefined\}/);
  // A tile opens its tab (My Tasks, Projects) or Reports.
  expect(src('screens/DashboardScreen.tsx')).toMatch(/onOpen=\{openTile\}/);
  expect(src('screens/DashboardScreen.tsx')).toMatch(/'tab' in to/);
});

it('the welcome band: the brand gradient, the greeting as the page’s header, the two ways in', () => {
  const s = src('components/dashboard/WelcomeBand.tsx');
  expect(s).toMatch(/<LinearGradient colors=\{BRAND_GRADIENT\.colors\}/);
  expect(s).toMatch(/shadow\.brand/);
  expect(s).toMatch(/accessibilityRole="header"/);
  expect(s).toMatch(/showLinks \?/);
  expect(s).toContain('DASHBOARD_TEXT.openBoard');
  expect(s).toContain('DASHBOARD_TEXT.viewMyTasks');
  expect(s).toMatch(/minHeight: 44/);
  const screen = src('screens/DashboardScreen.tsx');
  expect(screen).toMatch(/onOpenBoard=\{\(\) => navigation\.navigate\('AllBoard'\)\}/);
  expect(screen).toMatch(/onViewMyTasks=\{\(\) => navigation\.navigate\('MyTasks'\)\}/);
});

it('first steps: Create a project for everyone, Add your team for administrators', () => {
  const s = src('components/dashboard/FirstSteps.tsx');
  expect(s).toMatch(/icon="misc\.flag"/);
  expect(s).toContain('FIRST_STEPS_TEXT.createProject');
  expect(s).toMatch(/isAdmin \? <Button[^>]*FIRST_STEPS_TEXT\.addTeam/);
  const screen = src('screens/DashboardScreen.tsx');
  expect(screen).toMatch(/onCreateProject=\{\(\) => navigation\.navigate\('ProjectForm'\)\}/);
  expect(screen).toMatch(/onAddTeam=\{\(\) => navigation\.navigate\('UserForm'\)\}/);
});

it('the cards’ links: View all → My Tasks and Activity, Calendar; Due soon reads the open tasks by due day', () => {
  expect(src('components/dashboard/OpenTasksCard.tsx')).toMatch(/\.slice\(0, 8\)/);
  expect(src('components/dashboard/OpenTasksCard.tsx')).toMatch(/<TaskRow /);
  expect(src('components/dashboard/DueSoonCard.tsx')).toMatch(/<ApprovalChip/);
  const screen = src('screens/DashboardScreen.tsx');
  expect(screen).toMatch(/<DueSoonCard[^]*?onCalendar=\{\(\) => navigation\.navigate\('Calendar'\)\}/);
  expect(screen).toMatch(/<RecentActivityCard[^]*?onViewAll=\{\(\) => navigation\.navigate\('Activity'\)\}/);
  expect(src('core/dashboard-queries.ts')).toMatch(/reads\.read\(queryKey, 'tasks\.due-soon', \(\) => resources\.tasks\.list\(\{ category: 'BACKLOG,TODO,IN_PROGRESS,BLOCKED,REVIEW', sort: 'dueDate', order: 'asc', limit: 20 \}\)\)/);
  expect(src('lib/refresh.ts')).toMatch(/DUE_SOON_KEY = \['tasks', 'due-soon'\] as const/);
});

it('the administrators’ charts stay; their two tiles and the "Across all projects" title are the top tiles now', () => {
  const s = src('components/AdminTotals.tsx');
  expect(s).not.toMatch(/<StatTile|Across all projects/);
  expect(s).toContain('Tasks by status');
  expect(s).toContain('Project completion');
});

// Stage 2 fix pass B2: back on the Dashboard after a task changed elsewhere, its cards are read again —
// once per coming into view, only what it shows, out of date and not being read (core/focus-refetch).
it('B2: the Dashboard reads Due soon, the activity and the administrators’ totals again as it comes into view', () => {
  const s = src('screens/DashboardScreen.tsx');
  expect(s).toMatch(/import \{ useRefetchOnFocus \} from '\.\.\/core\/focus-refetch';/);
  for (const m of ['useRefetchOnFocus(adminQ, admin);', 'useRefetchOnFocus(activityQ);', 'useRefetchOnFocus(dueSoonQ);']) expect(s, m).toContain(m);
  // One key for Due soon: the lists that refresh it (lib) and the query (core) use the same.
  expect(src('core/dashboard-queries.ts')).toMatch(/import \{ DUE_SOON_KEY \} from '\.\.\/lib\/refresh';/);
  expect(src('core/dashboard-queries.ts')).toMatch(/export \{ DUE_SOON_KEY \};/);
});

// Stage 2 fix pass B9: the tiles say a figure couldn't load (visible, and to TalkBack) and offer Retry;
// the screen tells them which lists failed with nothing kept, and Retry reads those again.
it('B9: tiles that couldn’t load say so, with a Retry under them', () => {
  const tiles = src('components/dashboard/DashboardTiles.tsx');
  expect(tiles).toMatch(/tiles\.some\(\(t\) => t\.failed\) \? <ErrorNote message=\{TILE_FAILED\.note\} onRetry=\{onRetry\} retrying=\{retrying\} \/> : null/);
  const screen = src('screens/DashboardScreen.tsx');
  expect(screen).toMatch(/failed: \{ myTasks: myTasksQ\.isError && !myTasksQ\.data, projects: projectsQ\.isError && !projectsQ\.data, reports: admin && adminQ\.isError && !adminQ\.data \}/);
  expect(screen).toMatch(/<DashboardTiles tiles=\{tiles\} onOpen=\{openTile\} onRetry=\{retryTiles\} retrying=\{/);
  // One Retry for the totals: the charts below no longer repeat it.
  expect(src('components/AdminTotals.tsx')).not.toMatch(/<ErrorNote/);
});
