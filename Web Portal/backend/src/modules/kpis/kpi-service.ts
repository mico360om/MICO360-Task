/**
 * Project KPIs and User KPIs — the pages' answers.
 *
 *   - A project's KPIs (its KPIs tab): each automatic KPI for the period with its target, light and words,
 *     a trend (6 months, or 12 weeks for a week), the list behind each number, and its own KPIs.
 *   - The Management page's KPI table: every project in the reader's Management scope, for the period.
 *   - A person's KPIs (owner 2): the person themselves ("My performance", every project they can see),
 *     an administrator (every project), and whoever runs a project the person is on — counting ONLY the
 *     projects that viewer runs. A colleague is refused (403); a client account never reaches here (the
 *     route table refuses it). No rankings or lists of colleagues (non-goal).
 *   - Targets (owner 3): administrators set the company defaults; whoever runs a project overrides them.
 *   - A project's own KPIs: whoever runs it (and administrators) add them and enter the monthly values.
 *
 * Who may see a project is checked by the routes (404) before a project's answer is asked for here.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { todayKey, zonedStartOfDay, shiftDayKey } from '../../lib/due-date';
import { isWorkingDay, shiftDay, type WorkCalendar, type WorkHours } from '../../lib/working-days';
import { DEFAULT_STATUSES, type ProjectStatus } from '../management/management-rules';
import type { ManagementSource } from '../management/management-source';
import { addCounters, emptyCounters, projectFigures, userFigures, windowOf, type CalcWindow, type Counters } from './kpi-calc';
import {
  DEFAULT_TARGETS,
  LIGHT_WORDS,
  METRIC,
  PROJECT_METRICS,
  TARGET_METRICS,
  USER_METRICS,
  amberBandOf,
  lightOf,
  monthEnd,
  monthLabel,
  monthsBack,
  periodOf,
  prevMonth,
  resolveTargets,
  roundFor,
  slicesOf,
  weeksBack,
  type Light,
  type MetricKey,
  type Period,
  type PeriodAsk,
  type ResolvedTargets,
  type TargetSource,
  type Unit,
} from './kpi-defs';
import type { KpiEngine, SliceCounts } from './kpi-engine';
import { ITEMS_LIMIT, LISTED, itemsFor, type KpiItemRow } from './kpi-items';
import type { KpiPerson, KpiProjectRow, KpiSource, PlannedHoursSource } from './kpi-source';
import type { CustomDirection, CustomKpi, CustomKpiStore, SnapshotRow, SnapshotStore, TargetStore } from './kpi-stores';
import { sumSlices } from './kpi-snapshots';
import { workingMinutesBetween } from './working-time';

export interface KpiViewer {
  id: string;
  roles: string[];
}

const isAdmin = (v: KpiViewer) => v.roles.includes('ADMIN');

export interface KpiAccess {
  canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Projects the viewer may see (null: every project — an administrator). */
  visibleProjectIds(viewer: KpiViewer): Promise<string[] | null>;
  /** Projects (not deleted) the person runs — owner, named manager or MANAGER member — and can see. */
  runProjectIds(userId: string): Promise<string[]>;
  /** Projects (not deleted) the person is on: owner, manager, team member, or assigned a task in. */
  personProjectIds(userId: string): Promise<string[]>;
  /** A staff person (not a client account, not deleted). */
  person(userId: string): Promise<{ id: string; name: string; avatarUrl: string | null; companyId: string | null; active: boolean } | null>;
}

export interface KpiServiceDeps {
  engine: KpiEngine;
  source: KpiSource;
  snapshots: SnapshotStore;
  targets: TargetStore;
  custom: CustomKpiStore;
  planned: PlannedHoursSource;
  access: KpiAccess;
  management: Pick<ManagementSource, 'projects' | 'runCount'>;
  /** 1.22 "Show my projects only" (an administrator's own): the Management table then lists their own projects. */
  myProjectsOnly?(viewer: KpiViewer): Promise<boolean>;
  /** A company's working days, holidays and hours (null: the site's). */
  rules(companyId: string | null): Promise<{ calendar: WorkCalendar; hours: WorkHours }>;
  /** The site's week start (KPI weeks). */
  weekStart(): Promise<number>;
  companies(): Promise<{ id: string; name: string }[]>;
  timeZone: string;
  now?: () => Date;
}

export interface KpiTile {
  metric: MetricKey;
  label: string;
  help: string;
  unit: Unit;
  direction: 'higher' | 'lower';
  value: number | null;
  /** The facts behind it in words ("12 of 14 finished on time"). */
  detail: string | null;
  target: number | null;
  amberBand: number | null;
  targetSource: TargetSource;
  light: Light;
  words: string;
  /** One figure per trend point (oldest first); null where there's nothing to show. */
  trend: (number | null)[];
  /** A list is behind the number. */
  list: boolean;
}

export interface TrendPoint {
  key: string;
  label: string;
  current: boolean;
  /** Worked out from history after the KPIs started (best effort). */
  rebuilt: boolean;
}

export interface CustomKpiView {
  id: string;
  name: string;
  unit: string;
  direction: CustomDirection;
  target: number | null;
  amberBand: number | null;
  /** The months of the trend with their values (null: not entered). */
  values: { month: string; value: number | null; note: string | null }[];
  /** The latest value entered (this month or before). */
  latest: { month: string; value: number } | null;
  light: Light;
  words: string;
  /** The previous month has no value yet (the monthly reminder asks for it). */
  due: string | null;
}

