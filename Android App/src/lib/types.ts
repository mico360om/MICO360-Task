/** Shared API types for the mobile app (mirror the `/api/v1` JSON envelope). */

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  /** The profile photo's address (sign-in and refresh replies carry it; older sessions may not). */
  avatarUrl?: string | null;
}

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** A task's recurrence rule — lib/recurrence.ts is a copy of the backend's (the API's model). */
export type { RecurrenceRule } from './recurrence';
import type { RecurrenceRule } from './recurrence';

export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';

/** The meeting a task was created from, as the viewer may see it (task detail only). */
export interface ApiTaskMeeting {
  id: string;
  /** Null when the viewer may not see the meeting: they learn only that there is one. */
  title: string | null;
  startAt: string | null;
  canView: boolean;
}

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
  /** The copy made from this task (task detail only). Set = an earlier copy of its series. */
  recurrenceNextId?: string | null;
  /** A milestone of its project (older servers leave it out). */
  isMilestone?: boolean;
  /** Edit counter: sent back as expectedVersion, so an edit made over someone else's is refused. */
  version?: number;
  /** The meeting this task was created from (a Live note made into a task); older servers leave it out. */
  meetingId?: string | null;
  /** That meeting, for the task details (null when none, or deleted). */
  meeting?: ApiTaskMeeting | null;
  /** The category of the task's column (e.g. DONE) — older servers leave it out. */
  columnCategory?: string | null;
  /** List rows: its column is switched off in Manage columns, so it isn't on a board (older servers leave it out). */
  columnHidden?: boolean;
  /**
   * Task details only: every day it was carried forward to (per-date boards), oldest first —
   * 'YYYY-MM-DD' days and when it happened. Absent or null when it never was.
   */
  carryForwardLog?: { from: string; to: string; at: string }[] | null;
  /** Present only on the create response when tags were applied in the same call. */
  tags?: ApiTag[];
  /** Present only on the create response when assignees were applied in the same call. */
  assignees?: ApiAssignee[];
  /** It needs the OK of whoever runs its project before it counts as done (older servers leave it out). */
  needsApproval?: boolean;
  /** Set while it waits for approval: finished, but not done yet (never late while it waits). */
  approvalRequestedAt?: string | null;
  approvalRequestedById?: string | null;
  /** Its last approval. */
  approvedAt?: string | null;
  approvedById?: string | null;
  /** Its approval as the signed-in person sees it (single-task responses). */
  approval?: TaskApprovalInfo;
  /** Shown on the project's client page (its title, status and due date only). */
  clientVisible?: boolean;
  /** Keys it had before it moved to another project, oldest first (single-task responses): "RIG-4" for OPS-17. */
  formerKeys?: string[];
  /** The inspection form it is carried out with (a scheduled check, or a one-off task with a form). */
  inspectionFormId?: string | null;
  /** Where the check is done ("Rig 3"). */
  inspectionPlace?: string | null;
}

/** A person named on a task's approval (the website's api/tasks.ts). */
export interface ApprovalPerson {
  id: string;
  name: string;
}

/** A task's approval as its details show it to the signed-in person (single-task responses). */
export interface TaskApprovalInfo {
  /** They may approve it or send it back (they run the project, or are an administrator). */
  canApprove: boolean;
  /** Who finished it (asked for approval). */
  requestedBy: ApprovalPerson | null;
  /** Who approved it last. */
  approvedBy: ApprovalPerson | null;
  /** The one person who runs the project; null when several do (or none). */
  approverName: string | null;
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
  /** The project's own number (e.g. the client's job or contract number). */
  number?: string | null;
  name: string;
  description: string | null;
  status: string;
  clientName?: string | null;
  priority?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  /** Its colour as #RRGGBB (5b); older servers leave the look out. */
  color?: string | null;
  /** One of the server's project icons (lib/project-identity), or null for its initials. */
  icon?: string | null;
  /** Its picture: '/uploads/…' on this server, or null. */
  imageUrl?: string | null;
  /** Its owner (new tasks are assigned to them), or null. */
  ownerId?: string | null;
  /**
   * May the signed-in person run it — change it, its team and columns, delete its tasks (its owner,
   * named managers, MANAGER members, administrators)? Sent by GET /projects, GET /projects/:id, POST
   * and PUT; older servers leave it out.
   */
  canManage?: boolean;
  /** Each night, its unfinished tasks on past days move to today's board. Missing (older server) = on. */
  carryForward?: boolean;
  /** A task added without a due date gets today's date. Missing (older server) = off. */
  defaultDueToday?: boolean;
  /** "New tasks in this project need approval": the New task form starts ticked. Missing (older server) = off. */
  newTasksNeedApproval?: boolean;
}

