/** Shared API types for the mobile app (mirror the `/api/v1` JSON envelope). */

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
}

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** A task's recurrence rule (mirrors the backend/web model). */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null;
  weekdays?: number[];
  dayOfMonth?: number;
  /** When true the series is paused — no new occurrences are generated until resumed. */
  paused?: boolean;
}

export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';

export interface ApiTask {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  columnId: string;
  position: number;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  progress: number;
  completedAt: string | null;
  /** Per-date boards: the calendar day this task appears on (YYYY-MM-DD anchor). */
  boardDate?: string | null;
  /** Recurrence rule for a repeating task (null / absent when the task does not repeat). */
  recurrenceRule?: RecurrenceRule | null;
  /** Links a generated occurrence back to its recurring series (the origin task's id). */
  recurrenceParentId?: string | null;
  /** Present only on the create response when tags were applied in the same call. */
  tags?: ApiTag[];
  /** Present only on the create response when assignees were applied in the same call. */
  assignees?: ApiAssignee[];
}

/** A workspace tag (mirrors the backend tag catalog). */
export interface ApiTag {
  id: string;
  name: string;
  color: string;
}

/** A user who can be (or is) assigned to a task. */
export interface ApiAssignee {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** A project member — an assignable user, plus their role in the project. */
export interface ApiMember extends ApiAssignee {
  role: 'MEMBER' | 'MANAGER';
}

/** Full name for display, falling back to the username. */
export function displayName(u: { firstName?: string; lastName?: string; username: string }): string {
  const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return full || u.username;
}

/** A checklist (subtask) item on a task. */
export interface ApiChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
}

/** A task's checklist with X-of-Y progress. */
export interface ApiChecklist {
  items: ApiChecklistItem[];
  progress: number;
  done: number;
  total: number;
}

/** A comment on a task. */
export interface ApiComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  /** Set when this comment replies to another (threaded replies); null for top-level. */
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
}

/** Per-project progress/dashboard figures. */
export interface ApiProjectProgress {
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  overdue: number;
  completionPct: number;
  byCategory: Record<string, number>;
}

export type ColumnCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export interface ApiColumn {
  id: string;
  projectId: string;
  name: string;
  category: ColumnCategory;
  position: number;
  color: string;
  enabled: boolean;
}

export interface ApiProject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
}

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export type ConversationKind = 'PROJECT' | 'DIRECT';

export interface ApiConversation {
  id: string;
  kind: ConversationKind;
  projectId: string | null;
  createdAt: string;
}

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

export interface ApiChatAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
  /** Server-relative path (e.g. /uploads/<key>). */
  url: string;
}

export interface ApiChatMessage {
  id: string;
  conversationId: string;
  userId: string;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: ReactionGroup[];
  attachments: ApiChatAttachment[];
}

export interface ApiChatParticipant {
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
  addedAt: string;
}

export interface ApiConversationSummary {
  conversation: ApiConversation;
  participants: ApiChatParticipant[];
  unread: number;
  lastMessage: (Omit<ApiChatMessage, 'reactions'> & { reactions?: ReactionGroup[] }) | null;
}

export interface ApiDirectoryUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
}

/** The success envelope: `{ data: T }`. */
export interface Envelope<T> {
  data: T;
}
