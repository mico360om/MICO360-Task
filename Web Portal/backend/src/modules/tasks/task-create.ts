import { ForbiddenError } from '../../lib/http-errors';
import { boardDateFromKey } from './board-date';
import { checkNewTaskContacts } from './external-contact-service';
import { normalizeTagNames } from './tag-service';
import type { AssigneeService } from './assignee-service';
import type { ExternalContactDraft } from './external-contacts';
import type { NewTask, TaskService } from './task-service';
import type { TaskRecord } from './task-repository';
import { NeedsTeamMemberError, type GuestService } from '../guests/guest-service';
import type { CategoryService } from '../categories/category-service';

/** Who is creating the task. */
export interface TaskActor {
  id: string;
  roles: string[];
}

/** The New task form's fields, as POST /tasks reads them (task-routes' createSchema, parsed). */
export type NewTaskBody = Omit<NewTask, 'createdById' | 'tagNames' | 'assigneeIds' | 'externalContacts' | 'guestLinks' | 'categoryIds' | 'boardDate' | 'recurrenceParentId' | 'meetingId' | 'duplicatedFromId' | 'id'> & {
  /** Tag names (find-or-create). */
  tags?: string[];
  /** Present (even `[]`) means exactly these; absent defaults to the project owner. */
  assigneeIds?: string[];
  externalContacts?: ExternalContactDraft[];
  /** 1.24: guests picked from the project's company list (each with this task's note). */
  guests?: { guestId: string; note?: string | null }[];
  /** 1.24: its categories (sent = checked by the project's rule, even `[]`). */
  categoryIds?: string[];
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
  /** 1.24: a new task's guests (and the person who looks after them). */
  guestService?: GuestService;
  /** 1.24: a new task's categories (the project's rule). */
  categoryService?: CategoryService;
  /** Review fix #15: a step after the task was saved that failed (logged; the task is returned all the same). */
  onError?: (err: unknown, what: string, taskId: string) => void;
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
  const { tags, assigneeIds, boardDate, externalContacts: contactDrafts, guests: guestPicks, categoryIds, ...fields } = body;
  // Object-level authorization: a non-admin may only create tasks in projects they belong to.
  const allowed = await p.scopeOf(actor);
  if (allowed && !allowed.includes(fields.projectId)) throw new ForbiddenError(NO_PROJECT_ACCESS);

  const tagNames = tags && tags.length > 0 ? normalizeTagNames(tags) : [];
  const externalContacts = checkNewTaskContacts(contactDrafts);
  // 1.24: guests from the project's company list; categories by the project's rule (sent = checked).
  const guestLinks = guestPicks?.length && p.guestService ? await p.guestService.checkNewTaskGuests(fields.projectId, guestPicks) : [];
  const categories = categoryIds !== undefined && p.categoryService ? await p.categoryService.checkForTask(fields.projectId, categoryIds) : [];
  let assignees: string[] = [];
  if (assigneeIds !== undefined) {
    assignees = p.assigneeService ? await p.assigneeService.assertAssignable(fields.projectId, assigneeIds) : [...new Set(assigneeIds)];
  } else if (p.assigneeService && p.projectOwnerOf) {
    const ownerId = await p.projectOwnerOf(fields.projectId);
    if (ownerId) assignees = await p.assigneeService.eligibleAssignees(fields.projectId, [ownerId]);
  }

  // 1.24: a task with guests needs a person from the team — the website's form says so first.
  if (guestLinks.length > 0 && assignees.length === 0) throw new NeedsTeamMemberError();

  // The task, its tags, its assignees, its guests and its categories are created in one write.
  let created = await p.taskService.createTask({
    ...fields,
    ...(boardDate ? { boardDate: boardDateFromKey(boardDate) } : {}),
    createdById: actor.id,
    tagNames,
    assigneeIds: assignees,
    ...(externalContacts.length ? { externalContacts } : {}),
    ...(guestLinks.length ? { guestLinks } : {}),
    ...(categories.length ? { categoryIds: categories } : {}),
    ...(extra.duplicatedFromId ? { duplicatedFromId: extra.duplicatedFromId } : {}),
  });
  // Review fix #15: the task is saved — the notices, the read-backs and the live update after it are best
  // effort (logged), so a saved task always answers 201 and a retry with the same key never duplicates it.
  // A read-back that fails leaves `assignees` out of the answer, as for a task made without any.
  const taskId = created.id;
  const step = async <T,>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (err) {
      if (p.onError) p.onError(err, what, taskId);
      else console.error(`new task ${taskId}: ${what} failed`, err);
      return undefined;
    }
  };
  let appliedAssignees;
  if (p.assigneeService && assignees.length > 0) {
    const people = p.assigneeService;
    await step('telling the assignees', () => people.notifyAssigned(taskId, assignees, actor.id));
    appliedAssignees = await step('reading its assignees back', () => people.listAssignees(taskId));
  } else if (externalContacts.length > 0 && p.guestService) {
    // The old way in (the app, the extension) with contacts and nobody assigned: the person responsible.
    const guests = p.guestService;
    if (await step('naming the person responsible', () => guests.ensureResponsible(taskId, actor.id))) {
      created = (await step('reading the task back', () => p.taskService.getTask(taskId))) ?? created;
      const people = p.assigneeService;
      if (people) appliedAssignees = await step('reading its assignees back', () => people.listAssignees(taskId));
    }
  }
  const made = created;
  await step('telling open boards', async () => p.broadcast?.(made.projectId, 'task:created', made));
  return {
    ...created,
    ...(tagNames.length > 0 ? { tags: created.tags ?? [] } : {}),
    ...(appliedAssignees ? { assignees: appliedAssignees } : {}),
  };
}