// ── Daily work (Stage 2): approvals, moving tasks, the Projects page, task templates ─────────────
// Field names exactly the website's api/tasks.ts, api/projects.ts and api/templates.ts (lib/api-types.test.ts).

/** A task waiting for the signed-in person's approval (GET /tasks/approvals). */
export interface ApprovalTask extends ApiTask {
  project: { id: string; code: string; name: string; color: string | null; icon: string | null; imageUrl: string | null };
  requestedBy: ApprovalPerson | null;
}

/** GET /tasks/approvals: the tasks waiting for the signed-in person's approval (oldest first), and whether they approve any project's tasks. */
export interface ApprovalsAnswer {
  canApprove: boolean;
  tasks: ApprovalTask[];
}

/** What happens to people assigned to a moved task who aren't on the new project's team. */
export type AssigneeChoice = 'ADD_TO_TEAM' | 'UNASSIGN';

/** A project a task can be moved to. */
export interface MoveProject {
  id: string;
  code: string;
  name: string;
  status: string;
  color: string | null;
  icon: string | null;
  imageUrl: string | null;
}

/** Where the signed-in person may move tasks (GET /tasks/move-targets). */
export interface MoveTargets {
  /** An administrator: any task, to any open project. */
  managesAll: boolean;
  /** Projects whose tasks they may move out (the ones they manage). */
  managedProjectIds: string[];
  /** Open projects they may move tasks into. */
  projects: MoveProject[];
}

export interface MovePerson {
  id: string;
  name: string;
}

/** What moving one task would change (POST /tasks/move-preview). */
export interface TaskMovePreview {
  id: string;
  key: string;
  title: string;
  from: { id: string; code: string; name: string } | null;
  canMove: boolean;
  /** Why it can't be moved, in words. */
  reason: string | null;
  /** The key it would get, e.g. "OPS-17" (the next free number now). */
  newKey: string | null;
  /** The stage it is in now (its column's category). */
  currentCategory: string | null;
  /** It is completed now (a Done column, or a completion time). */
  completed: boolean;
  /** The column it goes to unless another is chosen (the same kind as now, else the first). */
  columnId: string | null;
  milestoneCleared: boolean;
  /** 'YYYY-MM-DD': the due date it gets from the new project's "New tasks are due today". */
  dueDate: string | null;
  repeat: 'SERIES' | 'COPY' | null;
  /** People assigned to it who aren't on the new project's team. */
  outsiders: MovePerson[];
}

export interface MovePreview {
  project: MoveProject & { defaultDueToday: boolean };
  /** The new project's columns, in board order. */
  columns: { id: string; name: string; category: string; position: number; enabled: boolean }[];
  tasks: TaskMovePreview[];
  /** Everyone not on the new team, across the tasks that can move. */
  outsiders: MovePerson[];
}

export interface MoveInput {
  projectId: string;
  /** A column of the new project; left out, each task goes to the same kind of column as now. */
  columnId?: string;
  /** Required when someone assigned isn't on the new team. */
  assignees?: AssigneeChoice;
}

export interface MoveResult {
  task: ApiTask;
  from: { projectId: string; name: string; key: string };
  to: { projectId: string; name: string; key: string };
  addedToTeam: MovePerson[];
  unassigned: MovePerson[];
  milestoneCleared: boolean;
  dueDateSet: string | null;
  /** The move completed it (into a Done column) or re-opened it (out of one). */
  statusChange?: 'COMPLETED' | 'REOPENED' | null;
}

