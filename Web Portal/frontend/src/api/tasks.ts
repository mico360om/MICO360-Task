import type { ApiClient } from '../lib/api-client';
import type { ChecklistTree } from '../lib/checklist-tree';
import type { RecurrenceRule } from '../lib/recurrence';
import type { ExternalContactDraft, ExternalContactSummary } from '../lib/external-contacts';
import type { ApiExternalContact } from './external-contacts';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** The recurrence rule model is shared with the API (lib/recurrence.ts is a copy of the backend's). */
export type { RecurrenceRule };

/** The meeting a task was created from, as the viewer may see it. */
export interface TaskMeetingLink {
  id: string;
  /** Null when the viewer may not see the meeting: they learn only that there is one. */
  title: string | null;
  startAt: string | null;
  canView: boolean;
}

/** A person named on a task's approval. */
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

/** A task waiting for the signed-in person's approval (GET /tasks/approvals). */
export interface ApprovalTask extends ApiTask {
  project: { id: string; code: string; name: string; color: string | null; icon: string | null; imageUrl: string | null };
  requestedBy: ApprovalPerson | null;
}

export interface ApiTask {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  columnId: string;
  /** The task's Kanban stage (status), joined from its column. */
  columnCategory?: string | null;
  /** True when its column is switched off in Manage columns (not on the board). */
  columnHidden?: boolean;
  position: number;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  completedAt: string | null;
  boardDate?: string | null;
  /** Append-only carry-forward history (per-date boards). */
  carryForwardLog?: { from: string; to: string; at: string }[] | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency version (bumped on every update/move). */
  version?: number;
  /** A milestone: a key date or deliverable of its project (older servers leave it out). */
  isMilestone?: boolean;
  /** 1.23.5: its weight in its project's completion (1–10 points); null = the project's default for its priority. */
  weight?: number | null;
  /** Shown on the project's client page and in the Client portal (its title, status and due date). */
  clientVisible?: boolean;
  /** 1.23: its description is shown to the client too ("Also show its description"; only while shown). */
  clientShowDescription?: boolean;
  /** 1.23: when a client accepted it in the Client portal (only while that applies to its current finish). */
  clientAcceptedAt?: string | null;
  /** The repeat rule — only the newest copy of a recurring series carries it. */
  recurrenceRule?: RecurrenceRule | null;
  /** Set on every copy of a recurring series: the first task's id. */
  recurrenceParentId?: string | null;
  /** The copy made from this task (single-task responses). Set = an earlier copy of its series. */
  recurrenceNextId?: string | null;
  /** The meeting this task was created from (a Live note made into a task). */
  meetingId?: string | null;
  /** That meeting, for the task's details (single-task responses; null when none or deleted). */
  meeting?: TaskMeetingLink | null;
  /** Keys it had before it moved to another project, oldest first (single-task responses): "RIG-4" for OPS-17. */
  formerKeys?: string[];
  /** The inspection form it is carried out with (a scheduled check, or a one-off task with a form). */
  inspectionFormId?: string | null;
  /** Where the check is done ("Rig 3"). */
  inspectionPlace?: string | null;
  /** That form (single-task responses): its title, and whether it was deleted since (it can still be done). */
  inspectionForm?: { id: string; title: string; deleted: boolean } | null;
  /** It needs the OK of whoever runs its project before it counts as done (older servers leave it out). */
  needsApproval?: boolean;
  /** Set while it waits for approval: finished, but not done yet. */
  approvalRequestedAt?: string | null;
  approvalRequestedById?: string | null;
  /** Its last approval. */
  approvedAt?: string | null;
  approvedById?: string | null;
  /** Its approval as the signed-in person sees it (single-task responses). */
  approval?: TaskApprovalInfo;
  /** Who created it (older servers may leave it out). */
  createdById?: string;
  /**
   * May the signed-in person delete it — its creator, or the one person it's assigned to, among those
   * who may delete tasks at all (single-task responses; older servers leave it out: lib/task-delete-rule).
   */
  canDelete?: boolean;
  /** May they delete its entire repeating series (only the series' creator; single-task responses). */
  canDeleteSeries?: boolean;
  /** Assignees (present on list responses; used for card avatars). */
  assignees?: { id: string; name: string }[];
  /** Its tags (list and single-task responses; the Table view's optional Tags column). */
  tags?: { id: string; name: string; color: string }[];
  /** Aggregate counts for card badges (present on list responses). */
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
  /** Its external contacts in short — the first one's name and company, how many, every name and company (null: none; older servers leave it out). */
  externalSummary?: ExternalContactSummary | null;
  /** Its external contacts in full, in order (single-task responses). */
  externalContacts?: ApiExternalContact[];
  /** 1.23.1: the tasks merged into it (single-task responses): its "Merged from" panel opens from them. */
  mergedFrom?: { id: string; key: string; mergeId: string }[];
  /** 1.23.1: opened by a merged task's id (an old link or notice): which one, when and by whom. */
  mergeNotice?: { key: string; mergedAt: string | null; mergedByName: string | null };
}

export interface NewTaskInput {
  title: string;
  projectId: string;
  columnId: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
  /** Board day (YYYY-MM-DD) for per-date boards; defaults to today server-side. */
  boardDate?: string;
  /** A key date or deliverable of the project. */
  isMilestone?: boolean;
  /** 1.23.5: 1–10 points (projects counting by weight); null/left out = the project's default for its priority. */
  weight?: number | null;
  /**
   * People to assign, applied in the same request as the create. Omit to let the server apply the
   * project's default (its owner); an explicit list — even [] — is used as-is.
   */
  assigneeIds?: string[];
  /** Its checklist's items, in order (e.g. from a task template), created with the task (older form). */
  checklist?: string[];
  /** 1.23.3: its checklists with titles and nesting, created with the task (wins over `checklist`). */
  checklists?: ChecklistTree;
  /** Its external contacts (people outside the company responsible for it), in order, created with the task. */
  externalContacts?: ExternalContactDraft[];
  /** The inspection form it is carried out with, and where (a check). */
  inspectionFormId?: string | null;
  inspectionPlace?: string | null;
  /** Needs approval; left out, the project's "New tasks in this project need approval" decides. */
  needsApproval?: boolean;
}

export interface CreateTaskOptions {
  /** Stable `Idempotency-Key`, so a retried/replayed create never makes a second task. */
  idempotencyKey?: string;
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

export function tasksApi(client: ApiClient) {
  return {
    /** The task as a document: an Excel workbook or a PDF. */
    exportFile: (id: string, format: 'xlsx' | 'pdf') => client.getBlob(`/tasks/${id}/export.${format}`),
    list: (projectId?: string, boardDate?: string) => {
      const qs = new URLSearchParams();
      if (projectId) qs.set('projectId', projectId);
      if (boardDate) qs.set('boardDate', boardDate);
      const suffix = qs.toString();
      return client.get<{ data: ApiTask[] }>(suffix ? `/tasks?${suffix}` : '/tasks').then((r) => r.data);
    },
    mine: () => client.get<{ data: ApiTask[] }>('/tasks/mine').then((r) => r.data),
    get: (id: string) => client.get<{ data: ApiTask }>(`/tasks/${id}`).then((r) => r.data),
    create: (input: NewTaskInput, opts?: CreateTaskOptions) =>
      client
        .post<{ data: ApiTask }>('/tasks', input, opts?.idempotencyKey ? { headers: { 'Idempotency-Key': opts.idempotencyKey } } : undefined)
        .then((r) => r.data),
    update: (
      id: string,
      patch: Omit<Partial<NewTaskInput>, 'dueDate' | 'externalContacts'> & {
        progress?: number;
        columnId?: string;
        dueDate?: string | null;
        recurrenceRule?: RecurrenceRule | null;
        /** 'series' applies the edit to every occurrence of a recurring task. */
        scope?: 'one' | 'series';
        /** Reject with 409 VERSION_CONFLICT if the task changed since this version was read. */
        expectedVersion?: number;
        /** Meant for its repeating series' newest copy (a schedule): 409 RECURRENCE_NOT_NEWEST otherwise. */
        requireNewest?: boolean;
      },
    ) => client.put<{ data: ApiTask }>(`/tasks/${id}`, patch).then((r) => r.data),
    move: (id: string, columnId: string, position?: number) =>
      client
        .patch<{ data: ApiTask }>(`/tasks/${id}/move`, { columnId, ...(position !== undefined ? { position } : {}) })
        .then((r) => r.data),
    remove: (id: string, scope?: 'series') =>
      client.del<void>(scope ? `/tasks/${id}?scope=${scope}` : `/tasks/${id}`),
    /** Admin: run the per-date carry-forward sweep on demand. */
    runCarryForward: () => client.post<{ data: { carried: number } }>('/tasks/carry-forward', {}).then((r) => r.data),
    /** Where the signed-in person may move tasks to, and whose tasks they may move. */
    moveTargets: () => client.get<{ data: MoveTargets }>('/tasks/move-targets').then((r) => r.data),
    /** What moving these tasks to `projectId` would change (nothing is moved). */
    movePreview: (taskIds: string[], projectId: string) =>
      client.post<{ data: MovePreview }>('/tasks/move-preview', { taskIds, projectId }).then((r) => r.data),
    /** Move one task to another project. */
    moveToProject: (id: string, input: MoveInput) => client.post<{ data: MoveResult }>(`/tasks/${id}/move-to-project`, input).then((r) => r.data),
    /** Move several tasks to another project: a result for each. */
    moveManyToProject: (taskIds: string[], input: MoveInput) =>
      client.post<{ data: BulkMoveResult }>('/tasks/move-to-project', { taskIds, ...input }).then((r) => r.data),
    /** The tasks waiting for the signed-in person's approval, and whether they approve any project's tasks. */
    approvals: () => client.get<{ data: { canApprove: boolean; tasks: ApprovalTask[] } }>('/tasks/approvals').then((r) => r.data),
    /** Approve a waiting task: it is done now. */
    approve: (id: string, expectedVersion?: number) =>
      client.post<{ data: ApiTask }>(`/tasks/${id}/approve`, expectedVersion !== undefined ? { expectedVersion } : {}).then((r) => r.data),
    /** Send a waiting task back with a reason: it is in progress again. */
    sendBack: (id: string, reason: string, expectedVersion?: number) =>
      client.post<{ data: ApiTask }>(`/tasks/${id}/send-back`, { reason, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }).then((r) => r.data),
    /** Re-sequence a column's tasks (intra-column drag reordering). */
    reorder: (columnId: string, orderedIds: string[]) =>
      client.put<{ data: { ok: boolean } }>(`/columns/${columnId}/tasks/reorder`, { orderedIds }).then((r) => r.data),
  };
}

export type TasksApi = ReturnType<typeof tasksApi>;