export interface ProjectKpis {
  project: { id: string; code: string; name: string; color: string; icon: string | null; imageUrl: string | null; status: ProjectStatus; archived: boolean; companyId: string | null };
  period: Period;
  today: string;
  timeZone: string;
  generatedAt: string;
  trend: { kind: 'month' | 'week'; points: TrendPoint[] };
  tiles: KpiTile[];
  custom: CustomKpiView[];
  can: { manage: boolean };
}

export interface PersonKpis {
  person: { id: string; name: string; avatarUrl: string | null; active: boolean };
  /** Whose view: their own, an administrator's (every project) or a project manager's (their projects only). */
  scope: 'self' | 'admin' | 'manager';
  /** The projects counted (a manager sees only theirs). */
  projects: { id: string; code: string; name: string; color: string; icon: string | null; imageUrl: string | null }[];
  period: Period;
  today: string;
  timeZone: string;
  generatedAt: string;
  trend: { kind: 'month' | 'week'; points: TrendPoint[] };
  tiles: KpiTile[];
  workload: { openTasks: number; plannedHours: number | null; capacityHours: number; meetingHours: number };
}

export interface ManagementKpiRow {
  project: { id: string; code: string; name: string; color: string; icon: string | null; imageUrl: string | null; status: ProjectStatus };
  owner: { id: string; name: string } | null;
  figures: Record<string, { value: number | null; light: Light; words: string; target: number | null }>;
}

export interface ManagementKpis {
  scope: 'ALL' | 'RUN';
  period: Period;
  today: string;
  timeZone: string;
  generatedAt: string;
  metrics: { metric: MetricKey; label: string; unit: Unit; direction: 'higher' | 'lower' }[];
  rows: ManagementKpiRow[];
}

export interface KpiItems {
  metric: MetricKey;
  title: string;
  total: number;
  limit: number;
  rows: (KpiItemRow & { project: { id: string; code: string; name: string } | null; peopleNames: string[] })[];
}

