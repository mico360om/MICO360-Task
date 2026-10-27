import { dueDayKey } from '../../lib/due-date';
import { fakeWorkloadStore } from '../planning/workload-store.fixture';
import type { ProjectStatus } from './management-rules';
import type { ManagementSource, MgmtProject, TaskLine } from './management-source';

/** A small in-memory company for the Management service's tests: plain reads, no scoping of its own (as the real source). */
export interface FakeManagementData {
  users: { id: string; name: string; active?: boolean }[];
  projects: { id: string; name: string; status: ProjectStatus; ownerId?: string | null; managerId?: string | null; managers?: string[]; members?: string[]; deleted?: boolean; updatedAt?: Date }[];
  tasks: {
    id: string;
    projectId: string;
    title?: string;
    due?: string | null;
    /** Finished at this moment (else open). */
    completedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    milestone?: boolean;
    /** Carries an inspection form: a check. */
    formId?: string | null;
    /** A finished inspection is linked (checks). */
    report?: boolean;
    /** A follow-up task made from a failed item. */
    followUp?: boolean;
    assignees?: string[];
    deleted?: boolean;
  }[];
  inspections: {
    id: string;
    projectId: string;
    formId: string | null;
    title: string;
    finishedAt: string;
    passed: number;
    failed: number;
    failedItems?: string[];
    structure?: unknown;
    place?: string | null;
  }[];
  actions: { id: string; projectId: string; assigneeId: string | null; due?: string | null; open?: boolean; meetingId?: string | null; description?: string }[];
}

const at = (v: string | Date) => (v instanceof Date ? v : new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v));
const TZ = 'Asia/Muscat';

