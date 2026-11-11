/**
 * Project KPIs and User KPIs — the engine: reads a window's facts once (kpi-source) and counts any window
 * inside it (kpi-calc). The live figures, the drill-down lists and the stored snapshots all come through
 * here, so they agree. Each project counts with its own company's working days, holidays and hours.
 */
import type { WorkCalendar, WorkHours } from '../../lib/working-days';
import { zonedDayKey } from '../../lib/due-date';
import { completionOf } from '../project-health/completion';
import { timeUsedPct } from '../project-health/health-facts';
import { countResponses, countWindow, emptyCounters, progressRatio, type CalcContext, type CalcWindow, type Conversation, type Counters, type ProjectCalc, type ProjectCounters } from './kpi-calc';
import type { ClosedActionItem, KpiProjectRow, KpiSource } from './kpi-source';
import type { KpiTask } from './task-history';

/** Prompts this long before a window can still be answered inside it. */
export const PROMPT_LOOKBACK_DAYS = 30;
const ADMIN_TTL_MS = 5 * 60_000;
const DEFAULT_CAL: WorkCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
const DEFAULT_HOURS: WorkHours = { start: '08:00', end: '17:00' };

export interface CompanyRulesLite {
  calendar: WorkCalendar;
  hours: WorkHours;
}

export interface KpiEngineDeps {
  source: KpiSource;
  timeZone: string;
  /** A company's working days, holidays and hours (Notification & Scheduling); null: the site's. */
  rules(companyId: string | null): Promise<CompanyRulesLite>;
  now?: () => Date;
}

export interface Facts {
  from: Date;
  to: Date;
  projects: Map<string, KpiProjectRow>;
  tasks: KpiTask[];
  conversations: Conversation[];
  actionItems: ClosedActionItem[];
  /** Tasks completed before `from` (made before it), per project. */
  doneBefore: Map<string, { done: number; weightDone: number }>;
  ctx: CalcContext;
}

export interface ProjectSlice extends ProjectCounters {
  completionPct: number;
  timeUsedPct: number | null;
  progress: number | null;
}

export interface PersonSlice extends Counters {
  responses: number[];
  actionItems: number;
}

export interface SliceCounts {
  projects: Map<string, ProjectSlice>;
  /** projectId ('' for action items without a project) → userId → counters. */
  people: Map<string, Map<string, PersonSlice>>;
}

