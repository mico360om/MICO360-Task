export type ActionItemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface ActionItemRecord {
  id: string;
  meetingId: string | null;
  agendaItemId: string | null;
  sourceNoteId: string | null;
  projectId: string | null;
  description: string;
  assigneeId: string | null;
  priority: Priority;
  status: ActionItemStatus;
  dueDate: Date | null;
  progress: number;
  completedAt: Date | null;
  /** Set when the action item was promoted to a board Task. */
  taskId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateActionItemData {
  meetingId?: string | null;
  agendaItemId?: string | null;
  sourceNoteId?: string | null;
  projectId?: string | null;
  description: string;
  assigneeId?: string | null;
  priority?: Priority;
  status?: ActionItemStatus;
  dueDate?: Date | null;
  /** The board task this item is tracked as (set when it comes from a note turned into a task). */
  taskId?: string | null;
  createdById: string;
}

export interface UpdateActionItemData {
  description?: string;
  assigneeId?: string | null;
  priority?: Priority;
  status?: ActionItemStatus;
  dueDate?: Date | null;
  progress?: number;
  completedAt?: Date | null;
  taskId?: string | null;
}

/** Cross-meeting filter for a user's own action items ("My Action Items"). */
export interface AssigneeListFilter {
  status?: ActionItemStatus;
  /** Only items that are still actionable (not COMPLETED/CANCELLED). */
  openOnly?: boolean;
  /**
   * companies: only the picked company's — items of its projects (by the item's project or its
   * meeting's), items of its meetings without a project, and items with neither a project nor a
   * meeting. An invitee's items from another company's meeting drop out.
   */
  pick?: { companyId: string };
  /**
   * companies: an administrator's list (every item assigned to them). Otherwise, without a pick, the
   * person's own items stay inside their companies: items with neither a project nor a meeting, items
   * of meetings they organize, made or were invited to (the invitation exception), and items of
   * projects / standalone meetings in one of their active companies — whether or not they are on the
   * project's team, as in 1.20.
   */
  admin?: boolean;
  /**
   * 1.22: an administrator listing like a team member ("Show my projects only"): only the items of
   * these projects (by the item's project or its meeting's), of meetings they organize, made or were
   * invited to, and of no project. With a pick, the pick's rule applies too.
   */
  projectIds?: string[];
}

export interface ActionItemRepository {
  create(data: CreateActionItemData): Promise<ActionItemRecord>;
  findById(id: string): Promise<ActionItemRecord | null>;
  listByMeeting(meetingId: string): Promise<ActionItemRecord[]>;
  /** The items tracked as this board task (from any meeting). */
  listByTask(taskId: string): Promise<ActionItemRecord[]>;
  /** A user's own items across meetings — excluding items whose meeting was deleted. */
  listForAssignee(userId: string, filter?: AssigneeListFilter): Promise<ActionItemRecord[]>;
  update(id: string, patch: UpdateActionItemData): Promise<ActionItemRecord>;
  remove(id: string): Promise<void>;
}
