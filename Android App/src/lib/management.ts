/**
 * Management's rules and words (Stage 3 Lane M): a copy of the website's lib/management.ts (without
 * its address functions — the phone keeps the filters on the screen), plus the rules that live in
 * the website's ManagementPage.tsx, ManagementFilters.tsx and ItemsSheet.tsx. Drift-tested against
 * those files. Every figure is the server's: nothing here recounts one.
 */
import type { HealthRow, ItemList, ItemMetric, ItemQuery, ItemRow, ManagementFilters, ManagementOverview, OptionProject, PersonRow, ProjectStatus, Rag, RagReason, TrendRow } from './management-api';
import { managementQuery } from './management-api';
import { askedWeek } from './workload';
import type { NavAction } from '../navigation/nav-actions';
import { isSafeId } from './ids';
import { ApiError } from './api-client';
import { zonedDayKey } from './due-date';
import { clockText, dayText } from './day-words';

export const PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const DEFAULT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD'];
export const PERIODS = [4, 12, 26] as const;
export const STATUS_LABEL: Record<ProjectStatus, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
export const RAG_WORD: Record<Rag, string> = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green' };

/** Every project, anyone, the statuses still going, 12 weeks. */
export const DEFAULT_FILTERS: ManagementFilters = { projectIds: [], ownerId: null, statuses: [...DEFAULT_STATUSES], weeks: 12 };

const sameStatuses = (a: ProjectStatus[], b: ProjectStatus[]) => a.length === b.length && a.every((s) => b.includes(s));

export const isDefaultFilters = (f: ManagementFilters) => f.projectIds.length === 0 && !f.ownerId && sameStatuses(f.statuses, DEFAULT_STATUSES) && f.weeks === 12;

