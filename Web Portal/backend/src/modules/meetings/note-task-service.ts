import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
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
  /**
   * Optional — when present, an action-item note is also tracked as an action item linked to the task.
   * `listByMeeting` (review fix #19): an interrupted conversion's retry finds the item it already made.
   */
  actionItems?: {
    addItem: (meetingId: string | null, createdById: string, input: AddActionItemInput) => Promise<ActionItemRecord>;
    listByMeeting?: (meetingId: string) => Promise<ActionItemRecord[]>;
  };
  meetingService: { getMeeting: (id: string) => Promise<{ id: string; title: string; projectId: string | null }> };
  /**
   * `getTask` (review fix #19/N12; NotFound when there is none): a retry finds the task an interrupted try saved —
   * and a create that failed after saving its task goes on with that task — instead of making a second one.
   */
  taskService: { createTask: (input: NewTaskInput) => Promise<TaskRecord>; getTask?: (id: string) => Promise<TaskRecord> };
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
  /** Review fix #19: the id named in the note's claim (so a retry can find this task). */
  id?: string;
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

  /** The action item an earlier try of this conversion made for this task (an action note), if it can be told. */
  async function madeItemOf(meetingId: string, noteId: string, noteType: string, taskId: string): Promise<ActionItemRecord | undefined> {
    if (noteType !== 'ACTION' || !deps.actionItems?.listByMeeting) return undefined;
    const listed = await deps.actionItems.listByMeeting(meetingId).catch(() => null);
    return listed?.find((a) => a.sourceNoteId === noteId && a.taskId === taskId);
  }

  /** The task with this id, or null when there is none (any other failure is thrown). */
  async function findTask(id: string): Promise<TaskRecord | null> {
    if (!taskService.getTask) return null;
    try {
      return await taskService.getTask(id);
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

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

      // Review fix #19: the claim names the id the task gets. An interrupted earlier try whose task was saved
      // comes back `made`: that task is linked — nothing new is made.
      const madeItem = (taskId: string) => madeItemOf(meetingId, note.id, note.type, taskId);
      const claim = await noteService.claimForTask(meetingId, noteId, taskService.getTask ? { taskExists: async (id) => (await findTask(id)) !== null } : undefined);
      let task: TaskRecord;
      if (claim.made) {
        const earlier = await findTask(claim.taskId);
        if (!earlier) throw new ConflictError('A task is being created from this note right now. Try again in a moment.', 'NOTE_HAS_TASK');
        // Review M3: an earlier try may have put it in a project this person may not use. The note still points
        // at its task (as it would have), but they are told only that the note has one — never shown it.
        if (opts?.canUseProject && earlier.projectId !== projectId && !(await opts.canUseProject(earlier.projectId))) {
          await noteService.linkTask(meetingId, noteId, earlier.id, (await madeItem(earlier.id))?.id, claim.marker);
          throw new ConflictError('A task has already been created from this note.', 'NOTE_HAS_TASK');
        }
        task = earlier;
      } else {
        try {
          task = await taskService.createTask({
            id: claim.taskId,
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
          // N12: saved, then a step after it failed — it is this note's task: go on with it (no second one).
          let saved: TaskRecord | null;
          try {
            saved = taskService.getTask ? await findTask(claim.taskId) : null;
          } catch {
            throw err; // can't tell: the claim stays, and a retry finds out
          }
          if (!saved) {
            await noteService.releaseTaskClaim(noteId, claim.marker).catch(() => {});
            throw err;
          }
          task = saved;
        }
      }

      // An action-item note is tracked on the meeting's action items too, already linked to the
      // task, so nobody types it in twice. A failure here never loses the task. Resuming an interrupted try
      // (#19): the item it made, if any — never a second one.
      let actionItem: ActionItemRecord | undefined;
      let actionItemError: string | undefined;
      if (note.type === 'ACTION' && deps.actionItems && claim.made) {
        actionItem = await madeItem(task.id);
        // Review M4: the interrupted try made none (or it can't be told): said, never guessed at with a second one.
        if (!actionItem) actionItemError = 'The task was created, but it couldn’t be added to the action items.';
      } else if (note.type === 'ACTION' && deps.actionItems) {
        const item = {
          description: title,
          assigneeId: overrides.assigneeId ?? null,
          priority: overrides.priority ?? 'NORMAL',
          // The task's own date when none was picked: its project may make new tasks due today.
          dueDate: dueDate ?? task.dueDate ?? null,
          sourceNoteId: note.id,
          // 1.23.0: under the note's topic, as it was written (none when the note had none).
          agendaItemId: note.agendaItemId ?? null,
          projectId,
          taskId: task.id,
        };
        try {
          try {
            actionItem = await deps.actionItems.addItem(meetingId, createdById, item);
          } catch (err) {
            // A topic the item may not take (the note's isn't on this meeting's agenda): it goes without one.
            if (!(err instanceof ValidationError) || !item.agendaItemId) throw err;
            actionItem = await deps.actionItems.addItem(meetingId, createdById, { ...item, agendaItemId: null });
          }
        } catch {
          actionItemError = 'The task was created, but it couldn’t be added to the action items.';
        }
      }

      // Link first: once the task exists the note must point at it, even if assignment fails. Only while this
      // claim holds (#19). A failure here leaves the claim naming the task: the retry links it.
      const linked = await noteService.linkTask(meetingId, noteId, task.id, actionItem?.id, claim.marker);

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