export function fakeManagementSource(d: FakeManagementData): ManagementSource & { calls: string[] } {
  const calls: string[] = [];
  const live = d.projects.filter((p) => !p.deleted);
  const tasks = d.tasks.filter((t) => !t.deleted && live.some((p) => p.id === t.projectId));
  const isOpen = (t: FakeManagementData['tasks'][number]) => !t.completedAt;
  const due = (t: FakeManagementData['tasks'][number]) => (t.due ? at(t.due) : null);
  const lateOn = (t: FakeManagementData['tasks'][number], today: string) => isOpen(t) && (dueDayKey(due(t), TZ) ?? '9999') < today;
  const nameOf = (id: string) => d.users.find((u) => u.id === id)?.name ?? id;
  const runs = (p: (typeof live)[number], userId: string) => p.ownerId === userId || p.managerId === userId || (p.managers ?? []).includes(userId);
  const toProject = (p: (typeof live)[number]): MgmtProject => ({
    id: p.id,
    code: p.id.toUpperCase(),
    name: p.name,
    status: p.status,
    color: '#8B1E1E',
    icon: null,
    imageUrl: null,
    ownerId: p.ownerId ?? null,
    managerId: p.managerId ?? null,
    updatedAt: p.updatedAt ?? new Date('2026-10-26T08:00:00.000Z'),
  });
  const line = (t: FakeManagementData['tasks'][number]): TaskLine => ({
    id: t.id,
    key: t.id.toUpperCase(),
    title: t.title ?? t.id,
    projectId: t.projectId,
    dueDate: due(t),
    completedAt: t.completedAt ? at(t.completedAt) : null,
    columnCategory: t.completedAt ? 'DONE' : 'TODO',
    isMilestone: !!t.milestone,
    assignees: (t.assignees ?? []).map(nameOf),
  });
  const byDue = (a: TaskLine, b: TaskLine) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0) || a.key.localeCompare(b.key);
  const finished = (ids: string[], from: Date, to: Date) => d.inspections.filter((i) => ids.includes(i.projectId) && at(i.finishedAt) >= from && at(i.finishedAt) < to);

  return {
    calls,
    async projects(runBy) {
      calls.push(`projects:${runBy ?? 'all'}`);
      return live.filter((p) => runBy === null || runs(p, runBy)).map(toProject);
    },
    async runCount(userId) {
      return live.filter((p) => runs(p, userId)).length;
    },
    async people(ids) {
      return d.users.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, name: u.name, avatarUrl: null }));
    },
    async taskFigures(ids, today) {
      calls.push('taskFigures');
      return ids
        .map((projectId) => {
          const mine = tasks.filter((t) => t.projectId === projectId);
          const updates = mine.map((t) => at(t.updatedAt ?? '2026-10-20T08:00:00.000Z').getTime());
          return {
            projectId,
            total: mine.length,
            done: mine.filter((t) => !isOpen(t)).length,
            open: mine.filter(isOpen).length,
            late: mine.filter((t) => lateOn(t, today)).length,
            lastTaskUpdate: updates.length ? new Date(Math.max(...updates)) : null,
          };
        })
        .filter((f) => f.total > 0);
    },
    async openMilestones(ids) {
      return tasks.filter((t) => ids.includes(t.projectId) && t.milestone && isOpen(t)).map((t) => ({ id: t.id, key: t.id.toUpperCase(), title: t.title ?? t.id, projectId: t.projectId, dueDate: due(t) }));
    },
    async checks(ids, w) {
      return tasks
        .filter((t) => ids.includes(t.projectId) && t.formId)
        .filter((t) => {
          const dd = due(t);
          const done = t.completedAt ? at(t.completedAt) : null;
          return (dd && dd >= w.dueFrom && dd < w.dueTo) || (isOpen(t) && dd && dd < w.openBefore) || (done && w.doneFrom && w.doneTo && done >= w.doneFrom && done < w.doneTo);
        })
        .map((t) => ({ id: t.id, projectId: t.projectId, dueDate: due(t), completedAt: t.completedAt ? at(t.completedAt) : null, columnCategory: t.completedAt ? 'DONE' : 'TODO', hasReport: !!t.report }));
    },
    async finishedInspections(ids, from, to) {
      return finished(ids, from, to).map((i) => ({ id: i.id, projectId: i.projectId, formId: i.formId, title: i.title, place: i.place ?? null, taskId: null, finishedAt: at(i.finishedAt), passed: i.passed, failed: i.failed }));
    },
    async failedItems(ids, from, to, limit) {
      const counts = new Map<string, { formId: string | null; itemId: string; failures: number; sampleId: string }>();
      for (const i of finished(ids, from, to)) {
        for (const itemId of i.failedItems ?? []) {
          const key = `${i.formId}|${itemId}`;
          const c = counts.get(key) ?? { formId: i.formId, itemId, failures: 0, sampleId: i.id };
          c.failures += 1;
          counts.set(key, c);
        }
      }
      return [...counts.values()].sort((a, b) => b.failures - a.failures || a.itemId.localeCompare(b.itemId)).slice(0, limit);
    },
    async structures(ids) {
      return d.inspections.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, title: i.title, structure: i.structure ?? { sections: [] } }));
    },
    async openFollowUps(ids) {
      const out = new Map<string, number>();
      for (const t of tasks) if (ids.includes(t.projectId) && t.followUp && isOpen(t)) out.set(t.projectId, (out.get(t.projectId) ?? 0) + 1);
      return [...out].map(([projectId, count]) => ({ projectId, count }));
    },
    async lateByPerson(ids, today) {
      const out = new Map<string, number>();
      for (const t of tasks) {
        if (!ids.includes(t.projectId) || !lateOn(t, today)) continue;
        for (const a of t.assignees ?? []) if (d.users.find((u) => u.id === a)?.active !== false) out.set(a, (out.get(a) ?? 0) + 1);
      }
      return [...out].map(([userId, count]) => ({ userId, count }));
    },
    async actionItems(ids, today) {
      const out = new Map<string, { userId: string; open: number; overdue: number }>();
      for (const a of d.actions) {
        if (!ids.includes(a.projectId) || a.open === false || !a.assigneeId) continue;
        const r = out.get(a.assigneeId) ?? { userId: a.assigneeId, open: 0, overdue: 0 };
        r.open += 1;
        if (a.due && dueDayKey(at(a.due), TZ)! < today) r.overdue += 1;
        out.set(a.assigneeId, r);
      }
      return [...out.values()];
    },
    async trend(ids, buckets) {
      calls.push(`trend:${buckets.length}`);
      const mine = tasks.filter((t) => ids.includes(t.projectId));
      const created = buckets.map((b) => mine.filter((t) => t.createdAt && at(t.createdAt) >= b.from && at(t.createdAt) < b.to).length);
      const completed = buckets.map((b) => mine.filter((t) => t.completedAt && at(t.completedAt) >= b.from && at(t.completedAt) < b.to).length);
      const late = buckets.map(
        (b) =>
          mine.filter((t) => (!t.createdAt || at(t.createdAt) < b.lateAt) && !(t.completedAt && at(t.completedAt) < b.lateAt) && (dueDayKey(due(t), TZ) ?? '9999') < b.lateDay).length,
      );
      return { created, completed, late };
    },
    async lateTasks({ projectIds, today, personId, milestonesOnly, limit }) {
      const rows = tasks
        .filter((t) => projectIds.includes(t.projectId) && lateOn(t, today) && (!milestonesOnly || t.milestone) && (!personId || (t.assignees ?? []).includes(personId)))
        .map(line)
        .sort(byDue);
      return { total: rows.length, rows: rows.slice(0, limit) };
    },
    async tasksByIds(ids) {
      return tasks.filter((t) => ids.includes(t.id)).map(line);
    },
    async followUpTasks({ projectIds, limit }) {
      const rows = tasks.filter((t) => projectIds.includes(t.projectId) && t.followUp && isOpen(t)).map(line).sort(byDue);
      return { total: rows.length, rows: rows.slice(0, limit) };
    },
    async failedOccurrences({ projectIds, from, to, formId, itemId, limit }) {
      const rows = finished(projectIds, from, to)
        .filter((i) => i.formId === formId && (i.failedItems ?? []).includes(itemId))
        .sort((a, b) => at(b.finishedAt).getTime() - at(a.finishedAt).getTime())
        .map((i) => ({ inspectionId: i.id, title: i.title, place: i.place ?? null, projectId: i.projectId, finishedAt: at(i.finishedAt), note: null }));
      return { total: rows.length, rows: rows.slice(0, limit) };
    },
    async actionItemList({ projectIds, personId, limit }) {
      const rows = d.actions
        .filter((a) => projectIds.includes(a.projectId) && a.open !== false && (!personId || a.assigneeId === personId))
        .map((a) => ({
          id: a.id,
          description: a.description ?? a.id,
          projectId: a.projectId,
          meetingId: a.meetingId ?? null,
          meetingTitle: a.meetingId ? `Meeting ${a.meetingId}` : null,
          taskId: null,
          dueDate: a.due ? at(a.due) : null,
          status: 'OPEN',
          assigneeId: a.assigneeId,
          assigneeName: a.assigneeId ? nameOf(a.assigneeId) : null,
        }));
      return { total: rows.length, rows: rows.slice(0, limit) };
    },
  };
}

/** The same company for the Workload store (open tasks with due dates; members and leads of each project). */
export function fakeWorkloadFor(d: FakeManagementData) {
  return fakeWorkloadStore({
    users: d.users,
    projects: d.projects.filter((p) => !p.deleted).map((p) => ({ id: p.id, name: p.name, status: p.status, ownerId: p.ownerId ?? null, managerId: p.managerId ?? null })),
    members: d.projects.flatMap((p) => [...(p.members ?? []).map((userId) => ({ projectId: p.id, userId })), ...(p.managers ?? []).map((userId) => ({ projectId: p.id, userId, role: 'MANAGER' as const }))]),
    tasks: d.tasks
      .filter((t) => !t.deleted && t.due && (t.assignees ?? []).length > 0)
      .map((t) => ({ id: t.id, projectId: t.projectId, due: t.due!, assignees: t.assignees!, open: !t.completedAt })),
  });
}
