import { createTaskService } from './task-service';
import { TaskVersionConflictError, type ColumnInfo, type CreateTaskData, type TaskRecord, type TaskRepository, type ProjectLookup } from './task-repository';
import type { ApprovalEvent } from './task-approval';

/** Tests only: a task service over memory, with approvals wired (two projects; Omar and an admin approve). */
// Project p1: To do, In progress, Review, Done. Project p2 has no Review column. Omar runs both.
export const COLUMNS: (ColumnInfo & { position: number; enabled: boolean })[] = [
  { id: 'todo', projectId: 'p1', category: 'TODO', position: 0, enabled: true },
  { id: 'doing', projectId: 'p1', category: 'IN_PROGRESS', position: 1, enabled: true },
  { id: 'rev', projectId: 'p1', category: 'REVIEW', position: 2, enabled: true },
  { id: 'done', projectId: 'p1', category: 'DONE', position: 3, enabled: true },
  { id: 'q-todo', projectId: 'p2', category: 'TODO', position: 0, enabled: true },
  { id: 'q-doing', projectId: 'p2', category: 'IN_PROGRESS', position: 1, enabled: true },
  { id: 'q-done', projectId: 'p2', category: 'DONE', position: 2, enabled: true },
  // Project p3 has nothing but a Done column.
  { id: 'z-done', projectId: 'p3', category: 'DONE', position: 0, enabled: true },
];
export const APPROVERS = new Set(['omar', 'admin']);
export const NOW = new Date('2026-10-30T08:00:00Z');

export function approvalWorld(settings: Record<string, { newTasksNeedApproval: boolean }> = {}, opts: { failMoved?: boolean; onError?: (err: unknown, taskId: string) => void } = {}) {
  const rows = new Map<string, TaskRecord>();
  let seq = 0;
  const cat = (id: string) => COLUMNS.find((c) => c.id === id)?.category ?? null;
  const withCategory = (t: TaskRecord): TaskRecord => ({ ...t, columnCategory: cat(t.columnId) });
  const tasks: TaskRepository = {
    async create(data: CreateTaskData) {
      const rec: TaskRecord = {
        id: `t${seq++}`, key: data.key, title: data.title, description: null, projectId: data.projectId, columnId: data.columnId, position: 0, priority: 'NORMAL',
        startDate: null, dueDate: null, estimatedHours: null, actualHours: null, progress: data.progress ?? 0, createdById: data.createdById, completedAt: data.completedAt ?? null,
        boardDate: data.boardDate ?? null, recurrenceRule: data.recurrenceRule ?? null, recurrenceParentId: null, version: 0, createdAt: NOW, updatedAt: NOW,
        needsApproval: data.needsApproval ?? false, approvalRequestedAt: data.approvalRequestedAt ?? null, approvalRequestedById: data.approvalRequestedById ?? null,
        approvedAt: data.approvedAt ?? null, approvedById: data.approvedById ?? null,
      };
      rows.set(rec.id, rec);
      return withCategory(rec);
    },
    async findById(id) {
      const t = rows.get(id);
      return t ? withCategory(t) : null;
    },
    async list() {
      return [...rows.values()].map(withCategory);
    },
    async update(id, patch, opts) {
      const cur = rows.get(id)!;
      if (opts?.expectedVersion !== undefined && cur.version !== opts.expectedVersion) throw new TaskVersionConflictError(id);
      const updated = { ...cur, ...patch, version: cur.version + 1 };
      rows.set(id, updated);
      return withCategory(updated);
    },
    async softDelete(id) { rows.delete(id); },
    async updateSeries() {},
    async softDeleteSeries() {},
    async countByProject(projectId) { return [...rows.values()].filter((t) => t.projectId === projectId).length; },
    async findColumn(columnId) {
      const c = COLUMNS.find((x) => x.id === columnId);
      return c ? { id: c.id, projectId: c.projectId, category: c.category } : null;
    },
    async reorderInColumn() {},
  };
  const projects: ProjectLookup = {
    async getCodeById(id) { return ({ p1: 'RIG', p2: 'OPS', p3: 'END' } as Record<string, string>)[id] ?? null; },
    async getTaskSettings(id) { return { defaultDueToday: false, ...(settings[id] ?? {}) }; },
  };
  const moved: { taskId: string; prev: string; actor?: string; approval?: ApprovalEvent; reason?: string }[] = [];
  const svc = createTaskService({
    tasks,
    projects,
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    approvals: {
      canApprove: async (userId) => APPROVERS.has(userId),
      columnsOf: async (projectId) => COLUMNS.filter((c) => c.projectId === projectId),
    },
    onError: opts.onError,
    onMoved: (task, prev, actor, extra) => {
      // A step after the decision that fails (a notice, the comment, the next copy).
      if (opts.failMoved && (extra?.approval === 'APPROVED' || extra?.approval === 'SENT_BACK')) throw new Error('the notices could not be written');
      moved.push({ taskId: task.id, prev, actor, ...(extra?.approval ? { approval: extra.approval } : {}), ...(extra?.reason ? { reason: extra.reason } : {}) });
    },
  });
  const make = (o: { projectId?: string; columnId?: string; needsApproval?: boolean; by?: string } = {}) =>
    svc.createTask({ title: 'Inspection report', projectId: o.projectId ?? 'p1', columnId: o.columnId ?? 'doing', createdById: o.by ?? 'sara', ...(o.needsApproval !== undefined ? { needsApproval: o.needsApproval } : {}) });
  return { svc, rows, moved, make };
}
