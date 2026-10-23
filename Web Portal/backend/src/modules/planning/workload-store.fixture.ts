import type { WorkloadStore } from './workload-service';
import type { Priority } from './workload';

/** A small in-memory company for the Workload service's tests: no scoping of its own, as the real store. */
export interface FakeCompany {
  users: { id: string; name: string; active?: boolean }[];
  projects: { id: string; name?: string; status?: string; ownerId?: string | null; managerId?: string | null }[];
  members: { projectId: string; userId: string; role?: 'MEMBER' | 'MANAGER' }[];
  tasks: { id: string; projectId: string; due: string | Date; assignees: string[]; open?: boolean; priority?: Priority; key?: string; version?: number }[];
}

const LIVE = (s?: string) => s !== 'COMPLETED' && s !== 'ARCHIVED';
const dueOf = (due: string | Date) => (due instanceof Date ? due : new Date(`${due}T00:00:00.000Z`));

export function fakeWorkloadStore(c: FakeCompany): WorkloadStore & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  const log = (name: string, args: unknown) => calls.push({ name, args });
  const active = (id: string) => c.users.find((u) => u.id === id)?.active !== false && c.users.some((u) => u.id === id);
  const live = (id: string) => LIVE(c.projects.find((p) => p.id === id)?.status);
  const open = c.tasks.filter((t) => t.open !== false);
  return {
    calls,
    async managedProjectIds(userId) {
      log('managedProjectIds', userId);
      return c.projects
        .filter((p) => LIVE(p.status) && (p.managerId === userId || p.ownerId === userId || c.members.some((m) => m.projectId === p.id && m.userId === userId && m.role === 'MANAGER')))
        .map((p) => p.id);
    },
    async liveProjects(ids) {
      log('liveProjects', ids);
      return c.projects
        .filter((p) => LIVE(p.status) && (!ids || ids.includes(p.id)))
        .map((p) => ({ id: p.id, code: p.id.toUpperCase(), name: p.name ?? p.id, color: '#000000', icon: null, imageUrl: null, ownerId: p.ownerId ?? null, managerId: p.managerId ?? null }));
    },
    async members(projectIds) {
      log('members', projectIds);
      return c.members.filter((m) => projectIds.includes(m.projectId) && active(m.userId)).map(({ projectId, userId }) => ({ projectId, userId }));
    },
    async activeUsers(ids) {
      log('activeUsers', ids);
      return c.users.filter((u) => u.active !== false && (!ids || ids.includes(u.id))).map((u) => ({ id: u.id, name: u.name, avatarUrl: null }));
    },
    async openTasks({ projectIds, assigneeIds, from, to }) {
      log('openTasks', { projectIds, assigneeIds, from, to });
      return open
        .filter((t) => projectIds.includes(t.projectId) && dueOf(t.due) >= from && dueOf(t.due) < to && t.assignees.some((a) => assigneeIds.includes(a)))
        .map((t) => ({ id: t.id, key: t.key ?? t.id.toUpperCase(), title: t.id, projectId: t.projectId, dueDate: dueOf(t.due), priority: t.priority ?? 'NORMAL', isMilestone: false, version: t.version ?? 1, assigneeIds: t.assignees }));
    },
    async overdueCounts({ projectIds, userIds, before }) {
      log('overdueCounts', { projectIds, userIds, before });
      const counts = new Map<string, number>();
      for (const t of open) {
        if (!projectIds.includes(t.projectId) || dueOf(t.due) >= before) continue;
        for (const a of t.assignees) if (userIds.includes(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      return [...counts].map(([userId, count]) => ({ userId, count }));
    },
    async openDue({ projectIds, userIds, windows }) {
      log('openDue', { projectIds, userIds, windows });
      return open
        .filter((t) => (projectIds ? projectIds.includes(t.projectId) : live(t.projectId)) && windows.some((w) => dueOf(t.due) >= w.from && dueOf(t.due) < w.to))
        .flatMap((t) => t.assignees.filter((a) => userIds.includes(a) && active(a)).map((userId) => ({ userId, dueDate: dueOf(t.due) })));
    },
  };
}
