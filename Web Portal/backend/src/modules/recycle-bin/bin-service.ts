import { ForbiddenError, NotFoundError } from '../../lib/http-errors';
import { readTaskNumber } from '../../lib/task-number';
import { normalizeForSearch } from '../search/text-normalize';
import { binDaysLeft, effectiveExpiry, mayEraseNow, mayRestore } from './bin-rules';
import type { BinDetail, BinnedTask, BinPerson, BinProject, BinRow, BinStore } from './bin-store';

/** Who is asking. */
export interface BinViewer {
  id: string;
  roles: string[];
}

/** The bin page's search, filters, sort and page (every one optional). */
export interface BinListQuery {
  /** A task number, or words of its title or description. */
  q?: string;
  projectId?: string;
  /** Who deleted it; 'unknown' for tasks deleted before the bin recorded it. */
  deletedById?: string;
  /** Deleted on or after this day (YYYY-MM-DD, company days). */
  deletedFrom?: string;
  /** Deleted on or before this day. */
  deletedTo?: string;
  /** Only those with 7 days or less left. */
  soon?: boolean;
  /** A site with several companies: only this company's projects. */
  companyId?: string;
  /** daysLeft: fewest days left first; deleted (default): newest deleted first. */
  sort?: 'daysLeft' | 'deleted';
  limit?: number;
  offset?: number;
}

/** One row of the bin, as the page shows it. */
export interface BinRowView {
  id: string;
  key: string;
  title: string;
  project: BinProject;
  status: { name: string; category: string };
  deletedAt: Date;
  /** Null: not recorded (deleted before the Recycle Bin) — "Unknown". */
  deletedBy: BinPerson | null;
  binExpiresAt: Date;
  daysLeft: number;
  assignees: BinPerson[];
  /** Deleted together with others (a whole series): how many of them are still in the bin. */
  batch: { id: string; size: number } | null;
}

export interface BinPage {
  rows: BinRowView[];
  total: number;
  offset: number;
  limit: number;
  /** What the filters can offer: the projects and the people who deleted something (in this person's bin). */
  facets: { projects: BinProject[]; deleters: (BinPerson | { id: 'unknown'; name: string })[] };
  /** May this person delete tasks forever (admins)? */
  canErase: boolean;
}

/** The bin facts the read-only view adds to a deleted task. */
export interface BinFacts {
  deletedAt: Date;
  deletedBy: BinPerson | null;
  binExpiresAt: Date;
  daysLeft: number;
  batch: { id: string; size: number } | null;
  canRestore: boolean;
  canErase: boolean;
}

export type BinDetailView = Omit<BinDetail, 'blockers'> & { blockers: { key: string; title: string }[]; bin: BinFacts };

/** A task that wasn't restored or erased, and why (a task the person can't see says only "not found"). */
export interface BinRefusal {
  id: string;
  key?: string;
  title?: string;
  reason: 'not_found' | 'archived';
  message: string;
}

export interface RestoreResult {
  restored: { id: string; key: string; title: string; projectId: string }[];
  notRestored: BinRefusal[];
}

export interface EraseResult {
  erased: { id: string; key: string; title: string }[];
  notErased: BinRefusal[];
}

/** An audit log line (audit-service's record). */
export interface BinAuditEntry {
  userId: string | null;
  module: string;
  action: string;
  entityId: string;
  newValue: unknown;
  ip?: string | null;
}

/** A history line on the task (activity-service's record). */
export interface BinActivityEntry {
  taskId: string;
  projectId: string;
  userId: string;
  action: string;
  meta?: unknown;
}

export interface BinServiceDeps {
  store: BinStore;
  timeZone: string;
  now?: () => Date;
  /**
   * An administrator's list scope in the picked company (projectAccess.accessibleProjectIds: null for
   * every project; a pick, or "Show my projects only", narrows it like every list).
   */
  adminScope(viewer: BinViewer, pick: string | null): Promise<string[] | null>;
  /** Is this project archived (its own status, or all its companies)? */
  isArchived(projectId: string): Promise<boolean>;
  /** May this person see the project (its people: "This task was deleted")? */
  canViewProject(viewer: BinViewer, projectId: string): Promise<boolean>;
  /** Remove an erased task's file from disk. */
  removeFile?(storageKey: string): Promise<void>;
  audit?(entry: BinAuditEntry): Promise<void>;
  record?(entry: BinActivityEntry): Promise<void>;
  /** After tasks were restored: tell their people, refresh search, show them on open boards. */
  onRestored?(tasks: BinnedTask[], actor: BinViewer): Promise<void>;
  /** A step after the change itself failed (logged; the change stands). */
  onError?(err: unknown, what: string, taskId?: string): void;
}

