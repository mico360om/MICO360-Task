/**
 * 1.23.5 Project overview & health — the Projects page cards, the project page's Overview tab and its
 * Next actions, from the one health rule (management healthFor + the health extras).
 *
 * Health is the same for everyone who may see a project (a task's access follows its project, and only
 * the project's own blockers count — ruling 4), so it is kept per project for 60 seconds and read again
 * after any change there (task, meeting, project or inspection events, blockers, project edits). Who may
 * see which project is decided by the routes before anything is asked here.
 */
import { todayKey } from '../../lib/due-date';
import type { HealthRow } from '../management/management-service';
import type { Rag, RagReason } from '../management/management-rules';
import { taskRow } from '../dashboard/prisma-priority-sources';
import type { Reason } from '../dashboard/priorities';
import type { PriorityRowData, TaskRowData } from '../dashboard/priority-sources';
import type { Completion, CompletionFigures } from './completion';
import type { HealthExtras } from './health-extras';
import { rankNextActions, type ActionCandidate, type ItemActionCandidate } from './next-actions';
import type { Risk } from './risks';

/** How long one project's health is kept (design: 60 s, refreshed on task changes). */
export const HEALTH_TTL_MS = 60_000;
/** At most this many next actions in one answer (the counts are the true totals). */
export const NEXT_ACTIONS_LIMIT = 300;
const CACHE_MAX = 5000;

export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CardHealth {
  rag: Rag;
  reasons: RagReason[];
  completion: Completion;
  /** The worst automatic risk, in one line; and how many there are. */
  topRisk: { code: Risk['code']; level: Risk['level']; title: string } | null;
  riskCount: number;
  /** Who is accountable: the project manager (named, else the first MANAGER member), else the owner. */
  accountable: (Person & { role: 'MANAGER' | 'OWNER' }) | null;
}

export interface ProjectHealthDetail {
  projectId: string;
  rag: Rag;
  reasons: RagReason[];
  completion: Completion & CompletionFigures;
  /** Share of the planned time used (null without a start and target date). */
  timeUsedPct: number | null;
  risks: (Omit<Risk, 'accountable' | 'taskIds'> & { accountable: Person[]; tasks: { id: string; key: string; title: string }[] })[];
  /** Accountable owners: the project owner, its managers, and each open milestone's owners. */
  owners: { owner: Person | null; managers: Person[]; milestones: { id: string; key: string; title: string; due: string | null; owners: Person[] }[] };
  generatedAt: string;
}

/** What the project page's Next actions read (the 1.23.4 list's shape, so its rows and quick actions are the same). */
export interface NextActionsAnswer {
  today: string;
  timeZone: string;
  manager: false;
  items: (PriorityRowData & { id: string; kind: 'task' | 'checklist-item'; reason: Reason; also: Reason[]; chips: never[]; group: number })[];
  total: number;
  counts: { all: number; overdue: number; today: number; approvals: number; blocked: number; upcoming: number; team: number };
  /** The project whose live events change the list. */
  watch: string[];
}

/**
 * 1.23.3 checklist items in Next actions (design call 4): the person's own assigned items of the project's
 * tasks, overdue or due soon (the Dashboard's checklist source, scoped to the project) — they never change
 * the health colour or the late counts. `checklist-item` candidates with `row.checklistItem`.
 */
export interface NextActionItemSource {
  collect(projectId: string, ctx: { today: string; timeZone: string }, viewer: { id: string; roles: string[] } | null): Promise<(ItemActionCandidate & { row: PriorityRowData })[]>;
}
export const NEXT_ACTION_ITEMS_STUB: NextActionItemSource = {
  async collect() {
    return [];
  },
};

export interface ProjectHealthDeps {
  /** The one rule for these projects (management healthFor), with the extras it used. */
  health(projectIds: string[]): Promise<{ rows: HealthRow[]; extras: Map<string, HealthExtras> }>;
  /** People's names and faces (deleted people left out). */
  people(ids: string[]): Promise<Person[]>;
  /** A project's Done columns in board order (a Complete moves to its first enabled one). */
  doneColumns(projectId: string): Promise<{ id: string; enabled: boolean }[]>;
  checklistItems?: NextActionItemSource;
  timeZone: string;
  now?: () => Date;
}

