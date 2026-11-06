import { todayKey } from '../../lib/due-date';
import { chipCounts, rankPriorities, type Chip, type Reason } from './priorities';
import type { PriorityRowData, PrioritySource, PriorityViewer, SourcedCandidate } from './priority-sources';

/** The most rows one answer carries (most urgent first); the counts are always the true totals. */
export const PRIORITY_LIMIT = 300;
/** How long one person's answer is kept (design §Performance: 30 s, refreshed after changes). */
export const PRIORITY_TTL_MS = 30_000;
/** At most this many projects are listened to for live changes. */
export const WATCH_LIMIT = 100;
const CACHE_MAX = 2000;

export interface PriorityRow extends PriorityRowData {
  /** `${kind}:${its id}` — one row per thing. */
  id: string;
  kind: SourcedCandidate['kind'];
  reason: Reason;
  also: Reason[];
  chips: Chip[];
  group: number;
}

export interface PrioritiesAnswer {
  /** Today in the company time zone, and the zone. */
  today: string;
  timeZone: string;
  /** Runs at least one project, or is an administrator: the Team chip is offered. */
  manager: boolean;
  items: PriorityRow[];
  /** Every row there is (items holds the first PRIORITY_LIMIT). */
  total: number;
  counts: Record<'all' | Chip, number>;
  /** The projects whose live events change the list. */
  watch: string[];
}

export interface PrioritiesServiceDeps {
  sources: PrioritySource[];
  timeZone: string;
  /** Administrators and the people who run a project (the Team chip). */
  isManager: (viewer: PriorityViewer) => Promise<boolean>;
  now?: () => Date;
}

/**
 * 1.23.4 "My Priorities Today": every source's rows for one person, ranked as one list (priorities.ts),
 * cached for 30 s per person and picked company. Any change on the site (a task event, an action item)
 * clears the cache, and so does the person's own setting change; the page also asks fresh after its own
 * quick actions. A failing source fails the answer: an outage must never read as "nothing urgent".
 */
export function createPrioritiesService(deps: PrioritiesServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, { at: number; answer: PrioritiesAnswer }>();
  let generation = 0;

  const keyOf = (viewer: PriorityViewer, pick: string | null) => `${viewer.id}|${[...viewer.roles].sort().join(',')}|${pick ?? ''}`;

  async function compute(viewer: PriorityViewer, pick: string | null): Promise<PrioritiesAnswer> {
    const today = todayKey(deps.timeZone, now());
    const req = { viewer, pick, today, timeZone: deps.timeZone };
    const [manager, ...lists] = await Promise.all([deps.isManager(viewer), ...deps.sources.map((s) => s.collect(req))]);
    const all = (lists as SourcedCandidate[][]).flat();
    // A task (or a task waiting for approval) that is a row stands for the action items tracked as it.
    const taskIds = new Set(all.filter((c) => c.kind === 'task' || c.kind === 'approval').map((c) => c.id));
    const candidates = all.filter((c) => !(c.kind === 'action-item' && c.linkedTaskId && taskIds.has(c.linkedTaskId)));
    const ranked = rankPriorities(candidates, { today, timeZone: deps.timeZone });
    const watch = [...new Set(ranked.flatMap((r) => r.candidate.watch))].slice(0, WATCH_LIMIT);
    return {
      today,
      timeZone: deps.timeZone,
      manager,
      items: ranked.slice(0, PRIORITY_LIMIT).map((r) => ({ id: `${r.candidate.kind}:${r.candidate.id}`, kind: r.candidate.kind, reason: r.reason, also: r.also, chips: r.chips, group: r.group, ...r.candidate.row })),
      total: ranked.length,
      counts: chipCounts(ranked),
      watch,
    };
  }

  function prune(at: number): void {
    for (const [k, v] of cache) if (at - v.at > PRIORITY_TTL_MS) cache.delete(k);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }

  return {
    /** The person's list (from the cache when it is under 30 s old, unless `fresh`). */
    async get(viewer: PriorityViewer, pick: string | null, opts: { fresh?: boolean } = {}): Promise<PrioritiesAnswer> {
      const key = keyOf(viewer, pick);
      const at = now().getTime();
      const hit = cache.get(key);
      if (!opts.fresh && hit && at - hit.at <= PRIORITY_TTL_MS) return hit.answer;
      const started = generation;
      const answer = await compute(viewer, pick);
      // Something changed while it was read: answer with it, but don't keep it.
      if (generation === started) {
        cache.set(key, { at, answer });
        prune(at);
      }
      return answer;
    },
    /** Something on the site changed (a task event, an action item): everyone's list is read again. */
    changed(): void {
      generation += 1;
      cache.clear();
    },
    /** One person's own change (their "Show my projects only"): their lists are read again. */
    changedFor(userId: string): void {
      generation += 1;
      for (const k of [...cache.keys()]) if (k.startsWith(`${userId}|`)) cache.delete(k);
    },
  };
}

export type PrioritiesService = ReturnType<typeof createPrioritiesService>;