export function createKpiEngine(deps: KpiEngineDeps) {
  const { source, timeZone } = deps;
  let admins: { at: number; ids: Set<string> } | null = null;

  async function adminSet(): Promise<Set<string>> {
    const at = Date.now();
    if (!admins || at - admins.at > ADMIN_TTL_MS) admins = { at, ids: new Set(await source.adminIds()) };
    return admins.ids;
  }

  async function contextFor(projects: KpiProjectRow[]): Promise<CalcContext> {
    const adminIds = await adminSet();
    const companies = [...new Set(projects.map((p) => p.companyId))];
    const rules = new Map<string | null, CompanyRulesLite>();
    for (const c of companies) rules.set(c, await deps.rules(c).catch(() => ({ calendar: DEFAULT_CAL, hours: DEFAULT_HOURS })));
    const byId = new Map<string, ProjectCalc>();
    for (const p of projects) {
      const r = rules.get(p.companyId)!;
      const runners = new Set([p.ownerId, p.managerId, ...p.managerMemberIds].filter((x): x is string => !!x));
      byId.set(p.id, { calendar: r.calendar, hours: r.hours, weights: p.weights, rules: { isAdmin: (u) => adminIds.has(u), runsProject: (u) => runners.has(u) } });
    }
    const fallback: ProjectCalc = { calendar: DEFAULT_CAL, hours: DEFAULT_HOURS, weights: { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 }, rules: { isAdmin: (u) => adminIds.has(u), runsProject: () => false } };
    return { timeZone, project: (id) => byId.get(id) ?? fallback };
  }

  /**
   * The facts of these projects from `from` to `to`. `people`: also comments and status changes (update
   * responsiveness) and closed action items (of these projects, and without one when `unprojected`).
   * `onlyPerson` (review I7): only what one person's KPIs need — the tasks they were ever on or decided,
   * and the conversations on those tasks or @mentioning them; no project completion.
   */
  async function load(projects: KpiProjectRow[], from: Date, to: Date, opts: { people?: boolean; actionItemsOf?: string[] | null; unprojected?: boolean; onlyPerson?: string } = {}): Promise<Facts> {
    const ids = projects.map((p) => p.id);
    const onlyIds = opts.onlyPerson ? await source.personTaskIds(opts.onlyPerson, ids, new Date(from.getTime() - PROMPT_LOOKBACK_DAYS * 86_400_000)) : null;
    const [tasks, doneBefore, ctx] = await Promise.all([
      onlyIds ? (onlyIds.length ? source.windowTasks(ids, from, to, { onlyIds }) : Promise.resolve([])) : source.windowTasks(ids, from, to),
      onlyIds ? Promise.resolve([]) : source.doneBefore(ids, from),
      contextFor(projects),
    ]);
    let conversations: Conversation[] = [];
    let actionItems: ClosedActionItem[] = [];
    if (opts.people && ids.length) {
      const lookback = new Date(from.getTime() - PROMPT_LOOKBACK_DAYS * 86_400_000);
      const mine = onlyIds ? new Set(onlyIds) : null;
      const items = (await source.conversations(ids, lookback, to)).filter((i) => !mine || !opts.onlyPerson || mine.has(i.taskId) || i.mentions.includes(opts.onlyPerson));
      const byTask = new Map(tasks.map((t) => [t.id, t]));
      const missing = [...new Set(items.map((i) => i.taskId))].filter((id) => !byTask.has(id));
      for (const t of missing.length ? await source.tasksById(missing) : []) byTask.set(t.id, t);
      const grouped = new Map<string, Conversation>();
      for (const it of items) {
        const task = byTask.get(it.taskId);
        if (!task) continue;
        let c = grouped.get(task.id);
        if (!c) grouped.set(task.id, (c = { task, items: [] }));
        c.items.push({ at: it.at, userId: it.userId, kind: it.kind, mentions: it.mentions });
      }
      conversations = [...grouped.values()];
    }
    if (opts.people && (ids.length || opts.unprojected)) {
      const inScope = new Set(ids);
      actionItems = (await source.closedActionItems(opts.actionItemsOf ?? null, opts.unprojected ? null : ids, from, to)).filter((a) => (a.projectId ? inScope.has(a.projectId) : !!opts.unprojected));
    }
    return {
      from,
      to,
      projects: new Map(projects.map((p) => [p.id, p])),
      tasks,
      conversations,
      actionItems,
      doneBefore: new Map(doneBefore.map((d) => [d.projectId, { done: d.done, weightDone: d.weightDone }])),
      ctx,
    };
  }

  /** Every counter of a window inside the facts' span. */
  function counts(f: Facts, w: CalcWindow): SliceCounts {
    const base = countWindow(f.tasks, w, f.ctx);
    const endDay = zonedDayKey(new Date(w.to.getTime() - 1), timeZone);
    const projects = new Map<string, ProjectSlice>();
    for (const p of f.projects.values()) {
      const c = base.projects.get(p.id) ?? { ...emptyCounters(), total: 0, done: 0, weightTotal: 0, weightDone: 0 };
      const before = f.doneBefore.get(p.id) ?? { done: 0, weightDone: 0 };
      const figures = { total: c.total + before.done, done: c.done + before.done, weightTotal: c.weightTotal + before.weightDone, weightDone: c.weightDone + before.weightDone };
      const completionPct = completionOf(figures, p.completionMode).pct;
      const used = timeUsedPct(p.startDate, p.targetDate, endDay, timeZone);
      projects.set(p.id, { ...c, ...figures, completionPct, timeUsedPct: used, progress: progressRatio(completionPct, used) });
    }
    const people = new Map<string, Map<string, PersonSlice>>();
    const person = (projectId: string, userId: string): PersonSlice => {
      let m = people.get(projectId);
      if (!m) people.set(projectId, (m = new Map()));
      let c = m.get(userId);
      if (!c) m.set(userId, (c = { ...emptyCounters(), responses: [], actionItems: 0 }));
      return c;
    };
    for (const [projectId, m] of base.people) for (const [userId, c] of m) Object.assign(person(projectId, userId), c);
    for (const [projectId, m] of countResponses(f.conversations, w, f.ctx)) for (const [userId, hours] of m) person(projectId, userId).responses.push(...hours);
    for (const a of f.actionItems) if (a.completedAt.getTime() >= w.from.getTime() && a.completedAt.getTime() < w.to.getTime()) person(a.projectId ?? '', a.assigneeId).actionItems += 1;
    return { projects, people };
  }

  return { load, counts, contextFor, now: () => deps.now?.() ?? new Date() };
}

export type KpiEngine = ReturnType<typeof createKpiEngine>;