interface Entry {
  at: number;
  row: HealthRow;
  extras: HealthExtras | null;
}

const unique = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];

export function createProjectHealthService(deps: ProjectHealthDeps) {
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, Entry>();
  /** Bumped by every change: an answer read while its project (or everything) changed is used, not kept. */
  let generation = 0;
  let everythingChangedAt = -1;
  const changedAt = new Map<string, number>();

  async function entries(ids: string[], fresh = false): Promise<Map<string, Entry>> {
    const at = now().getTime();
    const out = new Map<string, Entry>();
    const stale: string[] = [];
    for (const id of unique(ids)) {
      const hit = cache.get(id);
      if (!fresh && hit && at - hit.at <= HEALTH_TTL_MS) out.set(id, hit);
      else stale.push(id);
    }
    if (stale.length) {
      const started = generation;
      const { rows, extras } = await deps.health(stale);
      for (const row of rows) {
        const entry: Entry = { at, row, extras: extras.get(row.id) ?? null };
        out.set(row.id, entry);
        // Something changed in this project while it was read (the generation moved past `started`): answer
        // with it, but don't keep it. A change logged before the read began (at `started` or earlier) is in it.
        if (Math.max(changedAt.get(row.id) ?? -1, everythingChangedAt) <= started) cache.set(row.id, entry);
      }
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
    return out;
  }

  async function peopleById(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
    const wanted = unique(ids);
    return new Map((wanted.length ? await deps.people(wanted) : []).map((p) => [p.id, p]));
  }

  function accountableOf(x: HealthExtras): { id: string; role: 'MANAGER' | 'OWNER' } | null {
    const p = x.project;
    if (p.managerId) return { id: p.managerId, role: 'MANAGER' };
    if (p.managerMemberIds[0]) return { id: p.managerMemberIds[0], role: 'MANAGER' };
    return p.ownerId ? { id: p.ownerId, role: 'OWNER' } : null;
  }

  return {
    /** The Projects page: each project's mark, reasons, completion, worst risk and accountable person. */
    async cards(projectIds: string[]): Promise<Map<string, CardHealth>> {
      const got = await entries(projectIds);
      const who = new Map([...got].map(([id, e]) => [id, e.extras ? accountableOf(e.extras) : null]));
      const people = await peopleById([...who.values()].map((w) => w?.id));
      const out = new Map<string, CardHealth>();
      for (const [id, e] of got) {
        const top = e.extras?.risks[0] ?? null;
        const w = who.get(id);
        const person = w ? people.get(w.id) : undefined;
        out.set(id, {
          rag: e.row.rag,
          reasons: e.row.reasons,
          completion: e.extras ? { mode: e.extras.completion.mode, pct: e.extras.completion.pct, countPct: e.extras.completion.countPct, weightPct: e.extras.completion.weightPct } : { mode: 'COUNT', pct: e.row.completionPct, countPct: e.row.completionPct, weightPct: e.row.completionPct },
          topRisk: top ? { code: top.code, level: top.level, title: top.title } : null,
          riskCount: e.extras?.risks.length ?? 0,
          accountable: person && w ? { ...person, role: w.role } : null,
        });
      }
      return out;
    },

    /** The project page's Overview: health with every reason, completion both ways, every risk, the accountable owners. */
    async detail(projectId: string): Promise<ProjectHealthDetail | null> {
      const e = (await entries([projectId])).get(projectId);
      if (!e || !e.extras) return null;
      const x = e.extras;
      const p = x.project;
      const managerIds = unique([p.managerId, ...p.managerMemberIds]);
      const people = await peopleById([p.ownerId, ...managerIds, ...x.risks.flatMap((r) => r.accountable), ...x.milestones.flatMap((m) => m.ownerIds)]);
      const named = (ids: string[]) => ids.map((id) => people.get(id)).filter((q): q is Person => !!q);
      const titles = new Map(x.actions.map((a) => [a.id, { id: a.id, key: a.task.key, title: a.task.title }]));
      for (const m of x.milestones) titles.set(m.id, { id: m.id, key: m.key, title: m.title });
      return {
        projectId,
        rag: e.row.rag,
        reasons: e.row.reasons,
        completion: x.completion,
        timeUsedPct: x.timeUsedPct,
        risks: x.risks.map(({ accountable, taskIds, ...r }) => ({ ...r, accountable: named(accountable), tasks: taskIds.map((id) => titles.get(id)).filter((t): t is { id: string; key: string; title: string } => !!t) })),
        owners: {
          owner: p.ownerId ? people.get(p.ownerId) ?? null : null,
          managers: named(managerIds),
          milestones: x.milestones.map((m) => ({ id: m.id, key: m.key, title: m.title, due: m.due, owners: named(m.ownerIds) })),
        },
        generatedAt: new Date(e.at).toISOString(),
      };
    },

    /**
     * The project's Next actions, in the 1.23.4 order, as Dashboard rows (with its quick actions). Nothing
     * may be done on an archived or completed project (only Open). `fresh`: after the person's own change.
     */
    async nextActions(projectId: string, opts: { fresh?: boolean; viewer?: { id: string; roles: string[] } } = {}): Promise<NextActionsAnswer | null> {
      const e = (await entries([projectId], opts.fresh)).get(projectId);
      if (!e || !e.extras) return null;
      const x = e.extras;
      const today = todayKey(deps.timeZone, now());
      const ctx = { today, timeZone: deps.timeZone };
      const [done, items] = await Promise.all([deps.doneColumns(projectId), (deps.checklistItems ?? NEXT_ACTION_ITEMS_STUB).collect(projectId, ctx, opts.viewer ?? null)]);
      const doneColumnId = (done.find((c) => c.enabled) ?? done[0])?.id ?? null;
      const readOnly = x.project.archived || x.project.status === 'ARCHIVED' || x.project.status === 'COMPLETED';
      const p = x.project;
      const rowOf = new Map<string, PriorityRowData>();
      for (const a of x.actions) {
        const row: TaskRowData = taskRow(
          { id: a.id, key: a.task.key, title: a.task.title, priority: a.task.priority, dueDate: a.task.dueDate, startDate: a.task.startDate, version: a.task.version, columnId: a.task.columnId, recurrenceRule: a.task.recurrenceRule, project: { id: p.id, code: p.code, name: p.name, color: p.color, icon: p.icon, imageUrl: p.imageUrl } },
          deps.timeZone,
          { assignees: a.task.assignees, blockers: a.blockers, doneColumnId },
        );
        rowOf.set(`task:${a.id}`, { task: readOnly ? { ...row, can: { complete: false, reschedule: false, assign: false, approve: false } } : row });
      }
      for (const i of items) rowOf.set(`checklist-item:${i.id}`, readOnly ? { ...i.row, ...(i.row.checklistItem ? { checklistItem: { ...i.row.checklistItem, can: { tick: false, reschedule: false } } } : {}) } : i.row);
      const candidates: ActionCandidate[] = [...x.actions, ...items];
      const ranked = rankNextActions(candidates, ctx);
      const count = (codes: Reason['code'][]) => ranked.filter((r) => codes.includes(r.reason.code)).length;
      return {
        today,
        timeZone: deps.timeZone,
        manager: false,
        items: ranked.slice(0, NEXT_ACTIONS_LIMIT).map((r) => {
          const id = `${r.candidate.kind}:${r.candidate.id}`;
          return { id, kind: r.candidate.kind, reason: r.reason, also: r.also, chips: [], group: r.group, ...rowOf.get(id) };
        }),
        total: ranked.length,
        counts: {
          all: ranked.length,
          overdue: count(['overdue']),
          today: count(['due-today']),
          approvals: 0,
          blocked: count(['blocked-status', 'blocked-by']),
          upcoming: count(['due-soon']),
          team: count(['unassigned']),
        },
        watch: [projectId],
      };
    },

    /** Something changed in a project (or, without one, anywhere): its health is read again. */
    changed(projectId?: string | null): void {
      generation += 1;
      if (!projectId) {
        cache.clear();
        changedAt.clear();
        everythingChangedAt = generation;
        return;
      }
      cache.delete(projectId);
      changedAt.set(projectId, generation);
      while (changedAt.size > CACHE_MAX) changedAt.delete(changedAt.keys().next().value as string);
    },
  };
}

export type ProjectHealthService = ReturnType<typeof createProjectHealthService>;
