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
}

export interface ActionItemRepository {
  create(data: CreateActionItemData): Promise<ActionItemRecord>;
  findById(id: string): Promise<ActionItemRecord | null>;
  listByMeeting(meetingId: string): Promise<ActionItemRecord[]>;
  listForAssignee(userId: string, filter?: AssigneeListFilter): Promise<ActionItemRecord[]>;
  update(id: string, patch: UpdateActionItemData): Promise<ActionItemRecord>;
  remove(id: string): Promise<void>;
}
