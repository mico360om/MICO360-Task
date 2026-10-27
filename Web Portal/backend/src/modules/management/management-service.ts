/**
 * The Management page: every project's health, inspections, people's workload and trends, for
 * administrators (every project) and for the people who run a project (the projects they run).
 *
 * Who sees what is decided here, once: the caller's projects (all live ones for an administrator;
 * for anyone else the live projects they run — owner, named manager or a MANAGER member), then the
 * filters (status, chosen projects, owner). A project id the caller can't see is a 404, never data.
 * Every read below is asked only about those projects.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { daysUntilDue, dueDayKey, shiftDayKey, todayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { weekOf, type WeekStart } from '../planning/timeline';
import { buildWorkload, type WorkloadScope } from '../planning/workload';
import { loadWorkload, type WorkloadStore } from '../planning/workload-service';
import { isTaskDone } from '../tasks/task-status';
import { checkState, dueInPeriod, summarizeChecks, doneLateBetween, type CheckCounts, type CheckRow } from './check-rules';
import {
  DEFAULT_STATUSES,
  completionPct,
  healthOrder,
  passRate,
  projectRag,
  trendWeeks,
  type ProjectStatus,
  type Rag,
  type RagReason,
  type TrendWeek,
} from './management-rules';
import type { FinishedInspection, ManagementSource, MgmtPerson, MgmtProject, TaskLine } from './management-source';

export interface ManagementViewer {
  id: string;
  roles: string[];
}

export interface ManagementFilters {
  /** Chosen projects (none: all in scope). */
  projectIds: string[];
  ownerId: string | null;
  statuses: ProjectStatus[];
  /** The trend range and the inspection statistics' period: 4, 12 or 26 weeks. */
  weeks: number;
}

export const DEFAULT_FILTERS: ManagementFilters = { projectIds: [], ownerId: null, statuses: [...DEFAULT_STATUSES], weeks: 12 };

export interface ManagementSettings {
  companyWeekStart(): Promise<WeekStart>;
  /** The company's working days (0 = Sunday … 6 = Saturday), as the Workload page uses them. */
  workingHours(): Promise<{ days: number[] }>;
  /** The Workload page's daily limit. */
  dailyLimit(): Promise<number>;
}

export interface ManagementServiceDeps {
  source: ManagementSource;
  /** The Workload page's store: "overloaded" is the Workload page's own rule. */
  workload: WorkloadStore;
  settings: ManagementSettings;
  timeZone: string;
  now?: () => Date;
}

export type ManagementScope = 'ALL' | 'RUN';

export interface OptionProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

export interface HealthRow extends OptionProject {
  owner: { id: string; name: string } | null;
  total: number;
  done: number;
  open: number;
  late: number;
  completionPct: number;
  /** The earliest milestone not reached (a late one first); daysLeft < 0 when late. */
  nextMilestone: { id: string; key: string; title: string; due: string | null; daysLeft: number | null } | null;
  lateMilestones: number;
  lastActivityAt: string;
  missingChecks: number;
  checksDue: number;
  checksDone: number;
  checksDoneLate: number;
  openFollowUps: number;
  rag: Rag;
  reasons: RagReason[];
}

export interface PersonRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  lateTasks: number;
  /** Working days of the current week with more open tasks due than the daily limit. */
  overloadedDays: { date: string; count: number; limit: number }[];
  openActions: number;
  overdueActions: number;
}

export interface TrendRow {
  start: string;
  end: string;
  label: string;
  current: boolean;
  created: number;
  completed: number;
  late: number;
  passed: number;
  failed: number;
  passRate: number | null;
}

export interface TopItem {
  formId: string | null;
  itemId: string;
  label: string;
  formTitle: string;
  failures: number;
}

export interface TopForm {
  formId: string | null;
  title: string;
  finished: number;
  withFailures: number;
  failedItems: number;
}

export interface ManagementOverview {
  scope: ManagementScope;
  generatedAt: string;
  timeZone: string;
  today: string;
  weekStart: WeekStart;
  filters: ManagementFilters;
  period: { from: string; to: string; weeks: number };
  options: { projects: OptionProject[]; owners: { id: string; name: string }[] };
  tiles: {
    projects: number;
    red: number;
    amber: number;
    green: number;
    lateTasks: number;
    missingChecks: number;
    checksDue: number;
    checksDone: number;
    checksDoneLate: number;
    passRate: number | null;
    openFollowUps: number;
    overloadedPeople: number;
  };
  projects: HealthRow[];
  inspections: CheckCounts & { finished: number; passed: number; failed: number; passRate: number | null; openFollowUps: number; topItems: TopItem[]; topForms: TopForm[] };
  people: PersonRow[];
  workload: { week: string; limit: number; workingDays: number[] };
  trends: TrendRow[];
}

