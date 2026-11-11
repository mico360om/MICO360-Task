/**
 * Project KPIs and User KPIs — the snapshots behind the trends (calls 1 and 5 after the builder check):
 *   - Stored per slice (a week cut at a month's end), per project (its own row) and per person in it, as
 *     counters that add up — so a 12-week weekly trend and a 6-month monthly trend come from the same rows.
 *   - At launch the past six closed months are rebuilt from task dates and history (best effort; marked
 *     `rebuilt`, and so is every slice that started before the launch day).
 *   - Each night (from 01:00 company time) the last two closed months are worked out again, so a task
 *     binned, restored, merged or archived soon after shows in the trend; older months are frozen.
 *   - The current month is never stored: the pages count it live.
 * One instance runs it at a time (the server's lease lock); it works through the projects in chunks.
 */
import { todayKey, zonedStartOfDay, shiftDayKey } from '../../lib/due-date';
import { zonedClock } from '../../lib/working-days';
import { windowOf, type Counters } from './kpi-calc';
import { monthEnd, monthsBack, slicesOf, type Slice } from './kpi-defs';
import type { KpiEngine, PersonSlice, ProjectSlice } from './kpi-engine';
import type { KpiSource } from './kpi-source';
import type { SnapshotRow, SnapshotStore } from './kpi-stores';

export const SNAPSHOT_STATE_KEY = 'kpi.snapshots';
/** Closed months rebuilt at launch. */
export const REBUILD_MONTHS = 6;
/** Closed months worked out again each night. */
export const RECOMPUTE_MONTHS = 2;
/** The nightly run starts from this hour, company time. */
export const NIGHTLY_HOUR = 1;
const PROJECT_CHUNK = 20;

export interface SnapshotState {
  /** The first day the KPIs ran: slices before it are "rebuilt". */
  launchDay: string | null;
  rebuiltAt: string | null;
  lastNightlyDay: string | null;
  /** How long the launch rebuild took (ms) and for how many projects. */
  rebuildMs?: number;
  rebuildProjects?: number;
}

export interface SnapshotJobDeps {
  engine: KpiEngine;
  source: KpiSource;
  store: SnapshotStore;
  state: { get(): Promise<SnapshotState>; set(s: SnapshotState): Promise<void> };
  /** Every project not deleted (archived ones too: their history stays). */
  projectIds(): Promise<string[]>;
  /** The site's week start (KPI weeks). */
  weekStart(): Promise<number>;
  timeZone: string;
  now?: () => Date;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void };
  chunkSize?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const COUNTER_KEYS: (keyof Counters)[] = ['completed', 'dueDone', 'onTime', 'lateCount', 'lateDays', 'cycleCount', 'cycleDays', 'approvalCount', 'approvalHours', 'openDue', 'overdue'];

function projectMetrics(c: ProjectSlice): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of COUNTER_KEYS) out[k] = round2(c[k]);
  return { ...out, total: c.total, done: c.done, weightTotal: c.weightTotal, weightDone: c.weightDone, completionPct: c.completionPct, timeUsedPct: c.timeUsedPct, progress: c.progress };
}

function personMetrics(c: PersonSlice): Record<string, unknown> | null {
  const empty = COUNTER_KEYS.every((k) => c[k] === 0) && c.responses.length === 0 && c.actionItems === 0;
  if (empty) return null;
  const out: Record<string, unknown> = {};
  for (const k of COUNTER_KEYS) out[k] = round2(c[k]);
  return { ...out, responses: c.responses.map(round2), actionItems: c.actionItems };
}

/** Slices summed (counts add; the point-in-time figures are the last slice's). */
export function sumSlices(rows: readonly SnapshotRow[]): { counters: Counters; last: Record<string, unknown> | null; responses: number[]; actionItems: number; rebuilt: boolean; days: number } {
  const counters = Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0])) as unknown as Counters;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const responses: number[] = [];
  let actionItems = 0;
  let days = 0;
  for (const r of sorted) {
    const m = r.metrics;
    for (const k of COUNTER_KEYS) if (k !== 'openDue' && k !== 'overdue') counters[k] += Number(m[k] ?? 0);
    if (Array.isArray(m.responses)) responses.push(...(m.responses as unknown[]).map(Number));
    actionItems += Number(m.actionItems ?? 0);
  }
  // Point in time: the last slice's (summed over the rows of that day — several projects).
  const lastDay = sorted.at(-1)?.day;
  for (const r of sorted.filter((x) => x.day === lastDay)) {
    counters.openDue += Number(r.metrics.openDue ?? 0);
    counters.overdue += Number(r.metrics.overdue ?? 0);
  }
  const daysSeen = new Set<string>();
  for (const r of sorted) {
    if (daysSeen.has(r.day)) continue;
    daysSeen.add(r.day);
    days += Math.round((Date.parse(`${r.endDay}T12:00:00Z`) - Date.parse(`${r.day}T12:00:00Z`)) / 86_400_000) + 1;
  }
  return { counters, last: sorted.at(-1)?.metrics ?? null, responses, actionItems, rebuilt: sorted.some((r) => r.rebuilt), days };
}

