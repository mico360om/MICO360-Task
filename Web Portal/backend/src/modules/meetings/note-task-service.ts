import { ConflictError, ForbiddenError, ValidationError } from '../../lib/http-errors';
import type { Priority } from '../tasks/task-repository';
import type { TaskRecord } from '../tasks/task-repository';
import type { NoteService } from './note-service';
import type { NoteRecord } from './note-repository';
import { noteText } from '../../lib/rich-text';
import type { ActionItemRecord } from './action-item-repository';
import type { AddActionItemInput } from './action-item-service';

/** Collaborators, kept as narrow structural types so this composes services without hard coupling. */
export interface NoteTaskDeps {
  noteService: Pick<NoteService, 'getNote' | 'linkTask' | 'claimForTask' | 'releaseTaskClaim'>;
  /** Optional — when present, an action-item note is also tracked as an action item linked to the task. */
  actionItems?: { addItem: (meetingId: string | null, createdById: string, input: AddActionItemInput) => Promise<ActionItemRecord> };
  meetingService: { getMeeting: (id: string) => Promise<{ id: string; title: string; projectId: string | null }> };
  taskService: { createTask: (input: NewTaskInput) => Promise<TaskRecord> };
  columnService: { listColumns: (projectId: string) => Promise<ColumnLike[]> };
  /** Optional — when present, an `assigneeId` override is applied after the task is created. */
  assignees?: { assignUsers: (taskId: string, userIds: string[], actorId?: string) => Promise<unknown> };
}

interface ColumnLike {
  id: string;
  position: number;
  enabled: boolean;
}

interface NewTaskInput {
  title: string;
  description?: string | null;
  projectId: string;
  columnId: string;
  priority?: Priority;
  dueDate?: Date | null;
  createdById: string;
  /** The meeting the task comes from, so the task links back to it. */
  meetingId?: string | null;
}

export interface CreateTaskFromNoteOverrides {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  columnId?: string | null;
  priority?: Priority;
  dueDate?: string | null; // ISO
  assigneeId?: string | null;
}

export interface CreateTaskFromNoteOptions {
  /** May the caller create tasks in this project? Checked for the resolved project, explicit or inherited. */
  canUseProject?: (projectId: string) => Promise<boolean>;
}

export interface NoteTaskService {
  createTaskFromNote(
    meetingId: string,
    noteId: string,
    createdById: string,
    overrides: CreateTaskFromNoteOverrides,
    opts?: CreateTaskFromNoteOptions,
  ): Promise<{ task: TaskRecord; note: NoteRecord; assigneeError?: string; actionItem?: ActionItemRecord; actionItemError?: string }>;
}

/** First line of the note, trimmed to a sensible task-title length. */
function deriveTitle(body: string): string {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? body.trim();
  const clean = firstLine.replace(/\s+/g, ' ');
  return clean.length > 120 ? `${clean.slice(0, 117).trimEnd()}…` : clean;
}

const TYPE_LABELS: Record<string, string> = {
  DISCUSSION: 'discussion', DECISION: 'decision', ACTION: 'action item', ISSUE: 'issue', QUESTION: 'question', INFORMATION: 'information',
};

/**
 * Promote a meeting note into a board Task (⭐ Create Task from Note), auto-populating from the
 * note + meeting and honoring editable overrides, then back-linking the note to the task. The note
 * is claimed atomically first, so two people clicking at once can't create two tasks.
 */
export function createNoteTaskService(deps: NoteTaskDeps): NoteTaskService {
  const { noteService, meetingService, taskService, columnService } = deps;

  return {
    async createTaskFromNote(meetingId, noteId, createdById, overrides, opts) {
      const note = await noteService.getNote(meetingId, noteId);
      if (note.taskId) throw new ConflictError('A task has already been created from this note.', 'NOTE_HAS_TASK');
      const meeting = await meetingService.getMeeting(meetingId);

      const projectId = overrides.projectId ?? meeting.projectId;
      if (!projectId) {
        throw new ValidationError('Select a project for this task — the meeting is standalone.');
      }
      // The meeting's own project is checked too: attending a meeting doesn't grant its board.
      if (opts?.canUseProject && !(await opts.canUseProject(projectId))) {
        throw new ForbiddenError('You do not have access to that project.');
      }

      const columns = await columnService.listColumns(projectId);
      let columnId = overrides.columnId ?? undefined;
      if (columnId) {
        if (!columns.some((c) => c.id === columnId)) throw new ValidationError('That column is not on this project’s board.');
      } else {
        const enabled = columns.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
        const target = (enabled[0] ?? [...columns].sort((a, b) => a.position - b.position)[0]);
        if (!target) throw new ValidationError('That project has no columns to place the task in.');
        columnId = target.id;
      }

      // A formatted note gives its words (with its list structure), never its markup.
      const text = noteText(note);
      const title = (overrides.title ?? '').trim() || deriveTitle(text);
      const typeLabel = TYPE_LABELS[note.type] ?? 'note';
      const description =
        overrides.description !== undefined
          ? overrides.description
          : `${text}\n\n— From the ${typeLabel} in meeting "${meeting.title}".`;

      const dueDate = overrides.dueDate ? new Date(overrides.dueDate) : undefined;
      if (dueDate && Number.isNaN(dueDate.getTime())) throw new ValidationError('Invalid due date.');

      const claim = await noteService.claimForTask(meetingId, noteId);
      let task: TaskRecord;
      try {
        task = await taskService.createTask({
          title,
          description,
          projectId,
          columnId,
          createdById,
          meetingId: meeting.id,
          ...(overrides.priority ? { priority: overrides.priority } : {}),
          ...(dueDate ? { dueDate } : {}),
        });
      } catch (err) {
        await noteService.releaseTaskClaim(noteId, claim).catch(() => {});
        throw err;
      }

      // An action-item note is tracked on the meeting's action items too, already linked to the
      // task, so nobody types it in twice. A failure here never loses the task.
      let actionItem: ActionItemRecord | undefined;
      let actionItemError: string | undefined;
      if (note.type === 'ACTION' && deps.actionItems) {
        try {
          actionItem = await deps.actionItems.addItem(meetingId, createdById, {
            description: title,
            assigneeId: overrides.assigneeId ?? null,
            priority: overrides.priority ?? 'NORMAL',
            dueDate: dueDate ?? null,
            sourceNoteId: note.id,
            projectId,
            taskId: task.id,
          });
        } catch {
          actionItemError = 'The task was created, but it couldn’t be added to the action items.';
        }
      }

      // Link first: once the task exists the note must point at it, even if assignment fails.
      const linked = actionItem
        ? await noteService.linkTask(meetingId, noteId, task.id, actionItem.id)
        : await noteService.linkTask(meetingId, noteId, task.id);

      let assigneeError: string | undefined;
      if (overrides.assigneeId && deps.assignees) {
        try {
          await deps.assignees.assignUsers(task.id, [overrides.assigneeId], createdById);
        } catch (err) {
          assigneeError = (err as Error).message || 'The task was created but could not be assigned.';
        }
      }
      return {
        task,
        note: linked,
        ...(assigneeError ? { assigneeError } : {}),
        ...(actionItem ? { actionItem } : {}),
        ...(actionItemError ? { actionItemError } : {}),
      };
    },
  };
}
