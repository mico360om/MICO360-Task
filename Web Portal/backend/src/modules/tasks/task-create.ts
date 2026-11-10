import { ForbiddenError } from '../../lib/http-errors';
import { boardDateFromKey } from './board-date';
import { checkNewTaskContacts } from './external-contact-service';
import { normalizeTagNames } from './tag-service';
import type { AssigneeService } from './assignee-service';
import type { ExternalContactDraft } from './external-contacts';
import type { NewTask, TaskService } from './task-service';
import type { TaskRecord } from './task-repository';

/** Who is creating the task. */
export interface TaskActor {
  id: string;
  roles: string[];
}

/** The New task form's fields, as POST /tasks reads them (task-routes' createSchema, parsed). */
export type NewTaskBody = Omit<NewTask, 'createdById' | 'tagNames' | 'assigneeIds' | 'externalContacts' | 'boardDate' | 'recurrenceParentId' | 'meetingId' | 'duplicatedFromId'> & {
  /** Tag names (find-or-create). */
  tags?: string[];
  /** Present (even `[]`) means exactly these; absent defaults to the project owner. */
  assigneeIds?: string[];
  externalContacts?: ExternalContactDraft[];
  /** The board day (YYYY-MM-DD); absent, the server's own rule (today). */
  boardDate?: string;
};

/** What creating a task needs: the same for POST /tasks and for a duplicate (task-duplicate.ts). */
export interface NewTaskPipeline {
  taskService: TaskService;
  /** The person's project scope: `null` for an administrator (or unscoped), else the projects they may work in. */
  scopeOf: (actor: TaskActor) => Promise<string[] | null>;
  /** When provided, `assigneeIds` are checked (active members of the project) and the assignees notified. */
  assigneeService?: AssigneeService;
  /** A new task sent without `assigneeIds` goes to its project's owner. */
  projectOwnerOf?: (projectId: string) => Promise<string | null>;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
}

/** A new task as POST /tasks answers it: its tags and assignees (in full) when it was given some. */
export type CreatedTask = Omit<TaskRecord, 'assignees'> & { assignees?: Array<{ id: string }> };

export const NO_PROJECT_ACCESS = 'You do not have access to this project.';

/**
 * The one way a task is created from a request (POST /tasks, and Duplicate): the project must be one the
 * person may work in (403), then everything is checked before anything is written — the tag names, the
 * external contacts and the assignees (active members of the project; an explicit list, even an empty
 * one, is used as is; only a request without `assigneeIds` falls back to the project owner) — and the
 * task, its tags, assignees and external contacts are written in one go. The assignees are told, and
 * the project's live boards hear it.
 *
 * `extra.duplicatedFromId`: Duplicate Task — the task it is a copy of (kept with it).
 */
export async function createNewTask(p: NewTaskPipeline, actor: TaskActor, body: NewTaskBody, extra: { duplicatedFromId?: string } = {}): Promise<CreatedTask> {
  const { tags, assigneeIds, boardDate, externalContacts: contactDrafts, ...fields } = body;
  // Object-level authorization: a non-admin may only create tasks in projects they belong to.
  const allowed = await p.scopeOf(actor);
  if (allowed && !allowed.includes(fields.projectId)) throw new ForbiddenError(NO_PROJECT_ACCESS);

  const tagNames = tags && tags.length > 0 ? normalizeTagNames(tags) : [];
  const externalContacts = checkNewTaskContacts(contactDrafts);
  let assignees: string[] = [];
  if (assigneeIds !== undefined) {
    assignees = p.assigneeService ? await p.assigneeService.assertAssignable(fields.projectId, assigneeIds) : [...new Set(assigneeIds)];
  } else if (p.assigneeService && p.projectOwnerOf) {
    const ownerId = await p.projectOwnerOf(fields.projectId);
    if (ownerId) assignees = await p.assigneeService.eligibleAssignees(fields.projectId, [ownerId]);
  }

  const created = await p.taskService.createTask({
    ...fields,
    ...(boardDate ? { boardDate: boardDateFromKey(boardDate) } : {}),
    createdById: actor.id,
    tagNames,
    assigneeIds: assignees,
    ...(externalContacts.length ? { externalContacts } : {}),
    ...(extra.duplicatedFromId ? { duplicatedFromId: extra.duplicatedFromId } : {}),
  });
  let appliedAssignees;
  if (p.assigneeService && assignees.length > 0) {
    await p.assigneeService.notifyAssigned(created.id, assignees, actor.id);
    appliedAssignees = await p.assigneeService.listAssignees(created.id);
  }
  p.broadcast?.(created.projectId, 'task:created', created);
  return {
    ...created,
    ...(tagNames.length > 0 ? { tags: created.tags ?? [] } : {}),
    ...(appliedAssignees ? { assignees: appliedAssignees } : {}),
  };
}