export function createSnapshotJob(deps: SnapshotJobDeps) {
  const tz = deps.timeZone;
  const now = () => deps.now?.() ?? new Date();

  /** Work out and store these slices for every project. */
  async function compute(slices: Slice[], launchDay: string): Promise<{ projects: number }> {
    if (slices.length === 0) return { projects: 0 };
    const ids = await deps.projectIds();
    const size = deps.chunkSize ?? PROJECT_CHUNK;
    const from = zonedStartOfDay(slices[0]!.day, tz);
    const to = zonedStartOfDay(shiftDayKey(slices.at(-1)!.end, 1), tz);
    const at = now();
    const days = slices.map((s) => s.day);
    for (let i = 0; i < ids.length; i += size) {
      const projects = await deps.source.projects(ids.slice(i, i + size));
      if (projects.length === 0) continue;
      const facts = await deps.engine.load(projects, from, to, { people: true });
      const rows: SnapshotRow[] = [];
      for (const s of slices) {
        const counts = deps.engine.counts(facts, windowOf(s.day, s.end, tz, at));
        const base = { day: s.day, endDay: s.end, weekStart: s.weekStart, month: s.month, rebuilt: s.day < launchDay };
        for (const [projectId, c] of counts.projects) rows.push({ ...base, projectId, userId: '', metrics: projectMetrics(c) });
        for (const [projectId, people] of counts.people) {
          if (!projectId) continue;
          for (const [userId, c] of people) {
            const m = personMetrics(c);
            if (m) rows.push({ ...base, projectId, userId, metrics: m });
          }
        }
      }
      await deps.store.replace(projects.map((p) => p.id), days, rows);
    }
    return { projects: ids.length };
  }

  /** The slices of these whole months. */
  async function monthSlices(months: string[]): Promise<Slice[]> {
    if (months.length === 0) return [];
    const ws = await deps.weekStart();
    return slicesOf(`${months[0]}-01`, monthEnd(months.at(-1)!), ws);
  }

  return {
    /** The launch rebuild when it hasn't run; else the nightly run once a day from 01:00; else nothing. */
    async run(): Promise<{ did: 'rebuild' | 'nightly' | 'nothing'; projects?: number; ms?: number }> {
      const at = now();
      const today = todayKey(tz, at);
      const state = await deps.state.get();
      const launchDay = state.launchDay ?? today;
      if (!state.rebuiltAt) {
        const started = Date.now();
        const months = monthsBack(today, REBUILD_MONTHS + 1).slice(0, REBUILD_MONTHS);
        const { projects } = await compute(await monthSlices(months), launchDay);
        const ms = Date.now() - started;
        await deps.state.set({ ...state, launchDay, rebuiltAt: at.toISOString(), lastNightlyDay: today, rebuildMs: ms, rebuildProjects: projects });
        deps.logger?.info('KPI snapshots: the past six months rebuilt', { projects, ms });
        return { did: 'rebuild', projects, ms };
      }
      if (state.lastNightlyDay === today || zonedClock(at, tz).minutes < NIGHTLY_HOUR * 60) return { did: 'nothing' };
      const started = Date.now();
      const months = monthsBack(today, RECOMPUTE_MONTHS + 1).slice(0, RECOMPUTE_MONTHS);
      const { projects } = await compute(await monthSlices(months), launchDay);
      await deps.state.set({ ...state, launchDay, lastNightlyDay: today });
      const ms = Date.now() - started;
      deps.logger?.info('KPI snapshots: the last two closed months worked out again', { projects, ms });
      return { did: 'nightly', projects, ms };
    },
    /** Rebuild the past six months now (the rehearsal's timing and an administrator's script). */
    async rebuild(): Promise<{ projects: number; ms: number }> {
      const at = now();
      const today = todayKey(tz, at);
      const state = await deps.state.get();
      const launchDay = state.launchDay ?? today;
      const started = Date.now();
      const months = monthsBack(today, REBUILD_MONTHS + 1).slice(0, REBUILD_MONTHS);
      const { projects } = await compute(await monthSlices(months), launchDay);
      const ms = Date.now() - started;
      await deps.state.set({ ...state, launchDay, rebuiltAt: at.toISOString(), lastNightlyDay: today, rebuildMs: ms, rebuildProjects: projects });
      return { projects, ms };
    },
  };
}

export type SnapshotJob = ReturnType<typeof createSnapshotJob>;
