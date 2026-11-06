import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIST_STATE,
  EMPTY_TAB,
  PROJECTS_TEXT,
  PROJECT_SORTS,
  STATUS_TABS,
  countLine,
  filterProjects,
  headerSummary,
  inTab,
  moreActionsLabel,
  needsAttention,
  nextDueLabel,
  ownerOptions,
  progressOf,
  showAnotherProjectTile,
  sortProjects,
  statusChangeFailed,
  tabCounts,
  targetLabel,
  targetPassed,
  teamLabel,
  updatedLabel,
  withProjectStatus,
  type ProjectListState,
} from './projects-page';
import { ARCHIVE_TEXT } from './project-status';
import { PROJECT_STATUSES, projectStatusTone } from './project-identity';
import type { ProjectOverview } from './types';
import { hasWeb, loadWebTsx, readWeb, webPath } from '../testing/web-source';
// LIST: six overview rows (testing/projects-overview-fixture.ts describes them); TODAY Fri 30 Oct 2026.
import { LIST, NOW, TODAY, TZ } from '../testing/projects-overview-fixture';

const ids = (list: readonly { id: string }[]) => list.map((p) => p.id);

/** The filters the page can be in: search words (name, code, client, number), an owner, only mine, and mixes. */
const STATES: ProjectListState[] = [
  DEFAULT_LIST_STATE,
  { ...DEFAULT_LIST_STATE, q: 'rig' },
  { ...DEFAULT_LIST_STATE, q: 'PDO 4471' },
  { ...DEFAULT_LIST_STATE, q: 'pdo' },
  { ...DEFAULT_LIST_STATE, q: '  ' },
  { ...DEFAULT_LIST_STATE, q: 'zzz' },
  { ...DEFAULT_LIST_STATE, owner: 'u1' },
  { ...DEFAULT_LIST_STATE, owner: 'u2' },
  { ...DEFAULT_LIST_STATE, mine: true },
  { ...DEFAULT_LIST_STATE, owner: 'u1', mine: true, status: 'archived' },
];