/** "1 day", "3 days", "2 people" (components/management/parts.tsx). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 days late", "Due today", "Due tomorrow", "In 19 days", "No date" — or "Waiting for approval" (never late while it waits). */
export function milestoneText(m: { due: string | null; daysLeft: number | null; waiting?: boolean }): string {
  if (m.waiting) return 'Waiting for approval';
  if (!m.due || m.daysLeft === null) return 'No date';
  if (m.daysLeft < 0) return `${plural(-m.daysLeft, 'day')} late`;
  if (m.daysLeft === 0) return 'Due today';
  if (m.daysLeft === 1) return 'Due tomorrow';
  return `In ${m.daysLeft} days`;
}

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
/** "Today", "Yesterday", "26 days ago" — company days. */
export function idleText(at: string, today: string, timeZone: string): string {
  const days = Math.round((noon(today) - noon(zonedDayKey(new Date(at), timeZone))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** "Wed 28 Oct" for a 'YYYY-MM-DD' day ("Wed 30 Sep", never "Sept"). */
export const shortDay = (key: string) => dayText(key, { weekday: 'short', year: false });
/** "9 Aug" for a 'YYYY-MM-DD' day. */
export const dayMonth = (key: string) => dayText(key, { year: false });

/** A status ticked or unticked (ManagementFilters.tsx): at least one — taking the last one away goes back to the projects still going. */
export function toggleStatus(f: ManagementFilters, s: ProjectStatus): ManagementFilters {
  const next = f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s];
  return { ...f, statuses: next.length ? PROJECT_STATUSES.filter((x) => next.includes(x)) : [...DEFAULT_STATUSES] };
}

/** The projects chosen (ManagementFilters.tsx): one whose status the filter leaves out brings its status in, so it shows. */
export function chooseProjects(f: ManagementFilters, ids: string[], options: Pick<OptionProject, 'id' | 'status'>[]): ManagementFilters {
  const add = options.filter((p) => ids.includes(p.id) && !f.statuses.includes(p.status)).map((p) => p.status);
  return { ...f, projectIds: ids, statuses: add.length ? PROJECT_STATUSES.filter((s) => f.statuses.includes(s) || add.includes(s)) : f.statuses };
}

/** "All projects · last 12 weeks (9 Aug – 31 Oct) · updated 10:15" (the company's clock). */
export function metaLine(o: ManagementOverview): string {
  const whose = o.scope === 'ALL' ? 'All projects' : 'The projects you run';
  return `${whose} · last ${o.period.weeks} weeks (${dayMonth(o.period.from)} – ${dayMonth(o.period.to)}) · updated ${clockText(o.generatedAt, o.timeZone)}`;
}

export interface ManagementTile {
  label: string;
  value: string;
  hint: string;
  tone: 'brand' | 'success' | 'warning' | 'info' | 'danger';
  /** The list behind it — null when there is nothing in it (and always for the pass rate, a percentage). */
  query: ItemQuery | null;
  /** What it counts, in words ("6 late tasks in all projects"): the list's name. */
  action: string;
}

/** The 8 tiles' labels, in order: what the screen's grid measures (lib/stat-grid statTileColumns). */
export const MANAGEMENT_TILE_LABELS = ['Projects', 'In red', 'Late tasks', 'Missing checks', 'Checks done', 'Pass rate', 'Overloaded this week', 'Open follow-ups'] as const;

/** The page's 8 tiles (ManagementPage.tsx), the server's figures as sent. */
export function managementTiles(o: ManagementOverview): ManagementTile[] {
  const t = o.tiles;
  const scopeWords = o.scope === 'RUN' ? 'the projects you run' : 'all projects';
  const tile = (x: Omit<ManagementTile, 'query' | 'value'> & { value: number | string; query: ItemQuery | null; count: number }): ManagementTile => ({
    label: x.label,
    value: String(x.value),
    hint: x.hint,
    tone: x.tone,
    query: x.query && x.count > 0 ? x.query : null,
    action: x.action,
  });
  return [
    tile({ label: 'Projects', value: t.projects, hint: `${t.red} red · ${t.amber} amber · ${t.green} green`, tone: 'brand', query: { metric: 'projects' }, count: t.projects, action: plural(t.projects, 'project') }),
    tile({ label: 'In red', value: t.red, hint: 'Need attention now', tone: 'danger', query: { metric: 'projects', rag: 'RED' }, count: t.red, action: `${plural(t.red, 'project')} in red` }),
    tile({ label: 'Late tasks', value: t.lateTasks, hint: 'Open and past their due day', tone: 'danger', query: { metric: 'late-tasks' }, count: t.lateTasks, action: `${plural(t.lateTasks, 'late task')} in ${scopeWords}` }),
    tile({ label: 'Missing checks', value: t.missingChecks, hint: 'Inspections not done on time', tone: 'warning', query: { metric: 'missing-checks' }, count: t.missingChecks, action: plural(t.missingChecks, 'missing check') }),
    tile({ label: 'Checks done', value: `${t.checksDone} of ${t.checksDue}`, hint: t.checksDoneLate ? `${t.checksDoneLate} done late` : 'In the period', tone: 'success', query: { metric: 'checks-due' }, count: t.checksDue, action: `${t.checksDone} of ${plural(t.checksDue, 'check')} done` }),
    // A percentage, not a list: shown, never opened.
    tile({ label: 'Pass rate', value: t.passRate === null ? '—' : `${t.passRate}%`, hint: 'Items passed in the period', tone: 'info', query: null, count: 0, action: '' }),
    tile({ label: 'Overloaded this week', value: t.overloadedPeople, hint: `Over the daily limit of ${o.workload.limit}`, tone: 'warning', query: { metric: 'people-overloaded' }, count: t.overloadedPeople, action: `${plural(t.overloadedPeople, 'person', 'people')} overloaded this week` }),
    tile({ label: 'Open follow-ups', value: t.openFollowUps, hint: 'From failed inspection items', tone: 'brand', query: { metric: 'follow-ups' }, count: t.openFollowUps, action: plural(t.openFollowUps, 'open follow-up') }),
  ];
}

/** What a list counts, in words ("4 tasks", "1 day") — ItemsSheet.tsx's UNIT. */
export const ITEM_UNITS: Record<ItemMetric, readonly [string, string]> = {
  'late-tasks': ['task', 'tasks'],
  'late-milestones': ['milestone', 'milestones'],
  'missing-checks': ['check', 'checks'],
  'checks-due': ['check', 'checks'],
  'checks-done': ['check', 'checks'],
  'checks-done-late': ['check', 'checks'],
  'checks-no-report': ['check', 'checks'],
  'follow-ups': ['task', 'tasks'],
  inspections: ['inspection', 'inspections'],
  'failed-item': ['inspection', 'inspections'],
  'failed-form': ['failed item', 'failed items'],
  'person-overloaded': ['day', 'days'],
  'person-actions': ['action item', 'action items'],
  'overdue-actions': ['action item', 'action items'],
  projects: ['project', 'projects'],
  'people-overloaded': ['person', 'people'],
  'awaiting-approval': ['task', 'tasks'],
};

/** The list sheet's status line: "240 tasks", "Nothing here now." — or "Loading…" while it is on its way ('' when it isn't, e.g. it failed). */
export function itemsStatus(l: ItemList | undefined, loading = true): string {
  if (!l) return loading ? 'Loading…' : '';
  if (!l.total) return 'Nothing here now.';
  const unit = ITEM_UNITS[l.metric] ?? ['item', 'items'];
  return `${l.total} ${l.total === 1 ? unit[0] : unit[1]}`;
}

/** "Showing the first 200 of 240." when the server sent fewer rows than it counted. */
export function itemsFooter(l: ItemList | undefined): string | null {
  return l && l.total > l.rows.length ? `Showing the first ${l.rows.length} of ${l.total}.` : null;
}

/** "Finished Wed 21 Oct, 12:00" in the company time zone. */
export function finishedText(at: string, timeZone: string): string {
  return `Finished ${shortDay(zonedDayKey(new Date(at), timeZone))}, ${clockText(at, timeZone)}`;
}

/**
 * Where a row of a list opens on the phone (ItemsSheet.tsx): a task its task, a project its project,
 * a person the Workload screen; an overloaded day lists its tasks in place ('expand'); a meeting's
 * action item its meeting (or its task); an inspection its check task for now (Stage 4 opens the
 * inspection itself). An id that isn't one of the server's opens nothing.
 */
export function itemTarget(row: ItemRow, workloadWeek?: string): NavAction | 'expand' | null {
  const task = (id: string | null | undefined, title?: string): NavAction | null =>
    isSafeId(id) ? { type: 'stack', screen: 'TaskDetail', params: title === undefined ? { taskId: id } : { taskId: id, title } } : null;
  switch (row.kind) {
    case 'task':
      return task(row.id, row.title);
    case 'project':
      return isSafeId(row.id) ? { type: 'stack', screen: 'ProjectDetail', params: { projectId: row.id, projectName: row.title } } : null;
    case 'person': {
      // The week Management counted (the overview's company week), as the website's /workload?week=.
      const week = askedWeek(workloadWeek);
      return week ? { type: 'stack', screen: 'Workload', params: { week } } : { type: 'stack', screen: 'Workload' };
    }
    case 'day':
      return 'expand';
    case 'inspection':
      return task(row.taskId);
    case 'action':
    default:
      if (row.meetingId) return isSafeId(row.meetingId) ? { type: 'stack', screen: 'MeetingDetail', params: { meetingId: row.meetingId } } : null;
      return task(row.taskId);
  }
}

/** The PDF's name when the server gives none. */
export const pdfFallbackName = (today: string) => `management-overview-${today}.pdf`;

/** Everything Management keeps, per person (sign-out's cache clear drops it all; a 403 removes it). */
export const managementRoot = (userId: string) => ['management', userId] as const;
export const managementOverviewKey = (userId: string, f: ManagementFilters) => [...managementRoot(userId), 'overview', managementQuery(f)] as const;
export const managementItemsKey = (userId: string, f: ManagementFilters, q: ItemQuery) => [...managementRoot(userId), 'items', managementQuery(f), JSON.stringify(q)] as const;

export type ManagementView = 'checking' | 'check-failed' | 'leave' | 'no-longer' | 'show';

/**
 * What the Management screen shows (Review Focus 1), in this order: the access check failed (a
 * network problem is not a "no") → say so with Try again; not answered yet → a skeleton; the
 * server refused the figures (403) → "no longer"; no access → "no longer" for someone who had it
 * here, else leave; otherwise the page. The figures are drawn only for 'show'.
 */
export function managementView(i: { access: { allowed: boolean; ready: boolean; failed: boolean }; overviewError: unknown; hadAccess: boolean }): ManagementView {
  if (i.access.failed && !i.access.allowed) return 'check-failed';
  if (!i.access.ready) return 'checking';
  if (i.overviewError instanceof ApiError && i.overviewError.status === 403) return 'no-longer';
  if (!i.access.allowed) return i.hadAccess ? 'no-longer' : 'leave';
  return 'show';
}

// ── The sections (Task 8): HealthSection.tsx, InspectionsSection.tsx and PeopleSection.tsx ──

export type HealthSort = 'worst' | 'late' | 'done' | 'name';
export const HEALTH_SORTS: { value: HealthSort; label: string }[] = [
  { value: 'worst', label: 'Worst first' },
  { value: 'late', label: 'Most late tasks' },
  { value: 'done', label: 'Least done' },
  { value: 'name', label: 'Name' },
];
/** Names in English order on every phone, never in the phone's language (the website sorts in the browser's). */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The health rows in the chosen order: worst first is the server's own (red, amber, green; then most late; then name). */
export function sortHealth<R extends Pick<HealthRow, 'name' | 'late' | 'completionPct'>>(rows: R[], sort: HealthSort): R[] {
  if (sort === 'worst') return rows;
  const copy = [...rows];
  if (sort === 'name') return copy.sort((a, b) => collator.compare(a.name, b.name));
  if (sort === 'late') return copy.sort((a, b) => b.late - a.late || collator.compare(a.name, b.name));
  return copy.sort((a, b) => a.completionPct - b.completionPct || collator.compare(a.name, b.name));
}

/** A mark's badge tone (the word and its dot, never colour alone). */
export const ragTone = (r: Rag): 'danger' | 'warning' | 'success' => (r === 'RED' ? 'danger' : r === 'AMBER' ? 'warning' : 'success');

/** The list a reason is about, if it has one. */
export function reasonQuery(code: RagReason['code'], projectId: string): ItemQuery | null {
  if (code === 'MILESTONE_LATE') return { metric: 'late-milestones', projectId };
  if (code === 'MANY_LATE' || code === 'LATE_TASKS') return { metric: 'late-tasks', projectId };
  if (code === 'MANY_MISSING_CHECKS' || code === 'MISSING_CHECKS') return { metric: 'missing-checks', projectId };
  return null;
}

export interface InspectionFigure {
  label: string;
  value: string;
  help: string | null;
  tone: 'neutral' | 'warning' | 'danger';
  /** The list behind it — null at 0 (plain text, as the website's NumberButton) and for the pass rate. */
  query: ItemQuery | null;
  /** The list's name ("5 checks due in the period"). */
  action: string;
}

/** The section's eight figures, in its order, the server's as sent. */
export function inspectionFigures(i: ManagementOverview['inspections']): InspectionFigure[] {
  const fig = (label: string, n: number, tone: InspectionFigure['tone'], query: ItemQuery, action: string, help: string | null = null): InspectionFigure => ({
    label,
    value: String(n),
    help,
    tone,
    query: n === 0 ? null : query,
    action,
  });
  return [
    fig('Checks due', i.due, 'neutral', { metric: 'checks-due' }, `${plural(i.due, 'check')} due in the period`),
    fig('Done', i.done, 'neutral', { metric: 'checks-done' }, `${plural(i.done, 'check')} done`, i.due ? `${Math.round((i.done / i.due) * 100)}% of those due` : null),
    fig('Done late', i.doneLate, 'warning', { metric: 'checks-done-late' }, `${plural(i.doneLate, 'check')} done late`),
    fig('Missing now', i.missing, 'danger', { metric: 'missing-checks' }, plural(i.missing, 'missing check')),
    fig('Closed without a report', i.noReport, 'warning', { metric: 'checks-no-report' }, `${plural(i.noReport, 'check')} closed without a report`),
    fig('Inspections finished', i.finished, 'neutral', { metric: 'inspections' }, `${plural(i.finished, 'inspection')} finished in the period`, i.passRate === null ? 'No items passed or failed yet' : `${i.passed} items passed · ${i.failed} failed`),
    { label: 'Pass rate', value: i.passRate === null ? '—' : `${i.passRate}%`, help: 'Items passed of those passed or failed', tone: 'neutral', query: null, action: '' },
    fig('Open follow-ups', i.openFollowUps, 'neutral', { metric: 'follow-ups' }, plural(i.openFollowUps, 'open follow-up task')),
  ];
}

/** "Wed 28 Oct (7), Thu 29 Oct (6)": a person's days over the limit this week, with each day's count. */
export const overloadedDaysText = (days: PersonRow['overloadedDays']) => days.map((d) => `${shortDay(d.date)} (${d.count})`).join(', ');

// ── The trends (Task 9): TrendsSection.tsx ──

/** The weekly table shows this many weeks (the latest) until all are asked for. */
export const TREND_SHOWN_WEEKS = 6;

/** "12 weeks from 9 Aug; the last one is this week, still going." */
export const trendNote = (t: TrendRow[]) => `${t.length} weeks${t[0] ? ` from ${dayMonth(t[0].start)}` : ''}; the last one is this week, still going.`;

export interface TrendLine {
  name: string;
  /** The server's figure each week; null: no figure that week (a gap). */
  values: (number | null)[];
  /** A palette colour, resolved by the screen (light or dark). */
  color: 'ink2' | 'success' | 'danger' | 'info';
  area?: true;
  dots?: true;
}

export interface TrendChart {
  title: string;
  /** What TalkBack hears for the chart: the website's words for it. */
  label: string;
  unit?: string;
  lines: TrendLine[];
  /** The website's words in the chart's place when there is nothing to draw (a flat line would only show a made-up scale). */
  empty: string | null;
}

/** The section's three charts over the same weeks: created against completed, late at each week's end, the inspection pass rate. */
export function trendCharts(t: TrendRow[]): TrendChart[] {
  const last = t.length ? t[t.length - 1]! : null;
  const rated = t.filter((w) => w.passRate !== null);
  const latestRate = rated.length ? rated[rated.length - 1]!.passRate : null;
  return [
    {
      title: 'Tasks created and completed',
      label: `Tasks created and completed each week${last ? `; this week ${last.created} created, ${last.completed} completed` : ''}. The figures are in the table below.`,
      lines: [
        { name: 'Created', values: t.map((w) => w.created), color: 'ink2' },
        { name: 'Completed', values: t.map((w) => w.completed), color: 'success', area: true },
      ],
      empty: t.every((w) => !w.created && !w.completed) ? 'No tasks were created or completed in these weeks.' : null,
    },
    {
      title: 'Late tasks at each week’s end',
      label: `Late tasks at the end of each week${last ? `; now ${last.late}` : ''}. The figures are in the table below.`,
      lines: [{ name: 'Late', values: t.map((w) => w.late), color: 'danger', area: true }],
      empty: t.every((w) => !w.late) ? 'No task was late at a week’s end.' : null,
    },
    {
      title: 'Inspection pass rate',
      label: `Inspection pass rate each week (no point where a week had no finished inspection); latest ${latestRate ?? '—'}%. The figures are in the table below.`,
      unit: '%',
      lines: [{ name: 'Pass rate', values: t.map((w) => w.passRate), color: 'info', dots: true }],
      empty: rated.length ? null : 'No inspections finished in these weeks.',
    },
  ];
}

/**
 * The weekly table's columns (the website's TrendsSection headers) and their shares of a row: sized
 * so every header word stays whole at 360 dp and the normal font size — "COMPLETED" needs the most
 * room (final review P4, measured with lib/font-metrics: components/management/trends-table.test).
 */
export const TREND_COLUMNS = [
  { title: 'Week of', flex: 1 },
  { title: 'Created', flex: 1.1 },
  { title: 'Completed', flex: 1.45 },
  { title: 'Late', flex: 0.7 },
  { title: 'Pass rate', flex: 0.85 },
] as const;

/** The weekly table's rows: newest first, the latest 6 unless all; "25 Oct (this week)" for the one still going. */
export function trendTableRows(t: TrendRow[], all: boolean): Array<TrendRow & { week: string }> {
  const newestFirst = [...t].reverse();
  return (all ? newestFirst : newestFirst.slice(0, TREND_SHOWN_WEEKS)).map((w) => ({ ...w, week: `${dayMonth(w.start)}${w.current ? ' (this week)' : ''}` }));
}

/** "Show all 12 weeks" / "Show the latest 6 weeks". */
export const trendToggleText = (n: number, all: boolean) => (all ? `Show the latest ${TREND_SHOWN_WEEKS} weeks` : `Show all ${n} weeks`);