export interface ManagementFiltersLite {
  projectIds: string[];
  ownerId: string | null;
  statuses: ProjectStatus[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY_MS = 86_400_000;
const ms = (d: Date) => d.getTime();
const unique = <T>(xs: T[]) => [...new Set(xs)];
const projectOf = (p: KpiProjectRow) => ({ id: p.id, code: p.code, name: p.name, color: p.color, icon: p.icon, imageUrl: p.imageUrl });

/** A person's counters summed over projects (point-in-time ones too: each project's end). */
function sumPeople(counts: SliceCounts, userId: string, projectIds: Set<string> | null): { counters: Counters; responses: number[]; actionItems: number } {
  let c = emptyCounters();
  const responses: number[] = [];
  let actionItems = 0;
  for (const [pid, m] of counts.people) {
    if (projectIds && pid && !projectIds.has(pid)) continue;
    const x = m.get(userId);
    if (!x) continue;
    c = { ...addCounters(c, x), openDue: c.openDue + x.openDue, overdue: c.overdue + x.overdue };
    responses.push(...x.responses);
    actionItems += x.actionItems;
  }
  return { counters: c, responses, actionItems };
}

/** The words under a project tile. */
function projectDetail(metric: MetricKey, c: Counters, extra: { blocked: number; oldestDays: number | null; completionPct: number; timeUsedPct: number | null }): string | null {
  switch (metric) {
    case 'onTime':
      return c.dueDone ? `${c.onTime} of ${plural(c.dueDone, 'task')} finished on time` : 'Nothing with a due day finished yet';
    case 'overdue':
      return c.openDue ? `${c.overdue} of ${plural(c.openDue, 'open task')} with a due day` : 'No open tasks with a due day';
    case 'daysLate':
      return c.dueDone ? (c.lateCount ? `${plural(c.lateCount, 'task')} finished late` : 'None finished late') : null;
    case 'progress':
      return extra.timeUsedPct === null ? 'Needs a start and a target date' : `${extra.completionPct}% done · ${extra.timeUsedPct}% of the time used`;
    case 'throughput':
      return `${plural(c.completed, 'task')} finished`;
    case 'cycleTime':
      return c.cycleCount ? `${plural(c.cycleCount, 'task')} finished` : null;
    case 'approvalTurnaround':
      return c.approvalCount ? `${plural(c.approvalCount, 'decision')}` : 'No approvals decided';
    case 'blocked':
      return extra.blocked ? `Oldest ${plural(extra.oldestDays ?? 0, 'day')}` : 'Nothing blocked';
    default:
      return null;
  }
}

function personDetail(metric: MetricKey, c: Counters, extra: { responses: number; workload: PersonKpis['workload'] }): string | null {
  switch (metric) {
    case 'completed':
      return 'Finished or handed in';
    case 'onTime':
      return c.dueDone ? `${c.onTime} of ${plural(c.dueDone, 'task')} on time` : 'Nothing with a due day finished yet';
    case 'daysLate':
      return c.dueDone ? (c.lateCount ? `${plural(c.lateCount, 'task')} finished late` : 'None finished late') : null;
    case 'userOverdue':
      return c.openDue ? `Of ${plural(c.openDue, 'open task')} with a due day` : 'No open tasks with a due day';
    case 'workload': {
      const w = extra.workload;
      const open = `${plural(w.openTasks, 'open task')}`;
      return w.plannedHours === null ? `${open} · planned hours come from work blocks in the Calendar` : `${open} · ${w.plannedHours} h planned of ${w.capacityHours} h`;
    }
    case 'approvalTurnaround':
      return c.approvalCount ? `${plural(c.approvalCount, 'decision')} as approver` : 'No approvals decided';
    case 'responsiveness':
      return extra.responses ? `${plural(extra.responses, 'answer')}` : 'Nothing to answer yet';
    case 'actionItems':
      return 'From meetings';
    default:
      return null;
  }
}

export function createKpiService(deps: KpiServiceDeps) {
  const tz = deps.timeZone;
  const now = () => deps.now?.() ?? new Date();

  async function periodFor(ask: PeriodAsk) {
    const at = now();
    const today = todayKey(tz, at);
    const weekStart = await deps.weekStart();
    return { at, today, weekStart, period: periodOf(ask, today, weekStart) };
  }

  /** The trend's points: 6 months (the current one live), or 12 weeks for a week. */
  function trendPoints(kind: 'month' | 'week', today: string, weekStart: number): { key: string; label: string; current: boolean }[] {
    if (kind === 'month') return monthsBack(today, 6).map((m, i, a) => ({ key: m, label: monthLabel(m, today), current: i === a.length - 1 }));
    return weeksBack(today, weekStart, 12).map((w, i, a) => ({ key: w, label: `${Number(w.slice(8))} ${monthLabel(w.slice(0, 7), today).split(' ')[0]}`, current: i === a.length - 1 }));
  }

  async function targetsFor(companyId: string | null, projectId: string | null): Promise<ResolvedTargets> {
    const keys = ['site', ...(companyId ? [`company:${companyId}`] : []), ...(projectId ? [`project:${projectId}`] : [])];
    return resolveTargets(await deps.targets.rows(keys), { companyId, projectId });
  }

  function tile(metric: MetricKey, value: number | null, targets: ResolvedTargets, detail: string | null, trend: (number | null)[], listed = true): KpiTile {
    const def = METRIC[metric];
    const t = targets[metric];
    const v = roundFor(metric, value);
    const light = def.targeted ? lightOf(v, t, metric) : v === null ? 'nodata' : 'none';
    return {
      metric,
      label: def.label,
      help: def.help,
      unit: def.unit,
      direction: def.direction,
      value: v,
      detail,
      target: def.targeted ? t.target : null,
      amberBand: def.targeted && t.target !== null ? amberBandOf(t.target, t.amberBand) : null,
      targetSource: t.source,
      light,
      words: def.targeted ? LIGHT_WORDS[light] : v === null ? LIGHT_WORDS.nodata : '',
      trend: trend.map((x) => roundFor(metric, x)),
      list: listed && LISTED.includes(metric),
    };
  }

  // ── A project's KPIs ─────────────────────────────────────────────────────

  async function projectRow(projectId: string): Promise<KpiProjectRow> {
    const [p] = await deps.source.projects([projectId]);
    if (!p) throw new NotFoundError('Project not found.');
    return p;
  }

  /** A project's figures for a window of the facts (progress and blocked passed in). */
  function figuresOf(c: Counters, w: CalcWindow, extra: { progress: number | null; blocked: number | null }) {
    const weeks = Math.max(ms(w.to) - ms(w.from), DAY_MS) / (7 * DAY_MS);
    return projectFigures(c, { weeks, blocked: extra.blocked, progress: extra.progress });
  }

  /** The trend's live part starts here: this month, and last month too while it isn't stored yet (the hour after midnight, a failed night). */
  async function liveStartFor(projectIds: string[], today: string): Promise<string> {
    const current = today.slice(0, 7);
    const last = prevMonth(current);
    const stored = await deps.snapshots.read({ projectIds, userId: '', months: [last] });
    const missing = projectIds.some((id) => !stored.some((r) => r.projectId === id));
    return `${missing && projectIds.length ? last : current}-01`;
  }

  /** The last slice day of a trend point (a month's or a week's), for the point-in-time figures. */
  function lastSliceDay(kind: 'month' | 'week', key: string, weekStart: number): string {
    const slices = kind === 'month' ? slicesOf(`${key}-01`, monthEnd(key), weekStart) : slicesOf(key, shiftDay(key, 6), weekStart);
    return slices.at(-1)!.day;
  }

  /** Several projects' KPI pages from one read of their facts (the Management PDF: a page each). */
  async function projectKpisMany(viewer: KpiViewer, projects: KpiProjectRow[], ask: PeriodAsk): Promise<ProjectKpis[]> {
    if (projects.length === 0) return [];
    const { at, today, weekStart, period } = await periodFor(ask);
    const kind = period.kind === 'week' ? 'week' : 'month';
    const points = trendPoints(kind, today, weekStart);
    const ids = projects.map((p) => p.id);
    const liveStart = await liveStartFor(ids, today);
    const liveMonth = liveStart.slice(0, 7);
    const [facts, blocked, stored, allTargets, custom] = await Promise.all([
      deps.engine.load(projects, zonedStartOfDay(period.from < liveStart ? period.from : liveStart, tz), at),
      deps.source.blocked(ids),
      deps.snapshots.read({ projectIds: ids, userId: '', ...(kind === 'month' ? { months: points.map((x) => x.key) } : { weekStarts: points.map((x) => x.key) }) }),
      deps.targets.rows(['site', ...unique(projects.map((p) => p.companyId).filter((c): c is string => !!c)).map((c) => `company:${c}`), ...ids.map((id) => `project:${id}`)]),
      customViews(ids, today),
    ]);
    const w = windowOf(period.from, period.to, tz, at);
    const periodCounts = deps.engine.counts(facts, w);
    const live = slicesOf(liveStart, today, weekStart).map((s) => ({ s, counts: deps.engine.counts(facts, windowOf(s.day, s.end, tz, at)) }));
    const out: ProjectKpis[] = [];
    for (const p of projects) {
      const mineBlocked = blocked.filter((b) => b.projectId === p.id);
      const counts = periodCounts.projects.get(p.id)!;
      const oldest = mineBlocked.reduce<Date | null>((a, b) => (!a || b.since < a ? b.since : a), null);
      const extra = { blocked: mineBlocked.length, oldestDays: oldest ? Math.max(0, Math.round((ms(at) - ms(oldest)) / DAY_MS)) : null, completionPct: counts.completionPct, timeUsedPct: counts.timeUsedPct };
      const figures = figuresOf(counts, w, { progress: counts.progress, blocked: mineBlocked.length });
      const targets = resolveTargets(allTargets, { companyId: p.companyId, projectId: p.id });
      // The trend: stored slices before the live part, then the live slices.
      const trendFigures = points.map((pt) => {
        const rows = stored.filter((r) => r.projectId === p.id && r.month < liveMonth && (kind === 'month' ? r.month === pt.key : r.weekStart === pt.key));
        const mine = live.filter((x) => (kind === 'month' ? x.s.month === pt.key : x.s.weekStart === pt.key));
        if (rows.length === 0 && mine.length === 0) return { rebuilt: false, figures: null as ReturnType<typeof figuresOf> | null };
        const summed = sumSlices(rows);
        let c = summed.counters;
        let days = summed.days;
        let progress = (summed.last?.progress as number | null | undefined) ?? null;
        for (const x of mine) {
          c = addCounters(c, x.counts.projects.get(p.id)!);
          days += Math.round((Date.parse(`${x.s.end}T12:00:00Z`) - Date.parse(`${x.s.day}T12:00:00Z`)) / DAY_MS) + 1;
          progress = x.counts.projects.get(p.id)!.progress;
        }
        const span = { from: new Date(0), to: new Date(days * DAY_MS) } as CalcWindow;
        return { rebuilt: summed.rebuilt, figures: figuresOf(c, span, { progress, blocked: pt.current ? mineBlocked.length : null }) };
      });
      const manage = await deps.access.canManageProject(viewer.id, viewer.roles, p.id);
      out.push({
        project: { ...projectOf(p), status: p.status, archived: p.archived, companyId: p.companyId },
        period,
        today,
        timeZone: tz,
        generatedAt: at.toISOString(),
        trend: { kind, points: points.map((pt, i) => ({ ...pt, rebuilt: trendFigures[i]!.rebuilt })) },
        tiles: PROJECT_METRICS.map((m) =>
          tile(
            m,
            figures[m as keyof typeof figures] as number | null,
            targets,
            projectDetail(m, counts, extra),
            trendFigures.map((t) => (t.figures ? (t.figures[m as keyof typeof t.figures] as number | null) : null)),
          ),
        ),
        custom: custom.get(p.id) ?? [],
        can: { manage: manage && !p.archived },
      });
    }
    return out;
  }

  async function projectKpis(viewer: KpiViewer, projectId: string, ask: PeriodAsk): Promise<ProjectKpis> {
    const [answer] = await projectKpisMany(viewer, [await projectRow(projectId)], ask);
    return answer!;
  }

  async function customViews(projectIds: string[], today: string): Promise<Map<string, CustomKpiView[]>> {
    const months = monthsBack(today, 6);
    const rows = await deps.custom.list(projectIds, months[0]!);
    const out = new Map<string, CustomKpiView[]>();
    const lastMonth = prevMonth(today.slice(0, 7));
    for (const k of rows) {
      const latest = [...k.values].filter((v) => v.month <= today.slice(0, 7)).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
      const value = latest?.value ?? null;
      const light: Light = value === null ? 'nodata' : k.target === null ? 'none' : lightOfCustom(value, k);
      out.set(k.projectId, [
        ...(out.get(k.projectId) ?? []),
        {
          id: k.id,
          name: k.name,
          unit: k.unit,
          direction: k.direction,
          target: k.target,
          amberBand: k.amberBand,
          values: months.map((m) => {
            const v = k.values.find((x) => x.month === m);
            return { month: m, value: v?.value ?? null, note: v?.note ?? null };
          }),
          latest: latest ? { month: latest.month, value: latest.value } : null,
          light,
          words: LIGHT_WORDS[light],
          due: k.values.some((v) => v.month === lastMonth) ? null : lastMonth,
        },
      ]);
    }
    return out;
  }

  function lightOfCustom(value: number, k: Pick<CustomKpi, 'target' | 'amberBand' | 'direction'>): Light {
    if (k.target === null) return 'none';
    const band = amberBandOf(k.target, k.amberBand);
    const eps = 1e-9;
    if (k.direction === 'HIGHER') return value >= k.target - eps ? 'green' : value >= k.target - band - eps ? 'amber' : 'red';
    return value <= k.target + eps ? 'green' : value <= k.target + band + eps ? 'amber' : 'red';
  }

  async function names(ids: string[]): Promise<Map<string, KpiPerson>> {
    const people = ids.length ? await deps.source.people(unique(ids)) : [];
    return new Map(people.map((x) => [x.id, x]));
  }

  async function itemsAnswer(metric: MetricKey, rows: KpiItemRow[], projects: KpiProjectRow[]): Promise<KpiItems> {
    const shown = rows.slice(0, ITEMS_LIMIT);
    const who = await names(shown.flatMap((r) => r.people));
    const byId = new Map(projects.map((p) => [p.id, p]));
    return {
      metric,
      title: METRIC[metric].label,
      total: rows.length,
      limit: ITEMS_LIMIT,
      rows: shown.map((r) => {
        const p = r.projectId ? byId.get(r.projectId) : undefined;
        return { ...r, project: p ? { id: p.id, code: p.code, name: p.name } : null, peopleNames: r.people.map((id) => who.get(id)?.name).filter((x): x is string => !!x) };
      }),
    };
  }

  function listedMetric(metric: string, scope: 'project' | 'user'): MetricKey {
    const m = metric as MetricKey;
    if (!METRIC[m] || !METRIC[m].scopes.includes(scope) || !LISTED.includes(m)) throw new ValidationError('That list isn’t available.');
    return m;
  }

  async function projectItems(viewer: KpiViewer, projectId: string, metric: string, ask: PeriodAsk): Promise<KpiItems> {
    const m = listedMetric(metric, 'project');
    const p = await projectRow(projectId);
    // Who was late is for whoever runs the project and administrators (owner 2: colleagues never see each
    // other's record); everyone else who may see the project sees the tasks without names.
    const named = await deps.access.canManageProject(viewer.id, viewer.roles, p.id);
    const { at, period } = await periodFor(ask);
    const facts = await deps.engine.load([p], zonedStartOfDay(period.from, tz), at);
    const blocked = m === 'blocked' ? await deps.source.blocked([p.id]) : [];
    const w = windowOf(period.from, period.to, tz, at);
    const rows = itemsFor(m === 'throughput' ? 'completed' : m, facts, w, { blocked, now: at });
    return itemsAnswer(m, named ? rows : rows.map((r) => ({ ...r, people: [] })), [p]);
  }

  // ── The Management page's KPI table ──────────────────────────────────────

  async function managementScope(viewer: KpiViewer, f: ManagementFiltersLite, pick: string | null) {
    const admin = isAdmin(viewer);
    const teamOf = admin && deps.myProjectsOnly && (await deps.myProjectsOnly(viewer)) ? viewer.id : null;
    const runnable = await deps.management.projects(admin ? null : viewer.id, pick, teamOf ? { teamOf } : undefined);
    if (!admin && runnable.length === 0 && (!pick || (await deps.management.runCount(viewer.id)) === 0)) {
      throw new ForbiddenError('Only administrators and the people who run a project can see the Management page.');
    }
    const known = new Set(runnable.map((p) => p.id));
    for (const id of f.projectIds) if (!known.has(id)) throw new NotFoundError('Project not found.');
    const chosen = runnable.filter((p) => f.statuses.includes(p.status) && (f.projectIds.length === 0 || f.projectIds.includes(p.id)) && (!f.ownerId || p.ownerId === f.ownerId));
    return { scope: (admin ? 'ALL' : 'RUN') as 'ALL' | 'RUN', ids: chosen.map((p) => p.id) };
  }

  async function managementKpis(viewer: KpiViewer, f: ManagementFiltersLite, pick: string | null, ask: PeriodAsk): Promise<ManagementKpis> {
    const { scope, ids } = await managementScope(viewer, f, pick);
    const { at, today, period } = await periodFor(ask);
    const projects = await deps.source.projects(ids);
    const w = windowOf(period.from, period.to, tz, at);
    const facts = projects.length ? await deps.engine.load(projects, zonedStartOfDay(period.from, tz), at) : null;
    const counts = facts ? deps.engine.counts(facts, w) : null;
    const blocked = await deps.source.blocked(projects.map((p) => p.id));
    const allTargets = await deps.targets.rows(['site', ...unique(projects.map((p) => p.companyId).filter((c): c is string => !!c)).map((c) => `company:${c}`), ...projects.map((p) => `project:${p.id}`)]);
    const owners = await names(projects.map((p) => p.ownerId).filter((x): x is string => !!x));
    const rows: ManagementKpiRow[] = projects.map((p) => {
      const c = counts!.projects.get(p.id)!;
      const fig = figuresOf(c, w, { progress: c.progress, blocked: blocked.filter((b) => b.projectId === p.id).length });
      const targets = resolveTargets(allTargets, { companyId: p.companyId, projectId: p.id });
      const figures: ManagementKpiRow['figures'] = {};
      for (const m of PROJECT_METRICS) {
        const v = roundFor(m, fig[m as keyof typeof fig] as number | null);
        const light = lightOf(v, targets[m], m);
        figures[m] = { value: v, light, words: LIGHT_WORDS[light], target: targets[m].target };
      }
      const owner = p.ownerId ? owners.get(p.ownerId) : undefined;
      return { project: { ...projectOf(p), status: p.status }, owner: owner ? { id: owner.id, name: owner.name } : null, figures };
    });
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    rows.sort((a, b) => collator.compare(a.project.name, b.project.name));
    return {
      scope,
      period,
      today,
      timeZone: tz,
      generatedAt: at.toISOString(),
      metrics: PROJECT_METRICS.map((m) => ({ metric: m, label: METRIC[m].label, unit: METRIC[m].unit, direction: METRIC[m].direction })),
      rows,
    };
  }

  /** The Management PDF's pages: each project in the reader's scope, from one read of their facts. */
  async function managementPages(viewer: KpiViewer, f: ManagementFiltersLite, pick: string | null, ask: PeriodAsk): Promise<ProjectKpis[]> {
    const { ids } = await managementScope(viewer, f, pick);
    const projects = await deps.source.projects(ids);
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return projectKpisMany(viewer, projects.sort((a, b) => collator.compare(a.name, b.name)), ask);
  }

  // ── A person's KPIs (owner 2) ────────────────────────────────────────────

  /** Whose view it is and which projects count. A colleague is refused. */
  async function personScope(viewer: KpiViewer, userId: string): Promise<{ scope: PersonKpis['scope']; projectIds: string[]; unprojected: boolean; person: NonNullable<Awaited<ReturnType<KpiAccess['person']>>> }> {
    const person = await deps.access.person(userId);
    if (!person) throw new NotFoundError('Person not found.');
    const theirs = await deps.access.personProjectIds(userId);
    if (viewer.id === userId) {
      const visible = await deps.access.visibleProjectIds(viewer);
      return { scope: 'self', projectIds: visible ? theirs.filter((id) => visible.includes(id)) : theirs, unprojected: true, person };
    }
    if (isAdmin(viewer)) return { scope: 'admin', projectIds: theirs, unprojected: true, person };
    const run = new Set(await deps.access.runProjectIds(viewer.id));
    const shared = theirs.filter((id) => run.has(id));
    if (shared.length === 0) throw new ForbiddenError('Only the person, the managers of their projects and administrators can see someone’s performance.');
    return { scope: 'manager', projectIds: shared, unprojected: false, person };
  }

  /**
   * Hours they have in the period: working hours × working days (holidays off), less their meetings. A
   * manager's view counts only the meetings of the projects they run (nothing about the rest leaks).
   */
  async function capacity(userId: string, companyId: string | null, period: Period, meetingProjects: string[] | null): Promise<{ capacityHours: number; meetingHours: number }> {
    const r = await deps.rules(companyId);
    const dayMinutes = Math.max(0, minutesOfDay(r.hours.end) - minutesOfDay(r.hours.start));
    let days = 0;
    for (let d = period.from; d <= period.end; d = shiftDay(d, 1)) if (isWorkingDay(d, r.calendar)) days += 1;
    const from = zonedStartOfDay(period.from, tz);
    const to = zonedStartOfDay(shiftDayKey(period.end, 1), tz);
    let meetingMinutes = 0;
    for (const m of await deps.source.meetings(userId, from, to, meetingProjects ?? undefined)) {
      const end = m.endAt && ms(m.endAt) > ms(m.startAt) ? m.endAt : new Date(ms(m.startAt) + 60 * 60_000);
      meetingMinutes += workingMinutesBetween(m.startAt, end, tz, r.calendar, r.hours);
    }
    const meetingHours = Math.round((meetingMinutes / 60) * 10) / 10;
    return { capacityHours: Math.max(0, Math.round(((days * dayMinutes) / 60 - meetingHours) * 10) / 10), meetingHours };
  }

  async function personKpis(viewer: KpiViewer, userId: string, ask: PeriodAsk): Promise<PersonKpis> {
    const { scope, projectIds, unprojected, person } = await personScope(viewer, userId);
    const { at, today, weekStart, period } = await periodFor(ask);
    const kind = period.kind === 'week' ? 'week' : 'month';
    const points = trendPoints(kind, today, weekStart);
    const projects = await deps.source.projects(projectIds);
    const ids = projects.map((p) => p.id);
    const inScope = new Set(ids);
    const liveStart = await liveStartFor(ids, today);
    const liveMonth = liveStart.slice(0, 7);
    // Only what this person's KPIs need (review I7): their tasks, approvals and conversations.
    const facts = await deps.engine.load(projects, zonedStartOfDay(period.from < liveStart ? period.from : liveStart, tz), at, { people: true, actionItemsOf: [userId], unprojected, onlyPerson: userId });
    const w = windowOf(period.from, period.to, tz, at);
    const mine = sumPeople(deps.engine.counts(facts, w), userId, inScope);
    const periodFrom = zonedStartOfDay(period.from, tz);
    const periodEnd = zonedStartOfDay(shiftDayKey(period.end, 1), tz);
    const [openTasks, planned, cap, targets] = await Promise.all([
      deps.source.openTaskCounts([userId], ids),
      deps.planned.plannedHours(userId, scope === 'manager' ? ids : null, periodFrom, periodEnd),
      capacity(userId, person.companyId, period, scope === 'manager' ? ids : null),
      targetsFor(person.companyId, null),
    ]);
    const workload = { openTasks: openTasks.get(userId) ?? 0, plannedHours: planned === null ? null : Math.round(planned * 10) / 10, capacityHours: cap.capacityHours, meetingHours: cap.meetingHours };
    const workloadPct = planned === null || cap.capacityHours <= 0 ? null : (planned / cap.capacityHours) * 100;
    const figures = userFigures(mine.counters, { responses: mine.responses, actionItems: mine.actionItems, workload: workloadPct });

    // Trend: the person's stored rows in the projects counted (and without a project for themselves and
    // administrators), then the live part.
    const live = slicesOf(liveStart, today, weekStart).map((s) => ({ s, x: sumPeople(deps.engine.counts(facts, windowOf(s.day, s.end, tz, at)), userId, inScope) }));
    const stored = await deps.snapshots.read({ projectIds: unprojected ? [...ids, ''] : ids, userId, ...(kind === 'month' ? { months: points.map((x) => x.key) } : { weekStarts: points.map((x) => x.key) }) });
    const trend = points.map((pt) => {
      const rows: SnapshotRow[] = stored.filter((r) => r.month < liveMonth && (kind === 'month' ? r.month === pt.key : r.weekStart === pt.key));
      const lives = live.filter((x) => (kind === 'month' ? x.s.month === pt.key : x.s.weekStart === pt.key));
      if (rows.length === 0 && lives.length === 0) return { rebuilt: false, figures: null as ReturnType<typeof userFigures> | null };
      // Point in time: the rows of the point's last slice (no row there = nothing open then).
      const summed = sumSlices(rows, lastSliceDay(kind, pt.key, weekStart));
      let c = summed.counters;
      const responses = [...summed.responses];
      let actionItems = summed.actionItems;
      for (const l of lives) {
        c = { ...addCounters(c, l.x.counters) };
        responses.push(...l.x.responses);
        actionItems += l.x.actionItems;
      }
      return { rebuilt: summed.rebuilt, figures: userFigures(c, { responses, actionItems, workload: pt.current ? workloadPct : null }) };
    });

    return {
      person: { id: person.id, name: person.name, avatarUrl: person.avatarUrl, active: person.active },
      scope,
      projects: projects.map(projectOf),
      period,
      today,
      timeZone: tz,
      generatedAt: at.toISOString(),
      trend: { kind, points: points.map((pt, i) => ({ ...pt, rebuilt: trend[i]!.rebuilt })) },
      tiles: USER_METRICS.map((m) =>
        tile(m, figures[m as keyof typeof figures] as number | null, targets, personDetail(m, mine.counters, { responses: mine.responses.length, workload }), trend.map((t) => (t.figures ? (t.figures[m as keyof typeof t.figures] as number | null) : null))),
      ),
      workload,
    };
  }

  async function personItems(viewer: KpiViewer, userId: string, metric: string, ask: PeriodAsk): Promise<KpiItems> {
    const m = listedMetric(metric, 'user');
    const { projectIds, unprojected } = await personScope(viewer, userId);
    const { at, period } = await periodFor(ask);
    const projects = await deps.source.projects(projectIds);
    const facts = await deps.engine.load(projects, zonedStartOfDay(period.from, tz), at, { people: m === 'actionItems', actionItemsOf: [userId], unprojected, onlyPerson: userId });
    const w = windowOf(period.from, period.to, tz, at);
    return itemsAnswer(m, itemsFor(m, facts, w, { personId: userId, now: at }), projects);
  }

  // ── Targets (owner 3) ────────────────────────────────────────────────────

  type TargetEntry = { metric: MetricKey; label: string; unit: Unit; direction: 'higher' | 'lower'; builtIn: number | null; target: number | null; amberBand: number | null; source: TargetSource; own: boolean };

  function targetEntries(resolved: ResolvedTargets, ownSource: TargetSource): TargetEntry[] {
    return TARGET_METRICS.map((m) => {
      const t = resolved[m];
      return { metric: m, label: METRIC[m].label, unit: METRIC[m].unit, direction: METRIC[m].direction, builtIn: DEFAULT_TARGETS[m], target: t.target, amberBand: t.amberBand, source: t.source, own: t.source === ownSource };
    });
  }

  async function companyTargets(companyId: string | null) {
    const companies = await deps.companies();
    if (companyId && !companies.some((c) => c.id === companyId)) throw new NotFoundError('Company not found.');
    return { companies, companyId, metrics: targetEntries(await targetsFor(companyId, null), companyId ? 'company' : 'site') };
  }

  async function projectTargets(projectId: string) {
    const p = await projectRow(projectId);
    return { projectId, companyId: p.companyId, metrics: targetEntries(await targetsFor(p.companyId, p.id), 'project') };
  }

  /** Validated target changes: a number (or none: "no target here"), an own band, or back to the level up. */
  function cleanTargets(input: unknown): { set: { metric: string; target: number | null; amberBand: number | null }[]; clear: string[] } {
    if (!Array.isArray(input) || input.length > TARGET_METRICS.length) throw new ValidationError('Send the targets as a list.');
    const set: { metric: string; target: number | null; amberBand: number | null }[] = [];
    const clear: string[] = [];
    for (const raw of input) {
      const e = raw as { metric?: unknown; target?: unknown; amberBand?: unknown; inherit?: unknown };
      if (typeof e?.metric !== 'string' || !(TARGET_METRICS as readonly string[]).includes(e.metric)) throw new ValidationError('That KPI can’t have a target.');
      if (e.inherit === true) {
        clear.push(e.metric);
        continue;
      }
      const num = (v: unknown, what: string, min: number) => {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > 1_000_000) throw new ValidationError(`${METRIC[e.metric as MetricKey].label}: the ${what} must be a number from ${min} up.`);
        return Math.round(v * 100) / 100;
      };
      set.push({ metric: e.metric, target: num(e.target, 'target', e.metric === 'progress' ? 1 : 0), amberBand: num(e.amberBand, 'amber band', 0) });
    }
    return { set, clear };
  }

  async function saveCompanyTargets(viewer: KpiViewer, companyId: string | null, input: unknown) {
    const companies = await deps.companies();
    if (companyId && !companies.some((c) => c.id === companyId)) throw new NotFoundError('Company not found.');
    const { set, clear } = cleanTargets(input);
    await deps.targets.save(companyId ? `company:${companyId}` : 'site', set, clear, viewer.id);
    return companyTargets(companyId);
  }

  async function saveProjectTargets(viewer: KpiViewer, projectId: string, input: unknown) {
    await assertManage(viewer, projectId);
    const { set, clear } = cleanTargets(input);
    await deps.targets.save(`project:${projectId}`, set, clear, viewer.id);
    return projectTargets(projectId);
  }

  // ── A project's own KPIs ─────────────────────────────────────────────────

  const MAX_CUSTOM = 20;
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

  async function assertManage(viewer: KpiViewer, projectId: string): Promise<KpiProjectRow> {
    const p = await projectRow(projectId);
    if (!(await deps.access.canManageProject(viewer.id, viewer.roles, projectId))) throw new ForbiddenError('Only whoever runs this project and administrators can change its KPIs.');
    return p;
  }

  function cleanCustom(input: unknown, partial: boolean) {
    const b = (input ?? {}) as Record<string, unknown>;
    const out: { name?: string; unit?: string; direction?: CustomDirection; target?: number | null; amberBand?: number | null } = {};
    if (!partial || b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name || name.length > 80) throw new ValidationError('Name: 1–80 characters.', { field: 'name' });
      out.name = name;
    }
    if (!partial || b.unit !== undefined) {
      const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
      if (unit.length > 24) throw new ValidationError('Unit: at most 24 characters.', { field: 'unit' });
      out.unit = unit;
    }
    if (!partial || b.direction !== undefined) {
      if (b.direction !== 'HIGHER' && b.direction !== 'LOWER') throw new ValidationError('Say whether higher or lower is better.', { field: 'direction' });
      out.direction = b.direction;
    }
    const num = (v: unknown, field: string, min: number | null) => {
      if (v === null || v === '') return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e12 || (min !== null && v < min)) throw new ValidationError(field === 'amberBand' ? 'Amber band: a number from 0 up.' : 'Target: a number.', { field });
      return v;
    };
    if (!partial || b.target !== undefined) out.target = b.target === undefined ? null : num(b.target, 'target', null);
    if (!partial || b.amberBand !== undefined) out.amberBand = b.amberBand === undefined ? null : num(b.amberBand, 'amberBand', 0);
    return out;
  }

  async function customOf(projectId: string, kpiId: string): Promise<CustomKpi> {
    const k = await deps.custom.get(kpiId);
    if (!k || k.projectId !== projectId) throw new NotFoundError('KPI not found.');
    return k;
  }

  async function customAnswer(projectId: string): Promise<CustomKpiView[]> {
    return (await customViews([projectId], todayKey(tz, now()))).get(projectId) ?? [];
  }

  async function addCustom(viewer: KpiViewer, projectId: string, input: unknown) {
    await assertManage(viewer, projectId);
    if ((await deps.custom.count(projectId)) >= MAX_CUSTOM) throw new ValidationError(`A project can have at most ${MAX_CUSTOM} of its own KPIs.`);
    const c = cleanCustom(input, false) as Required<ReturnType<typeof cleanCustom>>;
    await deps.custom.create(projectId, { name: c.name, unit: c.unit, direction: c.direction, target: c.target, amberBand: c.amberBand }, viewer.id);
    return customAnswer(projectId);
  }

  async function editCustom(viewer: KpiViewer, projectId: string, kpiId: string, input: unknown) {
    await assertManage(viewer, projectId);
    await customOf(projectId, kpiId);
    await deps.custom.update(kpiId, cleanCustom(input, true));
    return customAnswer(projectId);
  }

  async function removeCustom(viewer: KpiViewer, projectId: string, kpiId: string) {
    await assertManage(viewer, projectId);
    await customOf(projectId, kpiId);
    await deps.custom.remove(kpiId);
    return customAnswer(projectId);
  }

  async function setCustomValue(viewer: KpiViewer, projectId: string, kpiId: string, month: string, input: unknown) {
    await assertManage(viewer, projectId);
    await customOf(projectId, kpiId);
    if (!MONTH.test(month) || month > todayKey(tz, now()).slice(0, 7)) throw new ValidationError('Choose this month or an earlier one.', { field: 'month' });
    const b = (input ?? {}) as { value?: unknown; note?: unknown };
    if (typeof b.value !== 'number' || !Number.isFinite(b.value) || Math.abs(b.value) > 1e12) throw new ValidationError('Value: a number.', { field: 'value' });
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
    if (note && note.length > 500) throw new ValidationError('Note: at most 500 characters.', { field: 'note' });
    await deps.custom.setValue(kpiId, month, b.value, note, viewer.id);
    return customAnswer(projectId);
  }

  async function clearCustomValue(viewer: KpiViewer, projectId: string, kpiId: string, month: string) {
    await assertManage(viewer, projectId);
    await customOf(projectId, kpiId);
    if (!MONTH.test(month)) throw new ValidationError('Choose a month.', { field: 'month' });
    await deps.custom.clearValue(kpiId, month);
    return customAnswer(projectId);
  }

  return {
    projectKpis,
    projectItems,
    managementKpis,
    managementPages,
    personKpis,
    personItems,
    personScope,
    companyTargets,
    saveCompanyTargets,
    projectTargets,
    saveProjectTargets,
    addCustom,
    editCustom,
    removeCustom,
    setCustomValue,
    clearCustomValue,
  };
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export const DEFAULT_MANAGEMENT_FILTERS: ManagementFiltersLite = { projectIds: [], ownerId: null, statuses: [...DEFAULT_STATUSES] };

export type KpiService = ReturnType<typeof createKpiService>;
