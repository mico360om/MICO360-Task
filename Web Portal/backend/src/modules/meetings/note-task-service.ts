import { ValidationError } from '../../lib/http-errors';
import type { Priority } from '../tasks/task-repository';
import type { TaskRecord } from '../tasks/task-repository';
import type { NoteService } from './note-service';
import type { NoteRecord } from './note-repository';

/** Collaborators, kept as narrow structural types so this composes services without hard coupling. */
export interface NoteTaskDeps {
  noteService: Pick<NoteService, 'getNote' | 'linkTask'>;
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

export interface NoteTaskService {
  createTaskFromNote(
    meetingId: string,
    noteId: string,
    createdById: string,
    overrides: CreateTaskFromNoteOverrides,
  ): Promise<{ task: TaskRecord; note: NoteRecord }>;
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
 * note + meeting and honoring editable overrides, then back-linking the note to the task.
 */
export function createNoteTaskService(deps: NoteTaskDeps): NoteTaskService {
  const { noteService, meetingService, taskService, columnService } = deps;

  return {
    async createTaskFromNote(meetingId, noteId, createdById, overrides) {
      const note = await noteService.getNote(meetingId, noteId);
      const meeting = await meetingService.getMeeting(meetingId);

      const projectId = overrides.projectId ?? meeting.projectId;
      if (!projectId) {
        throw new ValidationError('Select a project for this task — the meeting is standalone.');
      }

      let columnId = overrides.columnId ?? undefined;
      if (!columnId) {
        const columns = await columnService.listColumns(projectId);
        const enabled = columns.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
        const target = (enabled[0] ?? [...columns].sort((a, b) => a.position - b.position)[0]);
        if (!target) throw new ValidationError('That project has no columns to place the task in.');
        columnId = target.id;
      }

      const title = (overrides.title ?? '').trim() || deriveTitle(note.body);
      const typeLabel = TYPE_LABELS[note.type] ?? 'note';
      const description =
        overrides.description !== undefined
          ? overrides.description
          : `${note.body}\n\n— From the ${typeLabel} in meeting "${meeting.title}".`;

      const dueDate = overrides.dueDate ? new Date(overrides.dueDate) : undefined;
      if (dueDate && Number.isNaN(dueDate.getTime())) throw new ValidationError('Invalid due date.');

      const task = await taskService.createTask({
        title,
        description,
        projectId,
        columnId,
        createdById,
        ...(overrides.priority ? { priority: overrides.priority } : {}),
        ...(dueDate ? { dueDate } : {}),
      });

      if (overrides.assigneeId && deps.assignees) {
        await deps.assignees.assignUsers(task.id, [overrides.assigneeId], createdById);
      }

      const linked = await noteService.linkTask(meetingId, noteId, task.id);
      return { task, note: linked };
    },
  };
}
