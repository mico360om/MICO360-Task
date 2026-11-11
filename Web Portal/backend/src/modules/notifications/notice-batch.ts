import { AsyncLocalStorage } from 'node:async_hooks';
import type { CreateNotificationData } from './notification-repository';

/**
 * Bulk task changes (bulk lane; the lead's call after the builder check): ONE combined notice per person
 * per bulk action ("Sara assigned you 12 tasks in Rig 3"), not one per task — for the bell and the phone
 * push alike. While a bulk action runs inside `collectNotices`, every notice the single-task paths would
 * send (assigned, status, approvals …, each already limited to people who may open its task) is gathered
 * instead; `combineNotices` then makes one per person.
 */

interface Batch {
  notices: CreateNotificationData[];
}

const store = new AsyncLocalStorage<Batch>();

/** The notices gathered by the bulk action running now (undefined outside one). */
export function activeNoticeBatch(): CreateNotificationData[] | undefined {
  return store.getStore()?.notices;
}

/** Run `fn` gathering its notices instead of sending them. */
export async function collectNotices<T>(fn: () => Promise<T>): Promise<{ result: T; notices: CreateNotificationData[] }> {
  const batch: Batch = { notices: [] };
  const result = await store.run(batch, fn);
  return { result, notices: batch.notices };
}

/** Plain words for "N tasks" and where. */
const tasksWord = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

/** What the combined notice says each kind of notice was (its title), by notification type. */
const VERB: Record<string, string> = {
  TASK_ASSIGNED: 'assigned you',
  TASK_STATUS: 'changed the status of',
  TASK_APPROVAL: 'asked for approval on',
};

export interface CombineInput {
  /** Who made the bulk change ("Sara Al Balushi"). */
  actorName: string;
  /** A project's name by id (for "in Rig 3"). */
  projectName: (projectId: string) => string | undefined;
  /** The project of a task notice's task (for "in Rig 3"). */
  projectOf: (taskId: string) => string | undefined;
}

/**
 * One notice per person: someone told once gets that notice as it was; someone told several times gets one
 * that says how many tasks, in which project (when all in one), and names the first two. The type is the
 * one their notices share (else the most common one), so their notification settings still apply.
 */
export function combineNotices(notices: CreateNotificationData[], input: CombineInput): CreateNotificationData[] {
  const byUser = new Map<string, CreateNotificationData[]>();
  for (const n of notices) {
    const list = byUser.get(n.userId) ?? [];
    list.push(n);
    byUser.set(n.userId, list);
  }
  const out: CreateNotificationData[] = [];
  for (const [userId, list] of byUser) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    const taskIds = [...new Set(list.filter((n) => n.entityType === 'task' && n.entityId).map((n) => n.entityId!))];
    const count = taskIds.length || list.length;
    const types = new Map<string, number>();
    for (const n of list) types.set(n.type, (types.get(n.type) ?? 0) + 1);
    const type = [...types.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const verb = types.size === 1 ? (VERB[type] ?? 'changed') : 'changed';
    const projects = [...new Set(taskIds.map((id) => input.projectOf(id)).filter((p): p is string => !!p))];
    const one = projects.length === 1 ? projects[0]! : null;
    const where = one && input.projectName(one) ? ` in ${input.projectName(one)}` : projects.length > 1 ? ` in ${projects.length} projects` : '';
    const bodies = [...new Set(list.map((n) => n.body).filter((b): b is string => !!b))];
    const named = bodies.slice(0, 2).join('; ');
    const more = bodies.length > 2 ? ` and ${bodies.length - 2} more` : '';
    out.push({
      userId,
      type,
      title: `${input.actorName} ${verb} ${tasksWord(count)}${where}`,
      body: named ? `${named}${more}` : null,
      // One project: its page; several: no single thing to open (the notice says what happened).
      entityType: one ? 'project' : null,
      entityId: one,
      projectId: one,
    });
  }
  return out;
}
