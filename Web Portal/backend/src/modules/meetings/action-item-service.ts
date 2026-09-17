import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type {
  ActionItemRepository,
  ActionItemRecord,
  ActionItemStatus,
  Priority,
  AssigneeListFilter,
} from './action-item-repository';

const STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const CLOSED: ActionItemStatus[] = ['COMPLETED', 'CANCELLED'];

/** An action item plus a computed `overdue` flag (past due and still actionable). */
export type ActionItemView = ActionItemRecord & { overdue: boolean };

export interface AddActionItemInput {
  description: string;
  assigneeId?: string | null;
  priority?: Priority;
  dueDate?: Date | null;
  agendaItemId?: string | null;
  sourceNoteId?: string | null;
  projectId?: string | null;
}

export interface UpdateActionItemInput {
  description?: string;
  assigneeId?: string | null;
  priority?: Priority;
  dueDate?: Date | null;
  progress?: number;
}

export interface ActionItemServiceDeps {
  actionItems: ActionItemRepository;
  onChanged?: (meetingId: string | null) => void;
  now?: () => Date;
}

export interface ActionItemService {
  getItem(id: string): Promise<ActionItemRecord>;
  listByMeeting(meetingId: string): Promise<ActionItemView[]>;
  listMine(userId: string, filter?: AssigneeListFilter): Promise<ActionItemView[]>;
  addItem(meetingId: string | null, createdById: string, input: AddActionItemInput): Promise<ActionItemRecord>;
  updateItem(id: string, patch: UpdateActionItemInput): Promise<ActionItemRecord>;
  setStatus(id: string, status: ActionItemStatus): Promise<ActionItemRecord>;
  removeItem(id: string): Promise<void>;
}

const trim = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

export function createActionItemService(deps: ActionItemServiceDeps): ActionItemService {
  const { actionItems } = deps;
  const now = deps.now ?? (() => new Date());

  const isOverdue = (a: ActionItemRecord): boolean => !!a.dueDate && !CLOSED.includes(a.status) && a.dueDate.getTime() < now().getTime();
  const view = (a: ActionItemRecord): ActionItemView => ({ ...a, overdue: isOverdue(a) });

  async function require(id: string): Promise<ActionItemRecord> {
    const a = await actionItems.findById(id);
    if (!a) throw new NotFoundError('Action item not found.');
    return a;
  }

  return {
    async getItem(id) {
      return require(id);
    },

    async listByMeeting(meetingId) {
      return (await actionItems.listByMeeting(meetingId)).map(view);
    },

    async listMine(userId, filter) {
      return (await actionItems.listForAssignee(userId, filter)).map(view);
    },

    async addItem(meetingId, createdById, input) {
      const description = (input.description ?? '').trim();
      if (!description) throw new ValidationError('An action item needs a description.');
      if (input.priority && !PRIORITIES.includes(input.priority)) throw new ValidationError('Invalid priority.');
      const rec = await actionItems.create({
        meetingId,
        description,
        createdById,
        assigneeId: trim(input.assigneeId),
        priority: input.priority ?? 'NORMAL',
        dueDate: input.dueDate ?? null,
        agendaItemId: trim(input.agendaItemId),
        sourceNoteId: trim(input.sourceNoteId),
        projectId: trim(input.projectId),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async updateItem(id, patch) {
      if (patch.description !== undefined && !patch.description.trim()) throw new ValidationError('An action item needs a description.');
      if (patch.priority && !PRIORITIES.includes(patch.priority)) throw new ValidationError('Invalid priority.');
      if (patch.progress !== undefined && (patch.progress < 0 || patch.progress > 100)) throw new ValidationError('Progress must be 0–100.');
      const current = await require(id);
      const rec = await actionItems.update(id, {
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.assigneeId !== undefined ? { assigneeId: trim(patch.assigneeId) } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      });
      deps.onChanged?.(current.meetingId);
      return rec;
    },

    async setStatus(id, status) {
      if (!STATUSES.includes(status)) throw new ValidationError('Invalid action item status.');
      const current = await require(id);
      const completed = status === 'COMPLETED';
      const rec = await actionItems.update(id, {
        status,
        completedAt: completed ? now() : null,
        ...(completed ? { progress: 100 } : {}),
      });
      deps.onChanged?.(current.meetingId);
      return rec;
    },

    async removeItem(id) {
      const current = await require(id);
      await actionItems.remove(id);
      deps.onChanged?.(current.meetingId);
    },
  };
}