describe.skipIf(!hasWeb('frontend/src/lib/project-list.ts'))('Review Focus 5: the website’s Projects page rules', () => {
  it('same tabs, counts, filters, order and words as the website', async () => {
    const web = (await import(/* @vite-ignore */ webPath('frontend/src/lib/project-list.ts'))) as Record<string, (...a: unknown[]) => unknown> & { STATUS_TABS: unknown; PROJECT_SORTS: unknown; DEFAULT_LIST_STATE: unknown };
    expect(STATUS_TABS).toEqual(web.STATUS_TABS);
    expect(PROJECT_SORTS).toEqual(web.PROJECT_SORTS);
    // 1.23.6: the website's Projects page also takes a client from a search result (`client`); the app has no such link.
    const { client: _client, ...webDefaults } = web.DEFAULT_LIST_STATE as Record<string, unknown>;
    void _client;
    expect(DEFAULT_LIST_STATE).toEqual(webDefaults);
    for (const state of STATES) {
      expect(ids(filterProjects(LIST, state)), JSON.stringify(state)).toEqual(ids(web.filterProjects!(LIST, state) as ProjectOverview[]));
      expect(tabCounts(filterProjects(LIST, state))).toEqual(web.tabCounts!(web.filterProjects!(LIST, state)));
    }
    for (const { value } of PROJECT_SORTS) {
      expect(ids(sortProjects(LIST, value, TODAY, TZ)), value).toEqual(ids(web.sortProjects!(LIST, value, TODAY, TZ) as ProjectOverview[]));
      expect(countLine(3, value)).toBe(web.countLine!(3, value));
      expect(countLine(1, value)).toBe(web.countLine!(1, value));
    }
    expect(countLine(0, 'name')).toBe(web.countLine!(0, 'name'));
    for (const p of LIST) {
      expect(targetLabel(p, TODAY, TZ), p.id).toEqual(web.targetLabel!(p, TODAY, TZ));
      expect(progressOf(p.stats)).toEqual(web.progressOf!(p.stats));
      expect(nextDueLabel(p.stats.nextDue, TODAY)).toEqual(web.nextDueLabel!(p.stats.nextDue, TODAY));
      expect(updatedLabel(p.stats.lastActivityAt, NOW, TZ), p.id).toBe(web.updatedLabel!(p.stats.lastActivityAt, NOW, TZ));
      expect(needsAttention(p, TODAY, TZ)).toBe(web.needsAttention!(p, TODAY, TZ));
      expect(targetPassed(p, TODAY, TZ)).toBe(web.targetPassed!(p, TODAY, TZ));
      for (const { value } of STATUS_TABS) expect(inTab(p, value)).toBe(web.inTab!(p, value));
    }
    // More days and moments than the six rows hold: every Next due and Updated wording.
    for (const key of ['2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06', '2026-12-25', '2027-01-15', '2026-10-29']) expect(nextDueLabel(key, TODAY), key).toEqual(web.nextDueLabel!(key, TODAY));
    for (const iso of ['2026-10-30T07:30:00Z', '2026-10-29T19:00:00Z', '2026-10-28T08:00:00Z', '2026-10-24T08:00:00Z', '2026-10-20T08:00:00Z', 'nonsense']) expect(updatedLabel(iso, NOW, TZ), iso).toBe(web.updatedLabel!(iso, NOW, TZ));
    for (const targetDate of ['2026-10-30', '2026-10-29', '2026-10-31', '2027-02-01']) expect(targetLabel({ targetDate, status: 'ACTIVE' }, TODAY, TZ), targetDate).toEqual(web.targetLabel!({ targetDate, status: 'ACTIVE' }, TODAY, TZ));
    expect(headerSummary(LIST, TODAY, TZ)).toBe(web.headerSummary!(LIST, TODAY, TZ));
    expect(headerSummary([], TODAY, TZ)).toBe(web.headerSummary!([], TODAY, TZ));
    expect(headerSummary([LIST[1]!], TODAY, TZ)).toBe(web.headerSummary!([LIST[1]!], TODAY, TZ));
    expect(ownerOptions(LIST)).toEqual(web.ownerOptions!(LIST));
  });

  it('the page’s words are the website’s', () => {
    const w = readWeb('frontend/src/pages/ProjectsPage.tsx') + readWeb('frontend/src/components/projects/ProjectCard.tsx') + readWeb('frontend/src/components/projects/ProjectStatusMenu.tsx');
    for (const t of [...Object.values(PROJECTS_TEXT), ...Object.values(EMPTY_TAB), ARCHIVE_TEXT.body, ARCHIVE_TEXT.failed, ARCHIVE_TEXT.confirm, 'Couldn’t change the status of ', 'More actions for ', 'Archive ']) expect(w, t).toContain(t);
  });

  it('each status keeps the website’s colour (the same as on the project’s own page)', () => {
    const web = (loadWebTsx('frontend/src/components/projects/ProjectStatusMenu.tsx') as { PROJECT_STATUS_TONE: Record<string, string> }).PROJECT_STATUS_TONE;
    expect(Object.fromEntries(PROJECT_STATUSES.map((s) => [s, projectStatusTone(s)]))).toEqual(web);
  });
});

it('Review Focus 5: tab counts are the overview list counted; a status change moves one between counts, the list itself untouched', () => {
  expect(tabCounts(LIST)).toEqual({ all: 5, active: 2, planning: 1, 'on-hold': 1, completed: 1, archived: 1 });
  const after = withProjectStatus(LIST, 'p1', 'ON_HOLD');
  expect(tabCounts(after)).toMatchObject({ active: 1, 'on-hold': 2 });
  expect(LIST.find((p) => p.id === 'p1')!.status).toBe('ACTIVE');
  expect(after).not.toBe(LIST);
  expect(tabCounts(withProjectStatus(LIST, 'p1', 'ARCHIVED'))).toMatchObject({ all: 4, archived: 2 });
});

it('the filters leave the tab out, so the counts follow them; All never holds an archived project', () => {
  expect(ids(filterProjects(LIST, { ...DEFAULT_LIST_STATE, q: 'pdo', status: 'active' }))).toEqual(['p1', 'p6']);
  expect(tabCounts(filterProjects(LIST, { ...DEFAULT_LIST_STATE, owner: 'u1' }))).toEqual({ all: 2, active: 1, planning: 0, 'on-hold': 1, completed: 0, archived: 0 });
  expect(ids(LIST.filter((p) => inTab(p, 'all')))).not.toContain('p6');
});

