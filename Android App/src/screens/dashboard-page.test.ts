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
  expect(s).toMatch(/spokenValue=\{t\.value === '—' \? 'loading' : undefined\}/);
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
  expect(src('core/dashboard-queries.ts')).toMatch(/DUE_SOON_KEY = \['tasks', 'due-soon'\] as const/);
});

it('the administrators’ charts stay; their two tiles and the "Across all projects" title are the top tiles now', () => {
  const s = src('components/AdminTotals.tsx');
  expect(s).not.toMatch(/<StatTile|Across all projects/);
  expect(s).toContain('Tasks by status');
  expect(s).toContain('Project completion');
});