export const ITEM_METRICS = [
  'late-tasks',
  'late-milestones',
  'missing-checks',
  'checks-due',
  'checks-done',
  'checks-done-late',
  'checks-no-report',
  'follow-ups',
  'inspections',
  'failed-item',
  'person-overloaded',
  'person-actions',
  'overdue-actions',
  'failed-form',
  'projects',
  'people-overloaded',
] as const;
export type ItemMetric = (typeof ITEM_METRICS)[number];

export interface ItemQuery {
  metric: string;
  projectId?: string;
  personId?: string;
  /** failed-item: the form ('none' or empty: inspections whose form is gone) and the item. */
  formId?: string;
  itemId?: string;
  /** projects: one mark. */
  rag?: string;
  /** inspections: only those with a failed item. */
  failed?: boolean;
}

export interface ItemRow {
  /** 'day': one overloaded day of a person, with its tasks. */
  kind: 'task' | 'inspection' | 'action' | 'project' | 'person' | 'day';
  id: string;
  title: string;
  /** A task's key, a project's code. */
  key?: string | null;
  project?: { id: string; code: string; name: string } | null;
  /** 'YYYY-MM-DD'. */
  due?: string | null;
  /** Open and past its due day: by how many days. */
  daysLate?: number | null;
  people?: string[];
  detail?: string | null;
  tone?: 'danger' | 'warning' | 'success' | 'neutral';
  /** An action item: the meeting it opens in (and its task, if it became one). */
  meetingId?: string | null;
  taskId?: string | null;
  /** An inspection: when it was finished. */
  at?: string | null;
  /** A failed answer's inspection (its row id is the inspection and the item). */
  inspectionId?: string | null;
  /** An overloaded day's tasks. */
  tasks?: { id: string; key: string; title: string }[];
}

export interface ItemList {
  metric: ItemMetric;
  title: string;
  total: number;
  /** At most this many rows are listed. */
  limit: number;
  rows: ItemRow[];
}

/** The weekly summary's figures for one person (their own scope, the default filters). */
export interface WeeklyDigest {
  scope: ManagementScope;
  projects: number;
  red: number;
  amber: number;
  green: number;
  /** The worst projects (not green), worst first: at most three. */
  worst: { id: string; code: string; name: string; rag: Rag; reasons: RagReason[] }[];
  lateTasks: number;
  missingChecks: number;
  lastWeek: { start: string; end: string };
  /** Checks finished last week after their due day. */
  doneLateLastWeek: number;
  passRateLastWeek: number | null;
  /** The three people with the most late work. */
  mostLate: { id: string; name: string; lateTasks: number }[];
}

/** Lists behind a number show at most this many rows (with the full count). */
export const LIST_LIMIT = 200;
const TOP_ITEMS = 10;
const TOP_FORMS = 5;
const WORST = 3;
const MOST_LATE = 3;

