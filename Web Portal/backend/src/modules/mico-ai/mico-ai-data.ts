/**
 * What MICO AI's tools read, and nothing else: there are no write methods here, so a tool can never
 * create, change or delete anything. Every method that lists things takes the scope the person may
 * see (project ids from the same project-access rule as the rest of the app; null for an admin),
 * and the tools check the results again before using them.
 */

export interface Viewer {
  userId: string;
  roles: string[];
}

export interface AiProjectRec {
  id: string;
  code: string;
  number: string | null;
  name: string;
  status: string;
  clientName: string | null;
  description: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  managerId: string | null;
  ownerId: string | null;
}

export interface AiTaskRec {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  /** The column's name ("In review"): its status as the team calls it. */
  columnName: string;
  /** BACKLOG | TODO | IN_PROGRESS | BLOCKED | REVIEW | DONE */
  category: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  progress: number;
  isMilestone: boolean;
  assigneeIds: string[];
}

export interface AiTaskLink {
  id: string;
  key: string;
  title: string;
  projectId: string;
  category: string;
  columnName: string;
}

export interface AiActivityRec {
  id: string;
  taskId: string | null;
  projectId: string | null;
  userId: string;
  action: string;
  meta: unknown;
  createdAt: Date;
  task: { id: string; key: string; title: string } | null;
}

export interface AiTaskExtras {
  description: string | null;
  checklist: Array<{ text: string; done: boolean }>;
  comments: Array<{ userId: string; body: string; createdAt: Date }>;
  /** Newest first. */
  activity: AiActivityRec[];
  blockedBy: AiTaskLink[];
  blocks: AiTaskLink[];
  meeting: { id: string; title: string; startAt: Date } | null;
}

export interface AiMeetingRec {
  id: string;
  title: string;
  projectId: string | null;
  organizerId: string;
  createdById: string;
  attendeeUserIds: string[];
  startAt: Date;
  endAt: Date | null;
  status: string;
  location: string | null;
  decisions: number;
  openActionItems: number;
}

export interface AiMeetingDetail extends AiMeetingRec {
  description: string | null;
  timeZone: string | null;
  attendees: Array<{ userId: string | null; name: string | null; response: string; attendance: string }>;
  agenda: Array<{ title: string; ownerId: string | null; minutes: number | null; completed: boolean }>;
  notes: Array<{ type: string; text: string; authorId: string; agendaTitle: string | null; createdAt: Date }>;
  actionItems: Array<{ description: string; assigneeId: string | null; dueDate: Date | null; status: string; taskId: string | null; taskKey: string | null }>;
  decisionsList: Array<{ title: string; description: string | null; status: string }>;
  finalMinutes: {
    status: 'DRAFT' | 'APPROVED';
    summary: string;
    discussion: Array<{ topic: string; text: string }>;
    decisions: string[];
    risks: string[];
    nextSteps: string[];
  } | null;
}

export interface AiActionItemRec {
  id: string;
  description: string;
  assigneeId: string | null;
  dueDate: Date | null;
  status: string;
  meetingId: string;
  taskId: string | null;
  taskKey: string | null;
}

export interface AiConversationRec {
  id: string;
  kind: 'PROJECT' | 'DIRECT';
  projectId: string | null;
  /** For a direct conversation: the people in it. */
  participantIds: string[];
}

export interface AiChatMessageRec {
  id: string;
  conversationId: string;
  userId: string;
  body: string;
  createdAt: Date;
}

export interface AiPersonRec {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  active: boolean;
}

export interface AiMembershipRec {
  projectId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'MEMBER';
}

export interface MicoAiDataPort {
  /** The project-access rule the task, board and project pages use: null = admin (every project). */
  accessibleProjectIds(viewer: Viewer): Promise<string[] | null>;
  projects(ids: string[] | null): Promise<AiProjectRec[]>;
  tasks(filter: { projectIds: string[] | null; projectId?: string; assigneeId?: string }): Promise<AiTaskRec[]>;
  /** One task by key or id within the scope, or null. */
  findTask(projectIds: string[] | null, keyOrId: string): Promise<AiTaskRec | null>;
  taskExtras(taskId: string): Promise<AiTaskExtras>;
  /** Newest first. */
  activity(filter: { projectIds: string[] | null; projectId?: string; from: Date; to: Date; limit: number }): Promise<AiActivityRec[]>;
  /** Meetings the viewer may see (the meeting-access rule), starting in the range. */
  meetings(viewer: Viewer, filter: { projectIds: string[] | null; projectId?: string; from: Date; to: Date; limit: number; text?: string }): Promise<AiMeetingRec[]>;
  /** The meeting pages' own check. */
  canViewMeeting(viewer: Viewer, meetingId: string): Promise<boolean>;
  meetingDetail(meetingId: string): Promise<AiMeetingDetail | null>;
  actionItems(meetingIds: string[]): Promise<AiActionItemRec[]>;
  /** The conversations the chat module lets the viewer open (their direct ones and their projects' channels). */
  conversations(viewer: Viewer): Promise<AiConversationRec[]>;
  /** Newest first. */
  chatMessages(filter: { conversationIds: string[]; text?: string; senderIds?: string[]; from?: Date; to?: Date; limit: number }): Promise<AiChatMessageRec[]>;
  /** The people directory every signed-in person sees (names and usernames only). */
  people(): Promise<AiPersonRec[]>;
  /** Owners, managers and members of these projects (null: all). */
  memberships(projectIds: string[] | null): Promise<AiMembershipRec[]>;
}