export type BulkMoveItem = ({ taskId: string; ok: true } & MoveResult) | { taskId: string; ok: false; error: { code: string; message: string; details?: unknown } };

export interface BulkMoveResult {
  results: BulkMoveItem[];
  moved: number;
  failed: number;
}

/** A person on a project card: a face and a name. */
export interface ProjectPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A project's card figures, counted by the server for the whole list at once. */
export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  /** Open tasks whose due day is before today (company time zone). */
  overdue: number;
  /** Nearest due day ('YYYY-MM-DD') of an open task, today or later; null when there is none. */
  nextDue: string | null;
  /** The later of the project's own last change and its latest task change (ISO). */
  lastActivityAt: string;
}

/** A project as the Projects page lists it (GET /projects/overview): only what its card shows (Edit loads the full project). */
export interface ProjectOverview
  extends Pick<ApiProject, 'id' | 'code' | 'number' | 'name' | 'clientName' | 'status' | 'color' | 'icon' | 'imageUrl' | 'ownerId' | 'targetDate'> {
  stats: ProjectStats;
  owner: ProjectPerson | null;
  /** Up to four active members, in the order they joined. */
  team: ProjectPerson[];
  /** How many active members the project has. */
  teamCount: number;
  /** You own it, manage it or are on its team (worked out by the server). */
  mine: boolean;
  /** You may change it (see ApiProject.canManage). */
  canManage?: boolean;
}

/** A task template (GET /templates/tasks): New task can start from one (editing them stays on the website). */
export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
  createdById: string | null;
  createdByName: string | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Meetings (taking part in them — 2a — and running them — 2b) ─────────────
export type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type MeetingPhase = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
/** How far a meeting's minutes are: none, notes taken, final minutes drafted, final minutes approved. */
export type MinutesState = 'NONE' | 'NOTES' | 'DRAFT' | 'FINAL';

/** A meeting as the meetings list gives it (the calendar, the Meetings tab, one meeting). */
export interface ApiMeeting {
  id: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  projectId: string | null;
  organizerId: string;
  location: string | null;
  onlineLink: string | null;
  startAt: string;
  endAt: string | null;
  timeZone: string | null;
  /** On the first meeting of a repeating series: the series' rule. */
  recurrenceRule: RecurrenceRule | null;
  /** On the other meetings of a series: the first meeting's id. */
  recurrenceParentId: string | null;
  /** A series meeting's place in its series (the start its rule gave it). */
  recurrenceStart?: string | null;
  /** The meeting's series (one meeting's details only; null for a one-off). */
  series?: { id: string; rule: RecurrenceRule; timeZone: string } | null;
  category?: string | null;
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
  /** When calendar invitations were last sent (null = never). */
  invitesSentAt?: string | null;
  /** May the signed-in person run this meeting (edit it, its people, agenda and minutes)? Older servers leave it out. */
  canEdit?: boolean;
  /** List only: how many people are on it. */
  attendeeCount?: number;
  /** List only: action items still to do. */
  openActionItemCount?: number;
  /** List only: the first few attendees' names. */
  attendees?: string[];
  /** List only: how far the minutes are. */
  minutes?: MinutesState;
  /** List only: notes recorded as decisions. */
  decisionCount?: number;
}

/** The answer to the invitation — apart from the role (required / optional) and attendance on the day. */
export type InvitationResponse = 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';
export type AttendanceStatus = 'INVITED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

/** Someone on a meeting: a team member (userId) or a guest (externalName / externalEmail). */
export interface ApiMeetingAttendee {
  id: string;
  meetingId: string;
  userId: string | null;
  externalName: string | null;
  externalEmail: string | null;
  role: 'REQUIRED' | 'OPTIONAL';
  attendance: AttendanceStatus;
  /** Older servers leave these out (no answer yet). */
  response?: InvitationResponse;
  respondedAt?: string | null;
  invitedAt?: string | null;
  department: string | null;
  createdAt: string;
}