/** Plain words for the bin's refusals. */
export const BIN_WORDS = {
  notAllowed: 'The Recycle Bin is for administrators and the people who run a project.',
  eraseAdminsOnly: 'Only administrators can delete tasks forever.',
  notInBin: 'It isn’t in the Recycle Bin any more.',
  archived: 'Its project is archived. Unarchive the project first, then restore the task.',
  notFound: 'Task not found.',
} as const;

/** At most this many in one restore or erase (the routes take at most 200 ids). */
export const MAX_BIN_IDS = 200;
/** A whole series restored at once brings back at most this many of its tasks (the rest stay in the bin). */
export const MAX_BATCH_RESTORE = 1000;
/** The sweep erases this many at a time, and at most this many batches in one run. */
const SWEEP_BATCH = 25;
const SWEEP_MAX_BATCHES = 40;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const isAdmin = (v: BinViewer) => v.roles.includes('ADMIN');
/** "YYYY-MM-DD" → that day's key, for comparing with a company day; anything else → undefined. */
const dayKey = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export function createBinService(deps: BinServiceDeps) {
  const { store, timeZone } = deps;
  const now = deps.now ?? (() => new Date());
  const fail = (what: string, taskId?: string) => (err: unknown) => deps.onError?.(err, what, taskId);

  /** May this person see and restore this deleted task? */
  async function mayRestoreTask(viewer: BinViewer, t: BinnedTask): Promise<boolean> {
    return mayRestore({ isAdmin: isAdmin(viewer), runsProject: isAdmin(viewer) || (await store.runsProject(viewer.id, t.projectId)) });
  }

  /** The projects whose deleted tasks this person sees, in the picked company (null: every one). */
  async function scopeOf(viewer: BinViewer, pick: string | null): Promise<string[] | null> {
    if (isAdmin(viewer)) return deps.adminScope(viewer, pick);
    if (!(await store.runsAny(viewer.id))) throw new ForbiddenError(BIN_WORDS.notAllowed);
    return store.runProjectIds(viewer.id, pick);
  }

  const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

  function matches(row: BinRow, q: string): boolean {
    const number = readTaskNumber(q);
    if (number) {
      const keys = [row.key, ...row.formerKeys];
      if (number.keys.length && keys.some((k) => number.keys.includes(k.toUpperCase()))) return true;
      if (number.number && keys.some((k) => k.endsWith(`-${number.number}`))) return true;
    }
    const words = normalizeForSearch(q).split(' ').filter(Boolean);
    if (words.length === 0) return true;
    const text = `${normalizeForSearch(row.key)} ${normalizeForSearch(row.title)} ${normalizeForSearch(row.description)}`;
    return words.every((w) => text.includes(w));
  }

  async function list(viewer: BinViewer, pick: string | null, query: BinListQuery): Promise<BinPage> {
    const scope = await scopeOf(viewer, pick);
    const all = await store.list(scope);
    const at = now();
    const expiry = (r: BinRow) => effectiveExpiry({ deletedAt: r.deletedAt, binExpiresAt: r.binExpiresAt }, timeZone);
    const daysLeft = (r: BinRow) => binDaysLeft(expiry(r), timeZone, at);
    // The filters' choices come from everything this person can see in the bin, whatever is filtered.
    const deleterIds = [...new Set(all.map((r) => r.deletedById).filter((id): id is string => !!id))];
    const people = new Map((await store.people(deleterIds)).map((p) => [p.id, p]));
    const projects = [...new Map(all.map((r) => [r.project.id, r.project])).values()].sort((a, b) => a.name.localeCompare(b.name));
    const deleters: BinPage['facets']['deleters'] = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (all.some((r) => !r.deletedById)) deleters.push({ id: 'unknown', name: 'Unknown' });

    const from = dayKey(query.deletedFrom);
    const to = dayKey(query.deletedTo);
    const q = (query.q ?? '').trim();
    const shown = all.filter((r) => {
      if (query.projectId && r.project.id !== query.projectId) return false;
      if (query.companyId && !r.companyIds.includes(query.companyId)) return false;
      if (query.deletedById === 'unknown' ? r.deletedById !== null : query.deletedById && r.deletedById !== query.deletedById) return false;
      const day = dayOf(r.deletedAt);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (query.soon && daysLeft(r) > 7) return false;
      return !q || matches(r, q);
    });
    if (query.sort === 'daysLeft') shown.sort((a, b) => expiry(a).getTime() - expiry(b).getTime() || b.deletedAt.getTime() - a.deletedAt.getTime());
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
    const page = shown.slice(offset, offset + limit);
    const sizes = await store.batchSizes([...new Set(page.map((r) => r.deleteBatchId).filter((b): b is string => !!b))]);
    return {
      rows: page.map((r) => ({
        id: r.id,
        key: r.key,
        title: r.title,
        project: r.project,
        status: r.status,
        deletedAt: r.deletedAt,
        deletedBy: r.deletedById ? (people.get(r.deletedById) ?? null) : null,
        binExpiresAt: expiry(r),
        daysLeft: daysLeft(r),
        assignees: r.assignees,
        batch: r.deleteBatchId && (sizes.get(r.deleteBatchId) ?? 0) > 1 ? { id: r.deleteBatchId, size: sizes.get(r.deleteBatchId)! } : null,
      })),
      total: shown.length,
      offset,
      limit,
      facets: { projects, deleters },
      canErase: mayEraseNow({ isAdmin: isAdmin(viewer) }),
    };
  }

  /** Who deleted it, when, how long is left, and what this person may do: the banner's facts. */
  async function factsOf(viewer: BinViewer, t: BinnedTask): Promise<BinFacts> {
    const expiresAt = effectiveExpiry(t, timeZone);
    const [deleter] = t.deletedById ? await store.people([t.deletedById]) : [];
    const size = t.deleteBatchId ? ((await store.batchSizes([t.deleteBatchId])).get(t.deleteBatchId) ?? 0) : 0;
    return {
      deletedAt: t.deletedAt,
      deletedBy: deleter ?? null,
      binExpiresAt: expiresAt,
      daysLeft: binDaysLeft(expiresAt, timeZone, now()),
      batch: t.deleteBatchId && size > 1 ? { id: t.deleteBatchId, size } : null,
      canRestore: true,
      canErase: mayEraseNow({ isAdmin: isAdmin(viewer) }),
    };
  }

  /** A deleted task, read-only, for someone who may restore it; anyone else: not found. */
  async function detail(viewer: BinViewer, taskId: string): Promise<BinDetailView> {
    const t = await store.find(taskId);
    if (!t || !(await mayRestoreTask(viewer, t))) throw new NotFoundError(BIN_WORDS.notFound);
    const d = await store.detail(taskId);
    if (!d) throw new NotFoundError(BIN_WORDS.notFound);
    // A blocker in a project this person can't open looks exactly like none (as on a live task).
    const blockers: { key: string; title: string }[] = [];
    for (const b of d.blockers) if (await deps.canViewProject(viewer, b.projectId)) blockers.push({ key: b.key, title: b.title });
    return { ...d, blockers, bin: await factsOf(viewer, t) };
  }

  /**
   * Restore deleted tasks (with `wholeBatch`, every task deleted together with each one — a whole
   * series). Each is checked on its own: one this person may not restore is "not found", one whose
   * project is archived waits for the project to be unarchived; the rest come back as they were.
   */
  async function restore(viewer: BinViewer, taskIds: string[], opts: { wholeBatch?: boolean; ip?: string | null } = {}): Promise<RestoreResult> {
    const notRestored: BinRefusal[] = [];
    const candidates = new Map<string, BinnedTask>();
    for (const id of [...new Set(taskIds)].slice(0, MAX_BIN_IDS)) {
      const t = await store.find(id);
      if (!t || !(await mayRestoreTask(viewer, t))) {
        notRestored.push({ id, reason: 'not_found', message: BIN_WORDS.notInBin });
        continue;
      }
      const group = opts.wholeBatch && t.deleteBatchId ? (await store.inBatch(t.deleteBatchId)).slice(0, MAX_BATCH_RESTORE) : [t];
      for (const g of group) if (!candidates.has(g.id) && (g.id === t.id || (await mayRestoreTask(viewer, g)))) candidates.set(g.id, g);
    }
    const restored: BinnedTask[] = [];
    const archived = new Map<string, boolean>();
    for (const t of candidates.values()) {
      if (!archived.has(t.projectId)) archived.set(t.projectId, await deps.isArchived(t.projectId));
      if (archived.get(t.projectId)) {
        notRestored.push({ id: t.id, key: t.key, title: t.title, reason: 'archived', message: BIN_WORDS.archived });
        continue;
      }
      if (await store.restore(t.id)) restored.push(t);
      else notRestored.push({ id: t.id, reason: 'not_found', message: BIN_WORDS.notInBin });
    }
    for (const t of restored) {
      await deps.record?.({ taskId: t.id, projectId: t.projectId, userId: viewer.id, action: 'RESTORED', meta: {} }).catch(fail('history line', t.id));
      await deps
        .audit?.({ userId: viewer.id, module: 'tasks', action: 'task.restored', entityId: t.id, newValue: { taskKey: t.key, title: t.title, projectId: t.projectId }, ip: opts.ip ?? null })
        .catch(fail('audit log line', t.id));
    }
    if (restored.length) await deps.onRestored?.(restored, viewer).catch(fail('after restoring'));
    return { restored: restored.map((t) => ({ id: t.id, key: t.key, title: t.title, projectId: t.projectId })), notRestored };
  }

  /** Erase one deleted task for good: its files too (when nothing else uses them), and the audit log line. */
  async function eraseOne(taskId: string, by: string | null, reason: string, ip: string | null = null) {
    const gone = await store.erase(taskId);
    if (!gone) return null;
    for (const file of gone.files) {
      try {
        if (!(await store.fileInUse(file))) await deps.removeFile?.(file);
      } catch (err) {
        fail('removing an erased task’s file', taskId)(err);
      }
    }
    await deps
      .audit?.({ userId: by, module: 'tasks', action: 'task.erased', entityId: gone.id, newValue: { taskKey: gone.key, title: gone.title, projectId: gone.projectId, reason }, ip })
      .catch(fail('audit log line', taskId));
    return gone;
  }

  /** Delete forever before the 60 days are up: administrators only. */
  async function erase(viewer: BinViewer, taskIds: string[], opts: { ip?: string | null } = {}): Promise<EraseResult> {
    if (!mayEraseNow({ isAdmin: isAdmin(viewer) })) throw new ForbiddenError(BIN_WORDS.eraseAdminsOnly);
    const erased: EraseResult['erased'] = [];
    const notErased: BinRefusal[] = [];
    for (const id of [...new Set(taskIds)].slice(0, MAX_BIN_IDS)) {
      const gone = (await store.find(id)) ? await eraseOne(id, viewer.id, 'Deleted forever from the Recycle Bin', opts.ip ?? null) : null;
      if (gone) erased.push({ id: gone.id, key: gone.key, title: gone.title });
      else notErased.push({ id, reason: 'not_found', message: BIN_WORDS.notInBin });
    }
    return { erased, notErased };
  }

  /**
   * The nightly erase: deleted tasks whose 60 days are over, a few at a time. One that can't be erased
   * (logged) is left for the next run and never holds up the ones after it. How many went.
   */
  async function sweep(): Promise<number> {
    let count = 0;
    const failed: string[] = [];
    for (let i = 0; i < SWEEP_MAX_BATCHES; i++) {
      const due = await store.due(now(), SWEEP_BATCH, failed);
      if (due.length === 0) break;
      for (const id of due) {
        try {
          if (await eraseOne(id, null, 'Recycle Bin, 60 days')) count++;
        } catch (err) {
          failed.push(id);
          fail('erasing a task after 60 days', id)(err);
        }
      }
    }
    return count;
  }

  /** After a delete: the history line on each task and the audit log's (who, which task). */
  async function deleted(e: { actorId: string; taskIds: string[]; batchId: string | null; ip?: string | null }): Promise<void> {
    const facts = await store.facts(e.taskIds);
    for (const t of facts) {
      await deps.record?.({ taskId: t.id, projectId: t.projectId, userId: e.actorId, action: 'DELETED', meta: e.taskIds.length > 1 ? { batch: e.taskIds.length } : {} }).catch(fail('history line', t.id));
      await deps
        .audit?.({ userId: e.actorId, module: 'tasks', action: 'task.deleted', entityId: t.id, newValue: { taskKey: t.key, title: t.title, projectId: t.projectId, ...(e.batchId ? { batchId: e.batchId } : {}) }, ip: e.ip ?? null })
        .catch(fail('audit log line', t.id));
    }
  }

  /**
   * Someone opened a task that is in the bin (an old notice, an email link): its project's people are
   * told it was deleted; anyone else learns nothing (null — the plain "not found").
   */
  async function noticeFor(viewer: BinViewer, taskId: string): Promise<'TASK_DELETED' | null> {
    const t = await store.find(taskId);
    if (!t) return null;
    return (await deps.canViewProject(viewer, t.projectId)) ? 'TASK_DELETED' : null;
  }

  return { list, detail, restore, erase, sweep, deleted, noticeFor };
}

export type BinService = ReturnType<typeof createBinService>;
