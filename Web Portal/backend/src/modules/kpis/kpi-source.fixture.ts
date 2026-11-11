/** An in-memory KpiSource for tests: the same answers the Prisma source gives, from plain arrays. */
import type { BlockedTask, ClosedActionItem, ConversationItem, KpiPerson, KpiProjectRow, KpiSource, MeetingSpan } from './kpi-source';
import type { KpiTask } from './task-history';
import { isDoneNow } from './task-history';
import { effectiveWeight } from '../project-health/completion';

export interface MemoryKpiWorld {
  projects: KpiProjectRow[];
  tasks: KpiTask[];
  conversations?: ConversationItem[];
  actionItems?: ClosedActionItem[];
  blocked?: BlockedTask[];
  meetings?: MeetingSpan[];
  admins?: string[];
  people?: KpiPerson[];
}

export function projectRow(id: string, over: Partial<KpiProjectRow> = {}): KpiProjectRow {
  return {
    id,
    code: id.toUpperCase(),
    name: `Project ${id}`,
    color: '#8B1E1E',
    icon: null,
    imageUrl: null,
    status: 'ACTIVE',
    archived: false,
    ownerId: null,
    managerId: 'mgr',
    managerMemberIds: [],
    companyId: 'c1',
    startDate: null,
    targetDate: null,
    completionMode: 'COUNT',
    weights: { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 },
    ...over,
  };
}

export function createMemoryKpiSource(world: MemoryKpiWorld): KpiSource & { calls: string[] } {
  const calls: string[] = [];
  const ms = (d: Date) => d.getTime();
  return {
    calls,
    async projects(ids) {
      calls.push('projects');
      return world.projects.filter((p) => ids.includes(p.id));
    },
    async windowTasks(projectIds, from, to, opts) {
      calls.push('windowTasks');
      return world.tasks.filter(
        (t) => projectIds.includes(t.projectId) && (!opts?.onlyIds || opts.onlyIds.includes(t.id)) && ms(t.createdAt) < ms(to) && (t.removedAt ? ms(t.removedAt) >= ms(from) : t.completedAt === null || ms(t.completedAt) >= ms(from)),
      );
    },
    async personTaskIds(userId, projectIds) {
      calls.push('personTaskIds');
      return world.tasks
        .filter((t) => projectIds.includes(t.projectId) && (t.assignees.some((a) => a.userId === userId) || t.events.some((e) => ((e.meta as { assigneeId?: unknown } | null)?.assigneeId === userId) || ((e.action === 'APPROVED' || e.action === 'SENT_BACK') && e.userId === userId))))
        .map((t) => t.id);
    },
    async tasksById(ids) {
      return world.tasks.filter((t) => ids.includes(t.id));
    },
    async doneBefore(projectIds, before) {
      const out = new Map<string, { projectId: string; done: number; weightDone: number }>();
      for (const t of world.tasks) {
        if (!projectIds.includes(t.projectId) || !t.completedAt || ms(t.completedAt) >= ms(before) || ms(t.createdAt) >= ms(before)) continue;
        const p = world.projects.find((x) => x.id === t.projectId)!;
        const row = out.get(t.projectId) ?? { projectId: t.projectId, done: 0, weightDone: 0 };
        row.done += 1;
        row.weightDone += effectiveWeight(t, p.weights);
        out.set(t.projectId, row);
      }
      return [...out.values()];
    },
    async conversations(projectIds, from, to) {
      const inProject = new Set(world.tasks.filter((t) => projectIds.includes(t.projectId)).map((t) => t.id));
      return (world.conversations ?? []).filter((c) => inProject.has(c.taskId) && ms(c.at) >= ms(from) && ms(c.at) < ms(to));
    },
    async closedActionItems(userIds, projectIds, from, to) {
      return (world.actionItems ?? []).filter(
        (a) => (!userIds || userIds.includes(a.assigneeId)) && (!projectIds || (a.projectId !== null && projectIds.includes(a.projectId))) && ms(a.completedAt) >= ms(from) && ms(a.completedAt) < ms(to),
      );
    },
    async blocked(projectIds) {
      return (world.blocked ?? []).filter((b) => projectIds.includes(b.projectId));
    },
    async meetings(userId, from, to, projectIds) {
      return (world.meetings ?? []).filter((m) => m.userId === userId && ms(m.startAt) >= ms(from) && ms(m.startAt) < ms(to) && (!projectIds || projectIds.includes((m as { projectId?: string }).projectId ?? '')));
    },
    async openTaskCounts(userIds, projectIds) {
      const out = new Map<string, number>();
      for (const t of world.tasks) {
        if (isDoneNow(t) || t.approvalRequestedAt || (projectIds && !projectIds.includes(t.projectId))) continue;
        for (const a of t.assignees) if (userIds.includes(a.userId)) out.set(a.userId, (out.get(a.userId) ?? 0) + 1);
      }
      return out;
    },
    async adminIds() {
      return world.admins ?? [];
    },
    async people(ids) {
      return (world.people ?? []).filter((p) => ids.includes(p.id));
    },
  };
}