/** One topic of a meeting's agenda. */
export interface ApiAgendaItem {
  id: string;
  meetingId: string;
  title: string;
  ownerId: string | null;
  expectedMinutes: number | null;
  position: number;
  completed: boolean;
}

export type MeetingNoteType = 'DISCUSSION' | 'DECISION' | 'ACTION' | 'ISSUE' | 'QUESTION' | 'INFORMATION';

/** A Live note taken in a meeting. A RICH body is the server's one fixed, safe HTML form (lib/rich-note). */
export interface ApiMeetingNote {
  id: string;
  meetingId: string;
  agendaItemId: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  bodyFormat?: 'PLAIN' | 'RICH';
  highlighted: boolean;
  taskId: string | null;
  createdAt: string;
  editedAt: string | null;
}

export type ActionItemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED' | 'CANCELLED';

/** A follow-up from a meeting (in its register, or in My Action Items). */
export interface ApiActionItem {
  id: string;
  meetingId: string | null;
  projectId: string | null;
  description: string;
  assigneeId: string | null;
  priority: Priority;
  status: ActionItemStatus;
  dueDate: string | null;
  progress: number;
  completedAt: string | null;
  taskId: string | null;
  sourceNoteId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /** The server's word: past due and still to do. */
  overdue: boolean;
  /** Board key of the linked task (null when there is none, or it's gone). */
  taskKey?: string | null;
}

export interface FinalMinutesContent {
  summary: string;
  discussion: Array<{ topic: string; text: string }>;
  decisions: string[];
  risks: string[];
  nextSteps: string[];
}

/** A meeting's final minutes (the Final MOM). An attendee sees NONE until they are final. */
export interface ApiFinalMinutes {
  status: 'NONE' | 'DRAFT' | 'FINAL';
  content: FinalMinutesContent | null;
  savedAt: string | null;
  approvedBy: { id: string; name: string | null } | null;
  approvedAt: string | null;
  canEdit: boolean;
}

// ── Running a meeting (2b): what the app sends, and the server's answers ─────
/** One meeting of a repeating series, or all its upcoming meetings. */
export type SeriesScope = 'one' | 'series';
export type AttendeeRole = 'REQUIRED' | 'OPTIONAL';

/** A new meeting (the Schedule form). Times are instants; `timeZone` is the zone they were entered in. */
export interface MeetingInput {
  title: string;
  description?: string | null;
  category?: string | null;
  status?: MeetingStatus;
  projectId?: string | null;
  organizerId?: string;
  location?: string | null;
  onlineLink?: string | null;
  startAt: string;
  endAt?: string | null;
  timeZone?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  /** A new meeting's people, saved with it in the same request (all or nothing) — 2c. */
  attendees?: Array<{ userId?: string; externalName?: string; externalEmail?: string; role?: AttendeeRole }>;
  /** A new meeting's agenda, saved with it; a lead must be the organizer or one of its people. */
  agendaItems?: Array<{ title: string; ownerId?: string | null; expectedMinutes?: number | null }>;
}

/** A change to a meeting: only what changed is sent (people and agenda are changed on its page). */
export type MeetingPatch = Partial<Omit<MeetingInput, 'attendees' | 'agendaItems'>>;

// ── Meeting AI and free times (2c), as on the website ───────────────────────
/** What a sentence fills in on the meeting form (company time); empty where it says nothing. */
export interface AiMeetingDraft {
  title: string | null;
  description: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM, 24-hour */
  startTime: string | null;
  minutes: number | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
  location: string | null;
  onlineLink: string | null;
  people: {
    found: Array<{ id: string; name: string; username?: string }>;
    /** A name more than one person goes by: the person chooses. */
    choices: Array<{ said: string; options: Array<{ id: string; name: string; username?: string }> }>;
    notFound: string[];
  };
  guests: Array<{ email: string; name: string }>;
  agenda: string[];
}