it('the card’s words: progress, target, next due, updated, team, menu', () => {
  const [rig, ops, alpha, , gamma, delta] = LIST as [ProjectOverview, ProjectOverview, ProjectOverview, ProjectOverview, ProjectOverview, ProjectOverview];
  expect(progressOf(rig.stats)).toEqual({ pct: 63, text: '63% done · 25 of 40 tasks' });
  // 100% only once every task is done: 199 of 200 rounds to 100 but shows 99.
  expect(progressOf({ total: 200, done: 199 })).toMatchObject({ pct: 99 });
  expect(progressOf(alpha.stats)).toEqual({ pct: 0, text: 'No tasks yet' });
  expect(targetLabel(rig, TODAY, TZ)).toEqual({ text: 'Target passed 10 days ago', late: true });
  expect(targetLabel(ops, TODAY, TZ)).toEqual({ text: 'Target 15 Nov · 16 days', late: false });
  expect(targetLabel(gamma, TODAY, TZ)).toEqual({ text: 'Target 30 Sep', late: false });
  expect(targetLabel(delta, TODAY, TZ)).toEqual({ text: 'Target 1 Aug 2025', late: false });
  expect(targetLabel(alpha, TODAY, TZ)).toEqual({ text: 'No target date', late: false });
  expect(nextDueLabel('2026-10-30', TODAY)).toEqual({ short: 'Today', long: 'Today, Friday 30 October 2026' });
  expect(nextDueLabel('2026-11-02', TODAY)).toEqual({ short: 'Mon 2', long: 'Monday 2 November 2026' });
  expect(nextDueLabel('2026-11-19', TODAY).short).toBe('19 Nov');
  expect(nextDueLabel(null, TODAY)).toEqual({ short: '—', long: 'No upcoming due date' });
  expect(updatedLabel(rig.stats.lastActivityAt, NOW, TZ)).toBe('Updated 2 h ago');
  expect(updatedLabel(gamma.stats.lastActivityAt, NOW, TZ)).toBe('Updated just now');
  expect(updatedLabel(delta.stats.lastActivityAt, NOW, TZ)).toBe('Updated 1 Dec 2025');
  expect(teamLabel(rig)).toBe('Team: Ann Lee, Omar Said, Sara Ali, Zed King and 2 more');
  expect(teamLabel(ops)).toBe('Team: Omar Said, Sara Ali');
  expect(moreActionsLabel('Rig')).toBe('More actions for Rig');
  expect(statusChangeFailed('Rig')).toBe('Couldn’t change the status of Rig. Try again.');
  expect(headerSummary(LIST, TODAY, TZ)).toBe('5 projects · 2 need attention');
  expect(countLine(2, 'attention')).toBe('2 projects · most overdue first');
});

it('Needs attention: the most overdue first, then a passed target, then the nearest next due', () => {
  expect(ids(sortProjects(LIST, 'attention', TODAY, TZ))).toEqual(['p1', 'p6', 'p4', 'p2', 'p3', 'p5']);
  expect(ids(sortProjects(LIST, 'name', TODAY, TZ))).toEqual(['p3', 'p4', 'p6', 'p5', 'p2', 'p1']);
});

it('“Start another project” sits under one card (on a phone two cards hide it, as the website’s below a laptop)', () => {
  expect(showAnotherProjectTile({ filtered: false, shown: 1, tab: 'all' })).toBe(true);
  expect(showAnotherProjectTile({ filtered: false, shown: 1, tab: 'planning' })).toBe(true);
  expect(showAnotherProjectTile({ filtered: false, shown: 2, tab: 'active' })).toBe(false);
  expect(showAnotherProjectTile({ filtered: true, shown: 1, tab: 'all' })).toBe(false);
  expect(showAnotherProjectTile({ filtered: false, shown: 1, tab: 'completed' })).toBe(false);
  expect(showAnotherProjectTile({ filtered: false, shown: 0, tab: 'all' })).toBe(false);
});