const isAdmin = (v: ManagementViewer) => v.roles.includes('ADMIN');
const utcDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
const unique = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const weekdayOf = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Wed 28 Oct" for a 'YYYY-MM-DD' day. */
export const shortDay = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`)).replace(',', '');
const optionOf = (p: MgmtProject): OptionProject => ({ id: p.id, code: p.code, name: p.name, status: p.status, color: p.color, icon: p.icon, imageUrl: p.imageUrl });
const emptyCounts = (): CheckCounts => ({ due: 0, done: 0, doneLate: 0, noReport: 0, missing: 0 });

/** An item's label in an inspection's copied checklist (null when it isn't there any more). */
function itemLabel(structure: unknown, itemId: string): string | null {
  const sections = (structure as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return null;
  for (const s of sections) {
    const items = (s as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) continue;
    for (const i of items) {
      const it = i as { id?: unknown; label?: unknown } | null;
      if (it && it.id === itemId && typeof it.label === 'string') return it.label;
    }
  }
  return null;
}

export function createManagementService(deps: ManagementServiceDeps) {
  const { source, settings } = deps;
  const tz = deps.timeZone;
  const now = () => deps.now?.() ?? new Date();

  async function access(viewer: ManagementViewer): Promise<{ allowed: boolean; scope: ManagementScope | null }> {
    if (isAdmin(viewer)) return { allowed: true, scope: 'ALL' };
    return (await source.runCount(viewer.id)) > 0 ? { allowed: true, scope: 'RUN' } : { allowed: false, scope: null };
  }

  /** The caller's projects (every live one for an administrator; else those they run), then the filters. */
  async function scopeOf(viewer: ManagementViewer, f: ManagementFilters) {
    const admin = isAdmin(viewer);
    const runnable = await source.projects(admin ? null : viewer.id);
    if (!admin && runnable.length === 0) throw new ForbiddenError('Only administrators and the people who run a project can see the Management page.');
    const known = new Set(runnable.map((p) => p.id));
    for (const id of f.projectIds) if (!known.has(id)) throw new NotFoundError('Project not found.');
    const projects = runnable.filter(
      (p) => f.statuses.includes(p.status) && (f.projectIds.length === 0 || f.projectIds.includes(p.id)) && (!f.ownerId || p.ownerId === f.ownerId),
    );
    return { scope: (admin ? 'ALL' : 'RUN') as ManagementScope, runnable, projects };
  }

  async function contextOf(weeks: number) {
    const at = now();
    const [weekStart, hours, limit] = await Promise.all([settings.companyWeekStart(), settings.workingHours(), settings.dailyLimit()]);
    const today = todayKey(tz, at);
    const trend = trendWeeks({ now: at, timeZone: tz, weekStart, weeks });
    return { at, weekStart, workingDays: hours.days, limit, today, trend, period: { from: trend[0]!.start, to: today, weeks } };
  }
  type Context = Awaited<ReturnType<typeof contextOf>>;

  const checkWindow = (ctx: Context, done?: Pick<TrendWeek, 'from' | 'to'>) => ({
    // A day either side: due dates kept as days, or as moments read in company time; judged one by one.
    dueFrom: utcDay(shiftDayKey(ctx.period.from, -1)),
    dueTo: utcDay(shiftDayKey(ctx.today, 2)),
    openBefore: utcDay(shiftDayKey(ctx.today, 1)),
    ...(done ? { doneFrom: done.from, doneTo: done.to } : {}),
  });

  /** Each project's figures, mark and reasons, worst first; with the checks they were made from. */
  async function healthOf(projects: MgmtProject[], ctx: Context, done?: Pick<TrendWeek, 'from' | 'to'>) {
    const ids = projects.map((p) => p.id);
    const [figures, milestones, checks, followUps, owners] = await Promise.all([
      source.taskFigures(ids, ctx.today),
      source.openMilestones(ids),
      source.checks(ids, checkWindow(ctx, done)),
      source.openFollowUps(ids),
      source.people(unique(projects.map((p) => p.ownerId))),
    ]);
    const fig = new Map(figures.map((f) => [f.projectId, f]));
    const follow = new Map(followUps.map((f) => [f.projectId, f.count]));
    const ownerOf = new Map(owners.map((o) => [o.id, o]));
    const summary = summarizeChecks(checks, { from: ctx.period.from, today: ctx.today, timeZone: tz, now: ctx.at });
    const rows: HealthRow[] = projects
      .map((p): HealthRow => {
        const f = fig.get(p.id) ?? { total: 0, done: 0, open: 0, late: 0, lastTaskUpdate: null };
        const marks = milestones
          .filter((m) => m.projectId === p.id)
          .map((m) => ({ m, day: dueDayKey(m.dueDate, tz), daysLeft: daysUntilDue(m.dueDate, tz, ctx.at) }))
          .sort((a, b) => (a.day ?? '9999').localeCompare(b.day ?? '9999') || collator.compare(a.m.title, b.m.title));
        const lateMarks = marks.filter((x) => x.daysLeft !== null && x.daysLeft < 0);
        const next = marks[0] ?? null;
        const lastActivityAt = f.lastTaskUpdate && f.lastTaskUpdate > p.updatedAt ? f.lastTaskUpdate : p.updatedAt;
        const c = summary.byProject.get(p.id) ?? emptyCounts();
        const { rag, reasons } = projectRag(
          { status: p.status, open: f.open, late: f.late, lateMilestones: lateMarks.map((x) => ({ title: x.m.title, daysLate: -x.daysLeft! })), missingChecks: c.missing, lastActivityAt },
          { now: ctx.at, timeZone: tz },
        );
        const owner = p.ownerId ? ownerOf.get(p.ownerId) : undefined;
        return {
          ...optionOf(p),
          owner: owner ? { id: owner.id, name: owner.name } : null,
          total: f.total,
          done: f.done,
          open: f.open,
          late: f.late,
          completionPct: completionPct(f.done, f.total),
          nextMilestone: next ? { id: next.m.id, key: next.m.key, title: next.m.title, due: next.day, daysLeft: next.daysLeft } : null,
          lateMilestones: lateMarks.length,
          lastActivityAt: lastActivityAt.toISOString(),
          missingChecks: c.missing,
          checksDue: c.due,
          checksDone: c.done,
          checksDoneLate: c.doneLate,
          openFollowUps: follow.get(p.id) ?? 0,
          rag,
          reasons,
        };
      })
      .sort(healthOrder);
    return { rows, checks, summary };
  }

  /** Who is over the Workload page's daily limit on a working day of the current company week, in these projects. */
  async function overloadedOf(viewer: ManagementViewer, ids: string[], ctx: Context) {
    const week = weekOf(ctx.today, ctx.weekStart);
    const scope: WorkloadScope = { kind: 'teams', projectIds: ids, ownProjectIds: [] };
    // Suggestions aren't shown here: the everyone-everywhere load they weigh isn't read.
    const store: WorkloadStore = { ...deps.workload, openDue: (q) => (q.projectIds === null ? Promise.resolve([]) : deps.workload.openDue(q)) };
    const { rows } = await loadWorkload(store, { scope, viewerId: viewer.id, projectId: null, week, today: ctx.today, timeZone: tz });
    const data = buildWorkload(rows, { week, timeZone: tz, now: ctx.at, limit: ctx.limit, workingDays: ctx.workingDays, viewerId: viewer.id, scope, projectId: null, canChangeLimit: false });
    const working = new Set(ctx.workingDays);
    return {
      week,
      people: data.people.map((p) => ({
        person: { id: p.id, name: p.name, avatarUrl: p.avatarUrl } as MgmtPerson,
        days: p.days.filter((c) => working.has(weekdayOf(c.date)) && c.over > 0).map((c) => ({ date: c.date, count: c.count, limit: c.limit, taskIds: c.tasks.map((t) => t.id) })),
      })),
    };
  }

  function inspectionFigures(list: FinishedInspection[]) {
    const passed = list.reduce((n, i) => n + i.passed, 0);
    const failed = list.reduce((n, i) => n + i.failed, 0);
    return { finished: list.length, passed, failed, passRate: passRate(passed, failed) };
  }

  function topFormsOf(list: FinishedInspection[]): TopForm[] {
    const forms = new Map<string, TopForm & { last: number }>();
    for (const i of list) {
      const key = i.formId ?? `title:${i.title}`;
      const f = forms.get(key) ?? { formId: i.formId, title: i.title, finished: 0, withFailures: 0, failedItems: 0, last: 0 };
      f.finished += 1;
      if (i.failed > 0) f.withFailures += 1;
      f.failedItems += i.failed;
      if (i.finishedAt.getTime() >= f.last) {
        f.last = i.finishedAt.getTime();
        f.title = i.title;
      }
      forms.set(key, f);
    }
    return [...forms.values()]
      .filter((f) => f.failedItems > 0)
      .sort((a, b) => b.failedItems - a.failedItems || b.withFailures - a.withFailures || collator.compare(a.title, b.title))
      .slice(0, TOP_FORMS)
      .map(({ last: _last, ...f }) => f);
  }

  async function overview(viewer: ManagementViewer, filters: ManagementFilters): Promise<ManagementOverview> {
    const s = await scopeOf(viewer, filters);
    const ctx = await contextOf(filters.weeks);
    const ids = s.projects.map((p) => p.id);
    const from = ctx.trend[0]!.from;
    const to = ctx.trend.at(-1)!.to;
    const [health, finished, failed, lateBy, actions, trend, overloaded, ownerPeople] = await Promise.all([
      healthOf(s.projects, ctx),
      source.finishedInspections(ids, from, to),
      source.failedItems(ids, from, to, TOP_ITEMS),
      source.lateByPerson(ids, ctx.today),
      source.actionItems(ids, ctx.today),
      source.trend(ids, ctx.trend.map((w) => ({ from: w.from, to: w.to, lateDay: w.lateOn, lateAt: w.lateAt }))),
      overloadedOf(viewer, ids, ctx),
      source.people(unique(s.runnable.map((p) => p.ownerId))),
    ]);
    const structures = new Map((failed.length ? await source.structures(unique(failed.map((f) => f.sampleId))) : []).map((x) => [x.id, x]));

    // People: late work, overloaded days, open action items — anyone with one of them.
    const known = new Map<string, MgmtPerson>(overloaded.people.map((p) => [p.person.id, p.person]));
    const late = new Map(lateBy.map((l) => [l.userId, l.count]));
    const acts = new Map(actions.map((a) => [a.userId, a]));
    const days = new Map(overloaded.people.map((p) => [p.person.id, p.days]));
    const ids2 = unique([...late.keys(), ...acts.keys(), ...overloaded.people.filter((p) => p.days.length).map((p) => p.person.id)]);
    const missing = ids2.filter((id) => !known.has(id));
    for (const p of missing.length ? await source.people(missing) : []) known.set(p.id, p);
    const people: PersonRow[] = ids2
      .filter((id) => known.has(id))
      .map((id) => ({
        id,
        name: known.get(id)!.name,
        avatarUrl: known.get(id)!.avatarUrl,
        lateTasks: late.get(id) ?? 0,
        overloadedDays: (days.get(id) ?? []).map(({ date, count, limit }) => ({ date, count, limit })),
        openActions: acts.get(id)?.open ?? 0,
        overdueActions: acts.get(id)?.overdue ?? 0,
      }))
      .filter((p) => p.lateTasks > 0 || p.overloadedDays.length > 0 || p.openActions > 0)
      .sort((a, b) => b.lateTasks - a.lateTasks || b.overloadedDays.length - a.overloadedDays.length || b.openActions - a.openActions || collator.compare(a.name, b.name));

    const ins = inspectionFigures(finished);
    const followUps = health.rows.reduce((n, r) => n + r.openFollowUps, 0);
    const count = (rag: Rag) => health.rows.filter((r) => r.rag === rag).length;
    const sum = health.summary.total;
    return {
      scope: s.scope,
      generatedAt: ctx.at.toISOString(),
      timeZone: tz,
      today: ctx.today,
      weekStart: ctx.weekStart,
      filters,
      period: ctx.period,
      options: {
        projects: [...s.runnable].sort((a, b) => collator.compare(a.name, b.name)).map(optionOf),
        owners: ownerPeople.map((o) => ({ id: o.id, name: o.name })).sort((a, b) => collator.compare(a.name, b.name)),
      },
      tiles: {
        projects: health.rows.length,
        red: count('RED'),
        amber: count('AMBER'),
        green: count('GREEN'),
        lateTasks: health.rows.reduce((n, r) => n + r.late, 0),
        missingChecks: sum.missing,
        checksDue: sum.due,
        checksDone: sum.done,
        checksDoneLate: sum.doneLate,
        passRate: ins.passRate,
        openFollowUps: followUps,
        overloadedPeople: overloaded.people.filter((p) => p.days.length > 0).length,
      },
      projects: health.rows,
      inspections: {
        ...sum,
        ...ins,
        openFollowUps: followUps,
        topItems: failed.map((f) => {
          const st = structures.get(f.sampleId);
          return {
            formId: f.formId,
            itemId: f.itemId,
            label: (st && itemLabel(st.structure, f.itemId)) ?? 'An item no longer on the form',
            formTitle: st?.title ?? 'Inspection',
            failures: f.failures,
          };
        }),
        topForms: topFormsOf(finished),
      },
      people,
      workload: { week: overloaded.week, limit: ctx.limit, workingDays: ctx.workingDays },
      trends: ctx.trend.map((w, i) => {
        const inWeek = inspectionFigures(finished.filter((x) => x.finishedAt >= w.from && x.finishedAt < w.to));
        return {
          start: w.start,
          end: w.end,
          label: w.label,
          current: w.current,
          created: trend.created[i] ?? 0,
          completed: trend.completed[i] ?? 0,
          late: trend.late[i] ?? 0,
          passed: inWeek.passed,
          failed: inWeek.failed,
          passRate: inWeek.passRate,
        };
      }),
    };
  }

  // ── The lists behind the numbers ─────────────────────────────────────────────────────────────

  async function items(viewer: ManagementViewer, filters: ManagementFilters, q: ItemQuery): Promise<ItemList> {
    if (!(ITEM_METRICS as readonly string[]).includes(q.metric)) throw new ValidationError('That list doesn’t exist.');
    const metric = q.metric as ItemMetric;
    const needsPerson = metric === 'person-overloaded';
    if (needsPerson && !q.personId) throw new ValidationError('Say whose list to show.');
    if (metric === 'failed-item' && !q.itemId) throw new ValidationError('Say which item.');
    const s = await scopeOf(viewer, filters);
    if (q.projectId && !s.projects.some((p) => p.id === q.projectId)) throw new NotFoundError('Project not found.');
    const projects = q.projectId ? s.projects.filter((p) => p.id === q.projectId) : s.projects;
    const ids = projects.map((p) => p.id);
    const ctx = await contextOf(filters.weeks);
    const projectOf = new Map(s.projects.map((p) => [p.id, { id: p.id, code: p.code, name: p.name }]));
    const person = q.personId ? (await source.people([q.personId]))[0] ?? null : null;
    /** A form's title when the list has no row to take it from. */
    const formTitleOf = async (formId: string | null) => (formId ? (await source.formTitles([formId]))[0]?.title ?? null : null);
    const suffix = q.projectId ? ` · ${projectOf.get(q.projectId)!.name}` : person ? ` · ${person.name}` : '';
    const list = (title: string, total: number, rows: ItemRow[]): ItemList => ({ metric, title: `${title}${suffix}`, total, limit: LIST_LIMIT, rows: rows.slice(0, LIST_LIMIT) });

    const taskRow = (t: TaskLine, extra: Partial<ItemRow> = {}): ItemRow => {
      const left = daysUntilDue(t.dueDate, tz, ctx.at);
      return {
        kind: 'task',
        id: t.id,
        title: t.title,
        key: t.key,
        project: projectOf.get(t.projectId) ?? null,
        due: dueDayKey(t.dueDate, tz),
        daysLate: !isTaskDone(t) && left !== null && left < 0 ? -left : null,
        people: t.assignees,
        ...extra,
      };
    };
    /** Checks matching `keep`, earliest due first (each due day worked out once), with their task details. */
    const checkList = async (title: string, keep: (r: CheckRow) => boolean, describe?: (r: CheckRow) => Partial<ItemRow>) => {
      const rows = (await source.checks(ids, checkWindow(ctx)))
        .filter(keep)
        .map((r) => ({ r, day: dueDayKey(r.dueDate, tz) ?? '9999' }))
        .sort((a, b) => a.day.localeCompare(b.day) || collator.compare(a.r.id, b.r.id))
        .map((x) => x.r);
      const shown = rows.slice(0, LIST_LIMIT);
      const lines = new Map((await source.tasksByIds(shown.map((r) => r.id))).map((t) => [t.id, t]));
      return list(
        title,
        rows.length,
        shown.filter((r) => lines.has(r.id)).map((r) => taskRow(lines.get(r.id)!, describe?.(r) ?? {})),
      );
    };
    const inPeriod = (r: CheckRow) => dueInPeriod(r, ctx.period.from, ctx.today, tz);
    const state = (r: CheckRow) => checkState(r, tz, ctx.at);
    const isDone = (r: CheckRow) => state(r) === 'DONE' || state(r) === 'DONE_LATE';
    const lateBy = (r: CheckRow) => {
      const due = dueDayKey(r.dueDate, tz);
      const done = r.completedAt ? zonedDayKey(r.completedAt, tz) : null;
      return due && done ? Math.round((Date.parse(`${done}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000) : 0;
    };

    switch (metric) {
      case 'late-tasks': {
        const r = await source.lateTasks({ projectIds: ids, today: ctx.today, ...(q.personId ? { personId: q.personId } : {}), limit: LIST_LIMIT });
        return list('Late tasks', r.total, r.rows.map((t) => taskRow(t, { tone: 'danger' })));
      }
      case 'late-milestones': {
        const r = await source.lateTasks({ projectIds: ids, today: ctx.today, milestonesOnly: true, limit: LIST_LIMIT });
        return list('Late milestones', r.total, r.rows.map((t) => taskRow(t, { tone: 'danger' })));
      }
      case 'missing-checks':
        return checkList('Missing checks', (r) => state(r) === 'LATE', () => ({ tone: 'danger' }));
      case 'checks-due':
        return checkList('Checks due', inPeriod, (r) => {
          const st = state(r);
          return st === 'DONE' ? { detail: 'Done', tone: 'success' } : st === 'DONE_LATE' ? { detail: `Done ${plural(lateBy(r), 'day')} late`, tone: 'warning' } : st === 'LATE' ? { detail: 'Missing', tone: 'danger' } : { detail: 'Due', tone: 'neutral' };
        });
      case 'checks-done':
        return checkList('Checks done', (r) => inPeriod(r) && isDone(r), (r) => (state(r) === 'DONE_LATE' ? { detail: `Done ${plural(lateBy(r), 'day')} late`, tone: 'warning' } : { detail: 'Done on time', tone: 'success' }));
      case 'checks-done-late':
        return checkList('Checks done late', (r) => inPeriod(r) && state(r) === 'DONE_LATE', (r) => ({ detail: `Done ${plural(lateBy(r), 'day')} late`, tone: 'warning' }));
      case 'checks-no-report':
        return checkList('Closed without a report', (r) => inPeriod(r) && isDone(r) && !r.hasReport, () => ({ detail: 'No finished inspection', tone: 'warning' }));
      case 'follow-ups': {
        const r = await source.followUpTasks({ projectIds: ids, limit: LIST_LIMIT });
        return list('Open follow-ups', r.total, r.rows.map((t) => taskRow(t)));
      }
      case 'inspections': {
        const formId = q.formId === undefined ? undefined : q.formId === 'none' ? null : q.formId;
        const rows = (await source.finishedInspections(ids, ctx.trend[0]!.from, ctx.trend.at(-1)!.to))
          .filter((i) => formId === undefined || i.formId === formId)
          .filter((i) => !q.failed || i.failed > 0)
          .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
        const formTitle = formId !== undefined ? rows[0]?.title ?? (await formTitleOf(formId)) : null;
        const title = q.failed ? 'Inspections with a failure' : 'Inspections finished';
        return list(
          formTitle ? `${title} · ${formTitle}` : title,
          rows.length,
          rows.map((i) => ({
            kind: 'inspection',
            id: i.id,
            title: i.title,
            project: projectOf.get(i.projectId) ?? null,
            at: i.finishedAt.toISOString(),
            detail: [i.place, `${i.passed} passed · ${i.failed} failed`].filter(Boolean).join(' · '),
            tone: i.failed > 0 ? 'warning' : 'success',
          })),
        );
      }
      case 'failed-form': {
        const formId = q.formId && q.formId !== 'none' ? q.formId : null;
        const r = await source.failedAnswers({ projectIds: ids, from: ctx.trend[0]!.from, to: ctx.trend.at(-1)!.to, formId, limit: LIST_LIMIT });
        const structures = new Map((r.rows.length ? await source.structures([...new Set(r.rows.map((o) => o.inspectionId))]) : []).map((x) => [x.id, x]));
        const formTitle = r.rows[0]?.title ?? (await formTitleOf(formId));
        return list(
          formTitle ? `Failed items · ${formTitle}` : 'Failed items',
          r.total,
          r.rows.map((o) => ({
            kind: 'inspection',
            id: `${o.inspectionId}|${o.itemId}`,
            inspectionId: o.inspectionId,
            title: itemLabel(structures.get(o.inspectionId)?.structure, o.itemId) ?? 'An item no longer on the form',
            project: projectOf.get(o.projectId) ?? null,
            at: o.finishedAt.toISOString(),
            detail: [o.title, o.place, o.note].filter(Boolean).join(' · '),
            tone: 'danger',
          })),
        );
      }
      case 'failed-item': {
        const formId = q.formId && q.formId !== 'none' ? q.formId : null;
        const r = await source.failedOccurrences({ projectIds: ids, from: ctx.trend[0]!.from, to: ctx.trend.at(-1)!.to, formId, itemId: q.itemId!, limit: LIST_LIMIT });
        const sample = r.rows[0] ? (await source.structures([r.rows[0].inspectionId]))[0] : undefined;
        const label = (sample && itemLabel(sample.structure, q.itemId!)) ?? 'An item';
        return list(
          `“${label}” failed`,
          r.total,
          r.rows.map((o) => ({ kind: 'inspection', id: o.inspectionId, title: o.title, project: projectOf.get(o.projectId) ?? null, at: o.finishedAt.toISOString(), detail: o.note ?? o.place, tone: 'danger' })),
        );
      }
      case 'person-overloaded': {
        // One row per day over the limit (the number on the page counts days), each with its tasks.
        const over = await overloadedOf(viewer, ids, ctx);
        const theirs = over.people.find((p) => p.person.id === q.personId)?.days ?? [];
        const lines = new Map((await source.tasksByIds(theirs.flatMap((d) => d.taskIds))).map((t) => [t.id, t]));
        const rows: ItemRow[] = theirs.map((d) => ({
          kind: 'day',
          id: d.date,
          title: shortDay(d.date),
          detail: `${d.count} due (limit ${d.limit})`,
          tone: 'danger',
          tasks: d.taskIds
            .filter((id) => lines.has(id))
            .map((id) => lines.get(id)!)
            .sort((a, b) => collator.compare(a.key, b.key))
            .map((t) => ({ id: t.id, key: t.key, title: t.title })),
        }));
        return list('Overloaded days', rows.length, rows);
      }
      case 'person-actions':
      case 'overdue-actions': {
        const overdueOnly = metric === 'overdue-actions';
        const r = await source.actionItemList({ projectIds: ids, ...(q.personId ? { personId: q.personId } : {}), ...(overdueOnly ? { overdueOn: ctx.today } : {}), limit: LIST_LIMIT });
        return list(
          overdueOnly ? 'Overdue action items' : 'Open action items',
          r.total,
          r.rows.map((a) => {
            const left = daysUntilDue(a.dueDate, tz, ctx.at);
            const overdue = left !== null && left < 0;
            return {
              kind: 'action',
              id: a.id,
              title: a.description,
              project: projectOf.get(a.projectId) ?? null,
              due: dueDayKey(a.dueDate, tz),
              daysLate: overdue ? -left! : null,
              people: a.assigneeName ? [a.assigneeName] : [],
              detail: a.meetingTitle,
              tone: overdue ? 'danger' : 'neutral',
              meetingId: a.meetingId,
              taskId: a.taskId,
            };
          }),
        );
      }
      case 'projects': {
        const wanted = q.rag === 'RED' || q.rag === 'AMBER' || q.rag === 'GREEN' ? q.rag : null;
        const rows = (await healthOf(projects, ctx)).rows.filter((r) => !wanted || r.rag === wanted);
        const title = wanted === 'RED' ? 'Projects in red' : wanted === 'AMBER' ? 'Projects in amber' : wanted === 'GREEN' ? 'Projects in green' : 'Projects';
        return list(
          title,
          rows.length,
          rows.map((r) => ({ kind: 'project', id: r.id, title: r.name, key: r.code, detail: r.reasons.map((x) => x.text).join(' · '), tone: r.rag === 'RED' ? 'danger' : r.rag === 'AMBER' ? 'warning' : 'success' })),
        );
      }
      case 'people-overloaded': {
        const over = await overloadedOf(viewer, ids, ctx);
        const rows = over.people
          .filter((p) => p.days.length > 0)
          .sort((a, b) => b.days.length - a.days.length || collator.compare(a.person.name, b.person.name))
          .map((p) => ({ kind: 'person' as const, id: p.person.id, title: p.person.name, detail: p.days.map((d) => `${shortDay(d.date)}: ${d.count} due`).join(' · '), tone: 'danger' as const }));
        return list('Overloaded this week', rows.length, rows);
      }
    }
  }

  // ── The weekly summary ─────────────────────────────────────────────────────────────────────────

  /**
   * One person's weekly summary figures, or null when nothing is in their scope (no email then).
   * `week`: the company week the summary is for ('YYYY-MM-DD', its first day) — "last week" is the one
   * before it, also for someone whose morning comes before the company's (far east of it). Without
   * it, the week before the company's current week.
   */
  async function digest(viewer: ManagementViewer, week?: string): Promise<WeeklyDigest | null> {
    let s: Awaited<ReturnType<typeof scopeOf>>;
    try {
      s = await scopeOf(viewer, DEFAULT_FILTERS);
    } catch (err) {
      if (err instanceof ForbiddenError) return null;
      throw err;
    }
    if (s.projects.length === 0) return null;
    const ctx = await contextOf(2);
    const last: Pick<TrendWeek, 'start' | 'end' | 'from' | 'to'> = week
      ? { start: shiftDayKey(week, -7), end: shiftDayKey(week, -1), from: zonedStartOfDay(shiftDayKey(week, -7), tz), to: zonedStartOfDay(week, tz) }
      : ctx.trend[0]!;
    const ids = s.projects.map((p) => p.id);
    const [health, finished, lateBy] = await Promise.all([healthOf(s.projects, ctx, last), source.finishedInspections(ids, last.from, last.to), source.lateByPerson(ids, ctx.today)]);
    const top = lateBy.filter((l) => l.count > 0).sort((a, b) => b.count - a.count).slice(0, MOST_LATE * 2);
    const names = new Map((top.length ? await source.people(top.map((l) => l.userId)) : []).map((p) => [p.id, p.name]));
    const count = (rag: Rag) => health.rows.filter((r) => r.rag === rag).length;
    return {
      scope: s.scope,
      projects: health.rows.length,
      red: count('RED'),
      amber: count('AMBER'),
      green: count('GREEN'),
      worst: health.rows.filter((r) => r.rag !== 'GREEN').slice(0, WORST).map((r) => ({ id: r.id, code: r.code, name: r.name, rag: r.rag, reasons: r.reasons })),
      lateTasks: health.rows.reduce((n, r) => n + r.late, 0),
      missingChecks: health.summary.total.missing,
      lastWeek: { start: last.start, end: last.end },
      doneLateLastWeek: doneLateBetween(health.checks, last.from, last.to, tz).length,
      passRateLastWeek: inspectionFigures(finished).passRate,
      mostLate: top
        .filter((l) => names.has(l.userId))
        .sort((a, b) => b.count - a.count || collator.compare(names.get(a.userId)!, names.get(b.userId)!))
        .slice(0, MOST_LATE)
        .map((l) => ({ id: l.userId, name: names.get(l.userId)!, lateTasks: l.count })),
    };
  }

  return { access, overview, items, digest };
}

export type ManagementService = ReturnType<typeof createManagementService>;