/** What "Draft agenda" works from. */
export interface AiDraftAgendaInput {
  title: string;
  description?: string;
  text?: string;
  projectId?: string | null;
  startAt: string;
  minutes: number;
  /** The invited portal users, the organizer included: the only possible leads. */
  peopleIds: string[];
  /** An existing meeting: its series' previous meeting gives the leftovers. */
  meetingId?: string;
}

export interface AiAgendaItem {
  title: string;
  ownerId: string | null;
  minutes: number;
}

export interface FreeTimesInput {
  /** The invited portal users, the organizer included (guests have no known calendar). */
  userIds: string[];
  startAt: string;
  minutes: number;
  recurrenceRule?: RecurrenceRule;
  /** The meeting being edited: its own time isn't a clash. */
  excludeMeetingId?: string;
}

export interface FreeTimesReply {
  /** Up to three start times (ISO) when everyone is free, inside the meeting hours. */
  suggestions: string[];
  /** Who already has a meeting at the chosen time (a repeat's first four meetings are checked). */
  clashes: Array<{ userId: string; name: string; date?: string; start: string; end: string; title: string | null }>;
  /** The chosen day's busy blocks, per person. A null title is a meeting this person can't see. */
  day: Array<{ userId: string; name: string; blocks: Array<{ start: string; end: string; title: string | null }> }>;
  /** The company's meeting hours (System Settings), in company time. */
  workingHours: { days: number[]; start: string; end: string };
}

export interface AttendeeInput {
  userId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  role?: AttendeeRole;
}

export interface AttendeePatch {
  role?: AttendeeRole;
  attendance?: AttendanceStatus;
  response?: InvitationResponse;
}

export interface AgendaItemInput {
  title: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
}

export interface AgendaItemPatch extends Partial<AgendaItemInput> {
  completed?: boolean;
}

