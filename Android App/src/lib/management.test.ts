/**
 * Management's rules and words (Stage 3 Lane M): a copy of the website's lib/management.ts and the
 * rules that live in its page and components, drift-tested against the website's own files.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  DEFAULT_STATUSES,
  HEALTH_SORTS,
  inspectionFigures,
  overloadedDaysText,
  ragTone,
  reasonQuery,
  sortHealth,
  ITEM_UNITS,
  chooseProjects,
  dayMonth,
  finishedText,
  idleText,
  isDefaultFilters,
  itemTarget,
  itemsFooter,
  itemsStatus,
  managementItemsKey,
  managementOverviewKey,
  managementRoot,
  managementTiles,
  metaLine,
  milestoneText,
  pdfFallbackName,
  plural,
  shortDay,
  toggleStatus,
} from './management';
import * as appModule from './management';
import type { HealthRow } from './management-api';
import { ITEMS, OVERVIEW } from '../testing/management-fixtures';

const app = appModule as unknown as Record<string, unknown>;
import { hasWeb, loadWebTs, readWeb } from '../testing/web-source';

describe.skipIf(!hasWeb('frontend/src/lib/management.ts', 'frontend/src/pages/ManagementPage.tsx', 'frontend/src/components/management/ItemsSheet.tsx'))('the website’s words', () => {
  const web = loadWebTs('frontend/src/lib/management.ts', { './due-date': 'frontend/src/lib/due-date.ts', './day-words': 'frontend/src/lib/day-words.ts' }) as unknown as typeof appModule;
  it('milestones, idle days and days agree', () => {
    for (const m of [{ due: null, daysLeft: null }, { due: 'x', daysLeft: -3 }, { due: 'x', daysLeft: 0 }, { due: 'x', daysLeft: 1 }, { due: 'x', daysLeft: 19 }, { due: 'x', daysLeft: -2, waiting: true }]) expect(milestoneText(m)).toBe(web.milestoneText(m as never));
    for (const at of ['2026-10-30T05:00:00Z', '2026-10-29T05:00:00Z', '2026-10-04T05:00:00Z']) expect(idleText(at, '2026-10-30', 'Asia/Muscat')).toBe(web.idleText(at as never, '2026-10-30' as never, 'Asia/Muscat' as never));
    expect([shortDay('2026-09-30'), dayMonth('2026-08-09')]).toEqual([web.shortDay('2026-09-30' as never), web.dayMonth('2026-08-09' as never)]);
  });
  it('the filters’ constants and the default check agree', () => {
    for (const k of ['PROJECT_STATUSES', 'DEFAULT_STATUSES', 'PERIODS', 'STATUS_LABEL', 'RAG_WORD']) expect(app[k], k).toEqual((web as unknown as Record<string, unknown>)[k]);
    for (const f of [DEFAULT_FILTERS, { ...DEFAULT_FILTERS, weeks: 4 as const }, { ...DEFAULT_FILTERS, statuses: ['ACTIVE' as const] }, { ...DEFAULT_FILTERS, ownerId: 'u1' }, { ...DEFAULT_FILTERS, statuses: ['ON_HOLD' as const, 'ACTIVE' as const, 'PLANNING' as const] }])
      expect(isDefaultFilters(f)).toBe(web.isDefaultFilters(f as never));
  });
  it('tiles, units and filter rules are the page’s', () => {
    const page = readWeb('frontend/src/pages/ManagementPage.tsx'), sheet = readWeb('frontend/src/components/management/ItemsSheet.tsx'), filters = readWeb('frontend/src/components/management/ManagementFilters.tsx');
    for (const t of managementTiles(OVERVIEW)) expect(page, t.label).toContain(`label: '${t.label}'`);
    for (const [m, [one, many]] of Object.entries(ITEM_UNITS)) expect(sheet, m).toMatch(new RegExp(`'?${m}'?: \\['${one}', '${many}'\\]`));
    expect(filters).toContain('set({ statuses: next.length ? PROJECT_STATUSES.filter((x) => next.includes(x)) : [...DEFAULT_STATUSES] });');
    // The tiles' hints and action words, and the meta line's words, as the page writes them.
    for (const w of ["hint: 'Need attention now'", "hint: 'Open and past their due day'", "hint: 'Inspections not done on time'", "hint: 'Items passed in the period'", "hint: 'From failed inspection items'", '`${plural(t.red, \'project\')} in red`', "`${plural(t.overloadedPeople, 'person', 'people')} overloaded this week`", "'The projects you run'", 'updated {clock(data.generatedAt, data.timeZone)}'])
      expect(page, w).toContain(w);
    expect(sheet).toContain('Showing the first {data.rows.length} of {data.total}.');
    expect(sheet).toContain("'Nothing here now.'");
    expect(sheet).toContain('return `Finished ${shortDay(day)}, ${time}`;');
  });
});

it('the tiles show the server’s figures and open only what has something in it', () => {
  const t = managementTiles({ ...OVERVIEW, tiles: { ...OVERVIEW.tiles, projects: 7, red: 2, amber: 1, green: 4, checksDone: 3, checksDue: 5, checksDoneLate: 1, passRate: null, missingChecks: 0 } });
  expect(t.map((x) => x.label)).toEqual(['Projects', 'In red', 'Late tasks', 'Missing checks', 'Checks done', 'Pass rate', 'Overloaded this week', 'Open follow-ups']);
  expect(t[0]).toMatchObject({ value: '7', hint: '2 red · 1 amber · 4 green', query: { metric: 'projects' } });
  expect(t[3]!.query).toBeNull(); expect(t[4]).toMatchObject({ value: '3 of 5', hint: '1 done late', query: { metric: 'checks-due' } }); expect(t[5]).toMatchObject({ value: '—', query: null });
});

it('the tiles’ action words and tones are the page’s; the people who run projects hear “the projects you run”', () => {
  const t = managementTiles(OVERVIEW);
  expect(t.map((x) => x.tone)).toEqual(['brand', 'danger', 'danger', 'warning', 'success', 'info', 'warning', 'brand']);
  expect(t.map((x) => x.action)).toEqual(['3 projects', '1 project in red', '6 late tasks in all projects', '2 missing checks', '3 of 5 checks done', '', '1 person overloaded this week', '2 open follow-ups']);
  expect(t[1]!.query).toEqual({ metric: 'projects', rag: 'RED' });
  expect(t[5]).toMatchObject({ value: '88%', hint: 'Items passed in the period', query: null });
  expect(t[6]).toMatchObject({ hint: 'Over the daily limit of 5', query: { metric: 'people-overloaded' } });
  expect(managementTiles({ ...OVERVIEW, scope: 'RUN' })[2]!.action).toBe('6 late tasks in the projects you run');
  expect(managementTiles({ ...OVERVIEW, tiles: { ...OVERVIEW.tiles, checksDoneLate: 0 } })[4]!.hint).toBe('In the period');
  expect(managementTiles({ ...OVERVIEW, tiles: { ...OVERVIEW.tiles, checksDue: 0, checksDone: 0 } })[4]!.query).toBeNull();
});

it('the line under the title: whose projects, the period and when it was worked out', () => {
  expect(metaLine(OVERVIEW)).toBe('All projects · last 12 weeks (9 Aug – 31 Oct) · updated 10:15');
  expect(metaLine({ ...OVERVIEW, scope: 'RUN' })).toBe('The projects you run · last 12 weeks (9 Aug – 31 Oct) · updated 10:15');
});

it('filters: the last status goes back to the defaults; a chosen project brings its status in', () => {
  expect(toggleStatus({ ...DEFAULT_FILTERS, statuses: ['ACTIVE'] }, 'ACTIVE').statuses).toEqual(DEFAULT_STATUSES);
  expect(chooseProjects(DEFAULT_FILTERS, ['p-arch'], [{ id: 'p-arch', status: 'ARCHIVED' } as never]).statuses).toEqual(['PLANNING', 'ACTIVE', 'ON_HOLD', 'ARCHIVED']);
});

it('filters keep the website’s order and never change the defaults themselves', () => {
  expect(toggleStatus(DEFAULT_FILTERS, 'ARCHIVED').statuses).toEqual(['PLANNING', 'ACTIVE', 'ON_HOLD', 'ARCHIVED']);
  expect(toggleStatus({ ...DEFAULT_FILTERS, statuses: ['ARCHIVED'] }, 'PLANNING').statuses).toEqual(['PLANNING', 'ARCHIVED']);
  expect(chooseProjects(DEFAULT_FILTERS, ['p-red'], OVERVIEW.options.projects)).toEqual({ ...DEFAULT_FILTERS, projectIds: ['p-red'] });
  expect(DEFAULT_FILTERS.statuses).toEqual(['PLANNING', 'ACTIVE', 'ON_HOLD']);
  expect(DEFAULT_FILTERS.statuses).not.toBe(DEFAULT_STATUSES);
});

it('list rows open the app’s screens; anything unknown opens nothing', () => {
  expect(itemTarget({ kind: 'task', id: 't1', title: 'x' })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1', title: 'x' } });
  expect(itemTarget({ kind: 'action', id: 'a1', title: 'x', meetingId: 'm1' })).toMatchObject({ screen: 'MeetingDetail', params: { meetingId: 'm1' } });
  expect(itemTarget({ kind: 'day', id: 'd', title: 'x', tasks: [] })).toBe('expand'); expect(itemTarget({ kind: 'inspection', id: 'i1', title: 'x' })).toBeNull();
  expect(itemTarget({ kind: 'task', id: '../x', title: 'x' })).toBeNull();
});

it('every kind of row: a project, a person, an action with only a task, an inspection with its task', () => {
  expect(itemTarget({ kind: 'project', id: 'p-amber', title: 'Slab pour' })).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p-amber', projectName: 'Slab pour' } });
  expect(itemTarget({ kind: 'person', id: 'u2', title: 'Omar Said' })).toEqual({ type: 'stack', screen: 'Workload' });
  expect(itemTarget({ kind: 'action', id: 'a2', title: 'x', taskId: 't7' })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't7' } });
  expect(itemTarget({ kind: 'action', id: 'a3', title: 'x' })).toBeNull();
  expect(itemTarget({ kind: 'action', id: 'a4', title: 'x', meetingId: 'm/1', taskId: 't7' })).toBeNull();
  expect(itemTarget({ kind: 'inspection', id: 'ins1', title: 'x', taskId: 't9' })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't9' } });
  expect(itemTarget({ kind: 'project', id: 'p 1', title: 'x' })).toBeNull();
});

it('the list sheet’s status line, footer and finished time', () => {
  expect(itemsStatus(ITEMS)).toBe('240 tasks');
  expect(itemsStatus({ ...ITEMS, metric: 'people-overloaded', total: 1 })).toBe('1 person');
  expect(itemsStatus({ ...ITEMS, total: 0, rows: [] })).toBe('Nothing here now.');
  expect(itemsStatus(undefined)).toBe('Loading…');
  expect(itemsStatus(undefined, false)).toBe('');
  expect(itemsFooter(ITEMS)).toBe('Showing the first 6 of 240.');
  expect(itemsFooter({ ...ITEMS, total: 6 })).toBeNull();
  expect(itemsFooter(undefined)).toBeNull();
  expect(finishedText('2026-10-21T08:00:00Z', 'Asia/Muscat')).toBe('Finished Wed 21 Oct, 12:00');
  expect(finishedText('2026-10-21T21:30:00Z', 'Asia/Muscat')).toBe('Finished Thu 22 Oct, 01:30');
});

it('the PDF’s name when the server gives none, and plural words', () => {
  expect(pdfFallbackName('2026-10-30')).toBe('management-overview-2026-10-30.pdf');
  expect([plural(1, 'day'), plural(3, 'day'), plural(2, 'person', 'people')]).toEqual(['1 day', '3 days', '2 people']);
});

it('keeps each person’s figures and lists apart', () => {
  expect(managementRoot('u1')).toEqual(['management', 'u1']);
  expect(managementOverviewKey('u1', DEFAULT_FILTERS)).not.toEqual(managementOverviewKey('u2', DEFAULT_FILTERS));
  expect(managementOverviewKey('u1', DEFAULT_FILTERS).slice(0, 2)).toEqual(managementRoot('u1'));
  expect(managementOverviewKey('u1', DEFAULT_FILTERS)).not.toEqual(managementOverviewKey('u1', { ...DEFAULT_FILTERS, weeks: 4 }));
  const q = { metric: 'late-tasks', projectId: 'p1' } as const;
  expect(managementItemsKey('u1', DEFAULT_FILTERS, q).slice(0, 2)).toEqual(managementRoot('u1'));
  expect(managementItemsKey('u1', DEFAULT_FILTERS, q)).not.toEqual(managementItemsKey('u2', DEFAULT_FILTERS, q));
  expect(managementItemsKey('u1', DEFAULT_FILTERS, q)).not.toEqual(managementItemsKey('u1', DEFAULT_FILTERS, { metric: 'late-tasks' }));
});

// ── Task 8: the sections' rules ──
it('health sorts as the website’s table; worst first is the server’s order', () => {
  const rows = [{ name: 'B', late: 1, completionPct: 50 }, { name: 'A', late: 3, completionPct: 80 }, { name: 'C', late: 3, completionPct: 10 }] as HealthRow[];
  expect(sortHealth(rows, 'worst')).toBe(rows); expect(sortHealth(rows, 'late').map((r) => r.name)).toEqual(['A', 'C', 'B']); expect(sortHealth(rows, 'done').map((r) => r.name)).toEqual(['C', 'B', 'A']);
  if (hasWeb('frontend/src/components/management/HealthSection.tsx')) expect(readWeb('frontend/src/components/management/HealthSection.tsx')).toContain("if (sort === 'late') return copy.sort((a, b) => b.late - a.late || collator.compare(a.name, b.name));");
});
it('health sorts by name the website’s way (numbers in order, case and accents alike), never changing the server’s list', () => {
  const rows = [{ name: 'Rig 10' }, { name: 'rig 9' }, { name: 'Álpha' }, { name: 'alpha 2' }] as HealthRow[];
  expect(sortHealth(rows, 'name').map((r) => r.name)).toEqual(['Álpha', 'alpha 2', 'rig 9', 'Rig 10']);
  expect(rows.map((r) => r.name)).toEqual(['Rig 10', 'rig 9', 'Álpha', 'alpha 2']);
  expect(HEALTH_SORTS).toEqual([{ value: 'worst', label: 'Worst first' }, { value: 'late', label: 'Most late tasks' }, { value: 'done', label: 'Least done' }, { value: 'name', label: 'Name' }]);
  expect([ragTone('RED'), ragTone('AMBER'), ragTone('GREEN')]).toEqual(['danger', 'warning', 'success']);
});
it('reasons open their lists; the inspection figures are the website’s', () => {
  expect(reasonQuery('MANY_LATE', 'p1')).toEqual({ metric: 'late-tasks', projectId: 'p1' }); expect(reasonQuery('NO_ACTIVITY', 'p1')).toBeNull();
  const f = inspectionFigures({ ...OVERVIEW.inspections, due: 8, done: 6, passRate: null });
  expect(f.find((x) => x.label === 'Done')).toMatchObject({ value: '6', help: '75% of those due', query: { metric: 'checks-done' } });
  expect(f.find((x) => x.label === 'Pass rate')).toMatchObject({ value: '—', query: null });
  expect(overloadedDaysText([{ date: '2026-10-28', count: 7, limit: 5 }, { date: '2026-10-29', count: 6, limit: 5 }])).toBe('Wed 28 Oct (7), Thu 29 Oct (6)');
});
it('every reason code and inspection figure, in the website’s order, opening nothing at 0', () => {
  expect(reasonQuery('MILESTONE_LATE', 'p1')).toEqual({ metric: 'late-milestones', projectId: 'p1' });
  expect(reasonQuery('LATE_TASKS', 'p1')).toEqual({ metric: 'late-tasks', projectId: 'p1' });
  for (const code of ['MANY_MISSING_CHECKS', 'MISSING_CHECKS'] as const) expect(reasonQuery(code, 'p1')).toEqual({ metric: 'missing-checks', projectId: 'p1' });
  expect(reasonQuery('ON_TRACK', 'p1')).toBeNull();
  const f = inspectionFigures(OVERVIEW.inspections);
  expect(f.map((x) => x.label)).toEqual(['Checks due', 'Done', 'Done late', 'Missing now', 'Closed without a report', 'Inspections finished', 'Pass rate', 'Open follow-ups']);
  expect(f.map((x) => x.tone)).toEqual(['neutral', 'neutral', 'warning', 'danger', 'warning', 'neutral', 'neutral', 'neutral']);
  expect(f.map((x) => x.value)).toEqual(['5', '3', '1', '2', '1', '4', '88%', '2']);
  expect(f.map((x) => x.help)).toEqual([null, '60% of those due', null, null, null, '22 items passed · 3 failed', 'Items passed of those passed or failed', null]);
  expect(f.map((x) => x.query?.metric ?? null)).toEqual(['checks-due', 'checks-done', 'checks-done-late', 'missing-checks', 'checks-no-report', 'inspections', null, 'follow-ups']);
  expect(f.map((x) => x.action)).toEqual(['5 checks due in the period', '3 checks done', '1 check done late', '2 missing checks', '1 check closed without a report', '4 inspections finished in the period', '', '2 open follow-up tasks']);
  const none = inspectionFigures({ ...OVERVIEW.inspections, due: 0, done: 0, noReport: 0, passRate: null });
  expect(none.find((x) => x.label === 'Done')).toMatchObject({ value: '0', help: null, query: null });
  expect(none.find((x) => x.label === 'Checks due')!.query).toBeNull();
  expect(none.find((x) => x.label === 'Closed without a report')!.query).toBeNull();
  expect(none.find((x) => x.label === 'Inspections finished')!.help).toBe('No items passed or failed yet');
  expect(overloadedDaysText([])).toBe('');
});
describe.skipIf(!hasWeb('frontend/src/components/management/InspectionsSection.tsx'))('the inspection figures’ words', () => {
  it('are the section’s labels, help and list names', () => {
    const w = readWeb('frontend/src/components/management/InspectionsSection.tsx');
    for (const x of inspectionFigures(OVERVIEW.inspections)) expect(w, x.label).toContain(`label="${x.label}"`);
    for (const t of ['% of those due', 'No items passed or failed yet', 'items passed · ${data.failed} failed', 'help="Items passed of those passed or failed"', "'check')} due in the period", "'check')} closed without a report", "'inspection')} finished in the period", "'open follow-up task'"]) expect(w, t).toContain(t);
  });
});
