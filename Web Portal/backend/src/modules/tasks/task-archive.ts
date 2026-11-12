import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import { PROJECT_ARCHIVED_CODE, PROJECT_ARCHIVED_MESSAGE, TASK_ARCHIVED_CODE, TASK_ARCHIVED_MESSAGE, TaskArchivedError } from '../companies/archive-guard';

export { TASK_ARCHIVED_CODE, TaskArchivedError };

/**
 * Task archive (bulk lane; owner, 10 Nov 2026: "hide but keep"). An archived task is read-only and hidden
 * from boards, lists, My Tasks, the calendar, the Timeline, reminders, open counts and the daily email;
 * it is still found by search, in reports when asked and in its project's "Archived tasks" list, and
 * Unarchive brings it back. An archived Done task still counts as done in every figure; an archived open
 * task leaves them all.
 *
 * Administrators and the people who run a task's project archive and unarchive it — one task or many,
 * each checked on its own: a task the person can't open is "not found" (never named), a task of an
 * archived project waits until the project is reopened. The Recycle Bin is separate: an archived task can
 * be deleted, and restoring it brings it back archived.
 */

export const ARCHIVE_TASK_WORDS = {
  readOnly: TASK_ARCHIVED_MESSAGE,
  notAllowed: 'Only administrators and the people who run its project can archive or unarchive its tasks.',
  already: 'It is already archived.',
  notArchived: 'It isn’t archived.',
  notFound: 'Task not found.',
} as const;

export interface ArchiveActor {
  id: string;
  roles: string[];
}

/** A live task (not deleted or merged) as the archive reads it — archived or not. */
export interface ArchivableTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  archivedAt: Date | null;
}

export interface TaskArchivePorts {
  /** These live tasks (archived or not), any order; ids not found are left out. */
  find(ids: string[]): Promise<ArchivableTask[]>;
  canViewTask(actor: ArchiveActor, taskId: string): Promise<boolean>;
  /** Administrators, and the task's project's owner, named manager or a MANAGER member. */
  runsProject(actor: ArchiveActor, projectId: string): Promise<boolean>;
  isProjectArchived(projectId: string): Promise<boolean>;
  /**
   * Archive (`{ at, by }`) or unarchive (null) one task — only if it is not / is archived now, in the same
   * statement (false: it changed meanwhile, nothing written).
   */
  setArchived(taskId: string, value: { at: Date; by: string } | null): Promise<boolean>;
  recordActivity?: RecordTaskActivity;
  audit?: (entry: { userId: string; module: string; action: string; entityId: string | null; newValue: Record<string, unknown>; ip?: string | null }) => Promise<unknown>;
  /** After each change: its views (boards, search) hear it. Never fails the change. */
  onChanged?: (task: ArchivableTask, archived: boolean) => Promise<void>;
  onError?: (err: unknown, what: string) => void;
  now?: () => Date;
}

export interface ArchiveDone {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

/** A task that wasn't (or wouldn't be) changed, and why. `key`/`title` only for a task the person can open. */
export interface ArchiveRefusal {
  id: string;
  key?: string;
  title?: string;
  code: string;
  message: string;
}

export interface ArchiveResult {
  done: ArchiveDone[];
  refused: ArchiveRefusal[];
}

/** At most this many tasks in one request (the bulk route's cap). */
export const MAX_ARCHIVE_TASKS = 500;

export function createTaskArchiveService(ports: TaskArchivePorts) {
  const now = ports.now ?? (() => new Date());

  /** Each task's verdict: the ones that may change (`done`) and why the others may not. */
  async function plan(actor: ArchiveActor, taskIds: string[], archiving: boolean): Promise<ArchiveResult> {
    const ids = [...new Set(taskIds)].slice(0, MAX_ARCHIVE_TASKS);
    const byId = new Map((await ports.find(ids)).map((t) => [t.id, t]));
    const runs = new Map<string, boolean>();
    const closed = new Map<string, boolean>();
    const done: ArchiveDone[] = [];
    const refused: ArchiveRefusal[] = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (!t || !(await ports.canViewTask(actor, id))) {
        refused.push({ id, code: 'NOT_FOUND', message: ARCHIVE_TASK_WORDS.notFound });
        continue;
      }
      const named = { id, key: t.key, title: t.title };
      if (!runs.has(t.projectId)) runs.set(t.projectId, await ports.runsProject(actor, t.projectId));
      if (!runs.get(t.projectId)) {
        refused.push({ ...named, code: 'FORBIDDEN', message: ARCHIVE_TASK_WORDS.notAllowed });
        continue;
      }
      if (!closed.has(t.projectId)) closed.set(t.projectId, await ports.isProjectArchived(t.projectId));
      if (closed.get(t.projectId)) {
        refused.push({ ...named, code: PROJECT_ARCHIVED_CODE, message: PROJECT_ARCHIVED_MESSAGE });
        continue;
      }
      if (archiving && t.archivedAt) {
        refused.push({ ...named, code: 'ALREADY_ARCHIVED', message: ARCHIVE_TASK_WORDS.already });
        continue;
      }
      if (!archiving && !t.archivedAt) {
        refused.push({ ...named, code: 'NOT_ARCHIVED', message: ARCHIVE_TASK_WORDS.notArchived });
        continue;
      }
      done.push({ ...named, projectId: t.projectId });
    }
    return { done, refused };
  }

  async function change(actor: ArchiveActor, taskIds: string[], archiving: boolean, opts: { ip?: string | null } = {}): Promise<ArchiveResult> {
    const verdict = await plan(actor, taskIds, archiving);
    const at = now();
    const done: ArchiveDone[] = [];
    const refused = [...verdict.refused];
    for (const t of verdict.done) {
      if (!(await ports.setArchived(t.id, archiving ? { at, by: actor.id } : null))) {
        // Archived (or unarchived) by someone else at the same moment: nothing to do.
        refused.push({ id: t.id, key: t.key, title: t.title, code: archiving ? 'ALREADY_ARCHIVED' : 'NOT_ARCHIVED', message: archiving ? ARCHIVE_TASK_WORDS.already : ARCHIVE_TASK_WORDS.notArchived });
        continue;
      }
      done.push(t);
      await noteActivity(ports.recordActivity, { taskId: t.id, userId: actor.id, action: archiving ? 'ARCHIVED' : 'UNARCHIVED', meta: {} });
      try {
        await ports.onChanged?.({ ...t, archivedAt: archiving ? at : null }, archiving);
      } catch (err) {
        ports.onError?.(err, 'telling the views about an archived task');
      }
    }
    if (done.length) {
      try {
        await ports.audit?.({
          userId: actor.id,
          module: 'tasks',
          action: archiving ? 'task.archived' : 'task.unarchived',
          entityId: done.length === 1 ? done[0]!.id : null,
          newValue: { count: done.length, taskKeys: done.map((d) => d.key) },
          ip: opts.ip ?? null,
        });
      } catch (err) {
        ports.onError?.(err, 'the audit log line for archiving');
      }
    }
    return { done, refused };
  }

  return {
    plan,
    archive: (actor: ArchiveActor, taskIds: string[], opts?: { ip?: string | null }) => change(actor, taskIds, true, opts),
    unarchive: (actor: ArchiveActor, taskIds: string[], opts?: { ip?: string | null }) => change(actor, taskIds, false, opts),
  };
}

export type TaskArchiveService = ReturnType<typeof createTaskArchiveService>;