export interface NoteInput {
  body: string;
  /** PLAIN from the phone: the app has no formatting editor (the website's notes may be RICH). */
  format?: 'PLAIN' | 'RICH';
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export type NotePatch = Partial<NoteInput>;

/** ⭐ A board task made from a Live note. */
export interface NoteTaskInput {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  columnId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export interface NoteTaskResult {
  task: { id: string; key: string; title: string; projectId: string };
  note: ApiMeetingNote;
  /** The task was made, but assigning it failed (e.g. that person can't see the project). */
  assigneeError?: string;
  /** An action note is tracked as an action item too, linked to the task. */
  actionItem?: ApiActionItem;
  actionItemError?: string;
}

export interface ActionItemInput {
  description: string;
  assigneeId?: string | null;
  priority?: Priority;
  /** A calendar day, sent as that day at UTC midnight. */
  dueDate?: string | null;
}

export interface ActionItemPatch extends Partial<ActionItemInput> {
  progress?: number;
  status?: ActionItemStatus;
}

export type RecipientKind = 'organizer' | 'member' | 'guest';

/** Someone an invitation or the minutes would go to. */
export interface Recipient {
  name: string;
  email: string;
  kind: RecipientKind;
  attendeeIds: string[];
  alreadyInvited: boolean;
}

/** Who an invitation would go to, and anything to fix first (nothing is sent). */
export interface InvitePreview {
  recipients: Recipient[];
  missingEmail: { name: string; attendeeId: string }[];
  /** 'error' blocks sending; 'warning' can be sent anyway. */
  problems: { level: 'error' | 'warning'; message: string }[];
  invitesSentAt: string | null;
}

/** The minutes email as it would be sent, and to whom (nothing is sent). */
export interface MinutesPreview {
  subject: string;
  html: string;
  text: string;
  attachmentName: string;
  recipients: Recipient[];
  missingEmail: { name: string; attendeeId: string }[];
}

/** What happened to each email of a send. Older servers answer with the totals only. */
export interface SendReport {
  sent: number;
  failed?: number;
  recipients?: { name: string; email: string; kind: RecipientKind; ok: boolean; error?: string }[];
  skipped?: { name: string; reason: string }[];
}

/** A first draft of the final minutes to edit (not kept until it is saved). */
export interface FinalMinutesDraft {
  content: FinalMinutesContent;
  source: 'ai' | 'notes';
}

/** One meeting on a project's dashboard. */
export interface ApiProjectMeeting extends Omit<ApiMeeting, 'description' | 'projectId'> {
  seriesId: string | null;
  phase: MeetingPhase;
  attendeeCount: number;
  attendees: string[];
  minutes: MinutesState;
  decisionCount: number;
  openActionItemCount: number;
}

/** A project's meetings, decisions and action items (GET /projects/:id/meetings-overview). */
export interface ApiProjectMeetingsOverview {
  meetings: ApiProjectMeeting[];
  decisions: Array<{ id: string; text: string; meetingId: string; meetingTitle: string | null; at: string }>;
  actionItems: Array<{
    id: string;
    description: string;
    status: string;
    priority: Priority;
    dueDate: string | null;
    overdue: boolean;
    assignee: { id: string; name: string } | null;
    meetingId: string | null;
    meetingTitle: string | null;
  }>;
  /** Each repeating series once, with its next meeting. */
  series: Array<{ id: string; title: string; rule: RecurrenceRule; firstStartAt?: string; nextMeetingId: string | null; nextStartAt: string | null; upcoming: number }>;
  stats: {
    upcoming: number;
    ongoing: number;
    completed: number;
    cancelled: number;
    nextMeetingId: string | null;
    openActionItems: number;
    overdueActionItems: number;
    decisions: number;
  };
}

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  /** What the notification is about (lowercase, e.g. `task` / `project` / `conversation` / `digest`). */
  entityType?: string | null;
  /** The id of that item — lets a tap open the related task (WEB-18). */
  entityId?: string | null;
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
  /** The message this one answers (older servers leave it out). */
  replyTo?: ReplyQuote | null;
  /** The sender's own id for this message: how a message waiting on this phone is matched to the server's copy. */
  clientId?: string | null;
}

/** A short quote of the message being answered (no text once that message is deleted). */
export interface ReplyQuote {
  id: string;
  userId: string;
  body: string;
  deleted: boolean;
}

export interface ApiChatParticipant {
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
  addedAt: string;
  /** When their app last received this conversation ("delivered"; older servers leave it out). */
  lastDeliveredAt?: string | null;
}

/** The signed-in person's own settings for a conversation. */
export interface ConversationPrefs {
  favorite: boolean;
  archived: boolean;
  muted: boolean;
}

export interface ApiConversationSummary {
  conversation: ApiConversation;
  participants: ApiChatParticipant[];
  unread: number;
  lastMessage: (Omit<ApiChatMessage, 'reactions' | 'attachments'> & { reactions?: ReactionGroup[]; attachments?: ApiChatAttachment[] }) | null;
  /** Older servers leave it out: all off. */
  prefs?: ConversationPrefs;
}

/** One line of a task's activity history (newest first from the server). */
export interface ApiActivityEntry {
  id: string;
  taskId: string | null;
  userId: string;
  action: string;
  createdAt: string;
  /** What changed: { from, to } for a move, { assignee } for an assignment, { changes } for an edit… */
  meta?: Record<string, unknown> | null;
  /** Who did it. */
  actor?: { id: string; name: string } | null;
}

/** A task's blockers (tasks it waits on) and the tasks that wait on it — by id. */
export interface ApiDependencyView {
  blockedBy: string[];
  blocks: string[];
}

/** Someone following a task's updates. */
export interface ApiWatcher {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
}

/** An AI-recommended priority and why. */
export interface ApiPrioritySuggestion {
  priority: Priority;
  reason: string;
}

/** Someone an @mention in a task's comments would notify (its project's members and admins). */
export interface ApiMentionable {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export interface ApiDirectoryUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  /** False for an inactive or suspended account: still named in history, but not offered to invite. */
  active?: boolean;
  /** Their picture (a server path), if they set one. */
  avatarUrl?: string | null;
  /** When they were last connected ("Last active 5m ago"); older servers leave it out. */
  lastActiveAt?: string | null;
}

/** The success envelope: `{ data: T }`. */
export interface Envelope<T> {
  data: T;
}
