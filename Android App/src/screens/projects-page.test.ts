import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** Projects as the website's page (Stage 2 Task 10), checked by source text. */

it('Projects reads /projects/overview through the offline copy', () => expect(src('core/project-queries.ts')).toMatch(/queryKey: PROJECTS_OVERVIEW_KEY[^]*reads\.read\(queryKey, PROJECTS_OVERVIEW_COPY, \(\) => resources\.projects\.overview\(\)\)/));

it('tab counts follow the filters, and the cards the tab', () => {
  const s = src('screens/ProjectsScreen.tsx');
  expect(s).toMatch(/tabCounts\(filterProjects\(/);
  expect(s).toMatch(/sortProjects\(filterProjects\([^]*inTab/);
});

it('a status change goes through changeProjectStatus', () => expect(src('core/project-queries.ts')).toMatch(/changeProjectStatus\(qc,/));

it('the old per-task figures are gone: one request for the whole list', () => {
  expect(src('core/project-queries.ts')).not.toMatch(/useProjectCardFigures|projectCardFigures|resources\.tasks\.list/);
  expect(src('screens/ProjectsScreen.tsx')).toMatch(/useProjectsOverview\(\)/);
  expect(src('screens/ProjectsScreen.tsx')).not.toMatch(/useProjects\(\)|useProjectCardFigures|Board: all projects/);
});

it('the page: header summary and New project, first run, status tabs, search, owner, sort, only mine for administrators', () => {
  const s = src('screens/ProjectsScreen.tsx');
  expect(s).toMatch(/<PageHeader\s+title="Projects"\s+subtitle=\{summary\}/);
  expect(s).toMatch(/headerSummary\(all, today, timeZone\)/);
  expect(s).toMatch(/canCreateProject\(user\) \?/);
  expect(s).toMatch(/firstRun \? \(\s*<EmptyState/);
  expect(s).toMatch(/accessibilityLabel=\{PROJECTS_TEXT\.tabs\}/);
  expect(s).toMatch(/STATUS_TABS\.map\(/);
  expect(s).toMatch(/<Chip[^]*?count=\{loaded \? counts\[t\.value\] : undefined\}/);
  expect(s).toMatch(/<TextField[^]*?placeholder=\{PROJECTS_TEXT\.search\}[^]*?accessibilityLabel=\{PROJECTS_TEXT\.searchLabel\}/);
  expect(s).toMatch(/<ChoiceSheet[^]*?title=\{PROJECTS_TEXT\.owner\}/);
  expect(s).toMatch(/<ChoiceSheet[^]*?title=\{PROJECTS_TEXT\.sort\}/);
  expect(s).toMatch(/admin \? <Toggle[^]*?label=\{PROJECTS_TEXT\.onlyMine\}/);
  expect(s).toMatch(/countLine\(visible\.length, state\.sort\)/);
  expect(s).toMatch(/showAnotherProjectTile\(/);
  expect(s).toMatch(/EMPTY_TAB\[state\.status\]/);
  expect(s).toMatch(/canManageProject\(user, item\)/);
});

it('the card: colour strip, large picture, the status menu or a plain badge, ⋯, progress in the project colour, three figures, team, owner, target', () => {
  const s = src('components/projects/ProjectCard.tsx');
  expect(s).toMatch(/<ProjectAvatar project=\{p\} size="lg" \/>/);
  expect(s).toMatch(/canChange \?[^]*?onStatus[^]*?: \(\s*<Badge label=\{statusLabel\} tone=\{tone\} dot \/>/);
  expect(s).toMatch(/<IconButton icon="misc\.dots" label=\{moreActionsLabel\(p\.name\)\}/);
  expect(s).toMatch(/<ProgressBar[^>]*color=\{color\}/);
  expect(s).toMatch(/const color = p\.color && HEX_COLOR\.test\(p\.color\) \? p\.color : DEFAULT_PROJECT_COLOR;/);
  for (const m of ['PROJECTS_TEXT.open', 'PROJECTS_TEXT.overdue', 'PROJECTS_TEXT.nextDue', 'teamLabel(p)', 'PROJECTS_TEXT.noOwner', 'targetLabel(', 'updatedLabel(', 'progressOf(', 'nextDueLabel(']) expect(s, m).toContain(m);
  expect(s).toMatch(/late=\{p\.stats\.overdue > 0\}/);
  expect(s).toMatch(/color: late \? c\.dangerText : c\.ink/);
  expect(s).toMatch(/target\.late \? c\.dangerText/);
  expect(s).toMatch(/size="sm"/);
});

it('the card’s ⋯: Edit and Archive… only for whoever may change it, Open board for everyone', () => {
  const s = src('components/projects/ProjectCard.tsx');
  expect(s).toMatch(/canChange \? \[\{ value: 'edit', label: PROJECTS_TEXT\.edit \}\] : \[\]/);
  expect(s).toMatch(/\{ value: 'board', label: PROJECTS_TEXT\.openBoard \}/);
  expect(s).toMatch(/canChange && p\.status !== 'ARCHIVED' \? \[\{ value: 'archive', label: PROJECTS_TEXT\.archive \}\] : \[\]/);
});

it('the status sheet ticks the current status; Archived asks first', () => {
  expect(src('components/projects/ProjectStatusSheet.tsx')).toMatch(/PROJECT_STATUSES\.map\(/);
  expect(src('components/projects/ProjectStatusSheet.tsx')).toMatch(/<ChoiceSheet/);
  const screen = src('screens/ProjectsScreen.tsx');
  expect(screen).toMatch(/if \(status === 'ARCHIVED'\) openArchive\(project\);/);
  expect(screen).toMatch(/const openArchive = \(project: ProjectOverview\) => \{\s*setArchiveError\(null\);\s*setArchiving\(project\);/);
  expect(src('components/projects/ArchiveProjectSheet.tsx')).toMatch(/ARCHIVE_TEXT\.title\(project\.name\)/);
  expect(src('components/projects/ArchiveProjectSheet.tsx')).toMatch(/confirm=\{ARCHIVE_TEXT\.confirm\}/);
});

// Stage 2 fix pass B1: a failing list was read again in a loop (the focus effect re-ran on every
// isFetching flip). It is read once per coming into view, only when shown, stale and not loading.
it('B1: the list is read again once each time the tab comes into view, never in a loop', () => {
  const s = src('screens/ProjectsScreen.tsx');
  expect(s).toMatch(/useRefetchOnFocus\(query\);/);
  expect(s).not.toMatch(/useFocusEffect/);
});

it('B1: no screen’s focus effect re-runs on isStale or isFetching', async () => {
  const { appSources } = await import('../testing/web-source');
  const looping = appSources()
    .filter(([, text]) => text.includes('useFocusEffect('))
    .flatMap(([file, text]) => [...text.matchAll(/useFocusEffect\(\s*useCallback\([^]*?\},\s*\[([^\]]*)\]/g)].filter((m) => /\b(isStale|isFetching)\b/.test(m[1]!)).map(() => file));
  expect(looping).toEqual([]);
});

// Stage 2 fix pass B6: a list the offline copy answered is out of date at once (as every list's
// default, lib/query-client), not fresh for a minute — so it is read again when the signal is back.
it('B6: the overview is fresh for a minute only when the server answered it', () => {
  expect(src('core/project-queries.ts')).toMatch(/queryKey: PROJECTS_OVERVIEW_KEY,[^]*?staleTime: \(q\) => \(reads\.answeredFromCopy\(q\) \? 0 : 60_000\)/);
});
