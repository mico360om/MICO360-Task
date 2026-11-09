import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler, RouteOptions } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../lib/http-errors';
import { ARCHIVE_SELECT, archivedOf } from './project-archive';

/**
 * 1.22: an archived project is read-only on the server too (owner, 3 Nov 2026: "Yes, server
 * refuses too"). Before, only the website hid New task and editing; a change sent straight to the
 * server was saved. Now every write route says here whether an archived project refuses it (409
 * PROJECT_ARCHIVED, ARCHIVE_REFUSED) or not (ARCHIVE_ALLOWED, with why); archive-guard.test.ts scans
 * the route table so a new write route can't be added without saying which.
 *
 * "Archived" is the one rule (project-archive.ts): its own status is ARCHIVED, or all its companies
 * are. Reading and exporting, reopening it, its details, team and companies, and deleting (as
 * today's rules allow) are never refused.
 *
 * The check runs after sign-in and before the route's own work. It answers only for something the
 * person may see: anyone else gets the route's own answer (404/403), so nobody learns from it that
 * a task or meeting exists.
 */
export const PROJECT_ARCHIVED_MESSAGE = 'This project is archived — reopen it first.';
export const PROJECT_ARCHIVED_CODE = 'PROJECT_ARCHIVED';

export class ProjectArchivedError extends HttpError {
  constructor() {
    super(PROJECT_ARCHIVED_MESSAGE, PROJECT_ARCHIVED_CODE, 409);
  }
}

/** Where a refused write's project is found. */
export type ArchiveTarget =
  /** `:id` is a task. */
  | 'task'
  /** `:commentId`, `:itemId` (a checklist item), `:contactId` (an external contact): a task's. */
  | 'comment'
  | 'checklistItem'
  /** 1.23.3: `:listId`, one of a task's checklists. */
  | 'checklistList'
  | 'externalContact'
  /** `:columnId`: a board column. */
  | 'column'
  /** `:id` is the project itself (a new column on its board). */
  | 'project'
  /** `:id` is a meeting — and `body.projectId`, when sent, the project it moves to or a new task goes into. */
  | 'meeting'
  /** `:id` is an action item (its project, else its meeting's). */
  | 'actionItem'
  /** A new task: `body.projectId` (and its `body.columnId`'s project). */
  | 'newTask'
  /** A new meeting: `body.projectId`, when it has one. */
  | 'newMeeting'
  /** Moving `:id` (a task) to another project: out of its own and INTO `body.projectId`. */
  | 'taskToProject'
  /** Moving `body.taskIds` INTO `body.projectId`. */
  | 'tasksToProject'
  /** 1.23: `:id` is a meeting series (its project's). */
  | 'series'
  /** 1.23: "New series…": `body.meetingId`, the meeting it is made with. */
  | 'seriesMeeting';

/** Write routes an archived project refuses. Keys as in route-classes.ts. */
export const ARCHIVE_REFUSED: Readonly<Record<string, ArchiveTarget>> = {
  // The board: its columns and the order of its cards.
  'POST /projects/:id/columns': 'project',
  'PUT /columns/:columnId': 'column',
  'PUT /columns/:columnId/tasks/reorder': 'column',
  // New tasks, task edits, moves and status changes.
  'POST /tasks': 'newTask',
  'PUT /tasks/:id': 'task',
  'PATCH /tasks/:id/move': 'task',
  'POST /tasks/:id/assignees': 'task',
  'POST /tasks/:id/assignees/swap': 'task',
  'POST /tasks/:id/dependencies': 'task',
  'PUT /tasks/:id/tags': 'task',
  'POST /tasks/:id/approve': 'task',
  'POST /tasks/:id/send-back': 'task',
  'PUT /tasks/:id/client-visible': 'task',
  // 1.23.7: "Show to client" on one of the task's files.
  'PUT /tasks/:id/attachments/:attachmentId/client-visible': 'task',
  'POST /tasks/:id/external-contacts': 'task',
  'PUT /external-contacts/:contactId': 'externalContact',
  // Moving a task to another project: out of an archived one, or INTO one.
  'POST /tasks/:id/move-to-project': 'taskToProject',
  'POST /tasks/move-to-project': 'tasksToProject',
  // Comments, files and checklists.
  'POST /tasks/:id/comments': 'task',
  'PUT /comments/:commentId': 'comment',
  'POST /tasks/:id/attachments': 'task',
  'POST /tasks/:id/checklist': 'task',
  'PUT /tasks/:id/checklist/reorder': 'task',
  'PUT /checklist/:itemId': 'checklistItem',
  // 1.23.3 nested checklists: adding, moving, copying, people and dates, restoring.
  'POST /tasks/:id/checklist/batch': 'task',
  'POST /tasks/:id/checklists': 'task',
  'POST /tasks/:id/checklist/restore': 'task',
  'POST /checklist/:itemId/duplicate': 'checklistItem',
  'POST /checklist/:itemId/move': 'checklistItem',
  'PUT /checklists/:listId': 'checklistList',
  'POST /checklists/:listId/duplicate': 'checklistList',
  // Meetings in the project: a new one, and changing one — its details, people, agenda, notes,
  // action items and minutes.
  'POST /meetings': 'newMeeting',
  'PUT /meetings/:id': 'meeting',
  'POST /meetings/:id/cancel': 'meeting',
  'POST /meetings/:id/duplicate': 'meeting',
  'POST /meetings/:id/invites': 'meeting',
  'POST /meetings/:id/attendees': 'meeting',
  'PATCH /meetings/:id/attendees/:attendeeId': 'meeting',
  'POST /meetings/:id/agenda': 'meeting',
  'PATCH /meetings/:id/agenda/:itemId': 'meeting',
  'PUT /meetings/:id/agenda/reorder': 'meeting',
  'POST /meetings/:id/notes': 'meeting',
  'PATCH /meetings/:id/notes/:noteId': 'meeting',
  'POST /meetings/:id/notes/:noteId/restore': 'meeting',
  'POST /meetings/:id/notes/:noteId/task': 'meeting',
  'POST /meetings/:id/action-items': 'meeting',
  'PATCH /action-items/:id': 'actionItem',
  'PUT /meetings/:id/final-minutes': 'meeting',
  'POST /meetings/:id/final-minutes/draft': 'meeting',
  'POST /meetings/:id/final-minutes/approve': 'meeting',
  'POST /meetings/:id/final-minutes/reopen': 'meeting',
  'PUT /meetings/:id/client-visibility': 'meeting',
  // 1.22 Lane AI (§10): using the AI's offered draft writes the minutes.
  'POST /meetings/:id/final-minutes/ai-draft/:jobId/use': 'meeting',
  // 1.23 Meeting series: which of the project's meetings go together is a change to the project.
  'POST /meeting-series': 'seriesMeeting',
  'PATCH /meeting-series/:id': 'series',
  'POST /meeting-series/:id/meetings': 'series',
  'DELETE /meeting-series/:id/meetings/:meetingId': 'series',
  'POST /meeting-series/:id/merge': 'series',
  // 1.23: Make Teams link writes the meeting's online link.
  'POST /meetings/:id/teams-link': 'meeting',
};

/** Write routes (one project's, task's or meeting's) an archived project does not refuse, and why. */
export const ARCHIVE_ALLOWED: Readonly<Record<string, string>> = {
  'POST /projects': 'a new project',
  'PUT /projects/:id': 'its details and status — reopening it; administrators change its status and companies',
  'POST /projects/:id/archive': 'archiving it',
  'DELETE /projects/:id': 'deleting, as today',
  'POST /projects/:id/image': 'its details',
  'DELETE /projects/:id/image': 'its details',
  'POST /projects/:id/members': 'its team: who may open it',
  'PATCH /projects/:id/members/:userId': 'its team: who may open it',
  'DELETE /projects/:id/members/:userId': 'its team: who may open it',
  'POST /projects/:id/inspections': 'inspections refuse it themselves (inspection-service)',
  'POST /projects/:id/client-shares': 'client sharing refuses it itself (client-access-service)',
  'DELETE /projects/:id/client-shares/:shareId': 'deleting, as today',
  'POST /projects/:id/client-shares/:shareId/resend': 'an email about a share already made',
  'DELETE /columns/:columnId': 'deleting, as today',
  'DELETE /tasks/:id': 'deleting, as today',
  'DELETE /tasks/:id/assignees/:userId': 'deleting, as today',
  'DELETE /tasks/:id/dependencies/:dependsOnTaskId': 'deleting, as today',
  'DELETE /tasks/:id/tags/:tagId': 'deleting, as today',
  'DELETE /comments/:commentId': 'deleting, as today',
  'DELETE /checklist/:itemId': 'deleting, as today',
  'DELETE /checklists/:listId': 'deleting, as today',
  'DELETE /attachments/:attachmentId': 'deleting, as today',
  'DELETE /external-contacts/:contactId': 'deleting, as today',
  'POST /tasks/:id/watch': 'following a task is the person’s own, not a change to it',
  'DELETE /tasks/:id/watch': 'following a task is the person’s own, not a change to it',
  'POST /tasks/move-preview': 'a read: what a move would do (the move itself is refused)',
  'DELETE /meetings/:id': 'deleting, as today',
  'DELETE /meetings/:id/attendees/:attendeeId': 'deleting, as today',
  'DELETE /meetings/:id/agenda/:itemId': 'deleting, as today',
  'DELETE /meetings/:id/notes/:noteId': 'deleting, as today',
  'DELETE /action-items/:id': 'deleting, as today',
  'POST /meetings/:id/minutes/send': 'sending the minutes as they are: an export',
  'DELETE /inspections/:id': 'inspections keep their own rule (inspection-service)',
  'PUT /inspections/:id/answers': 'inspections keep their own rule (inspection-service)',
  'POST /inspections/:id/finish': 'inspections keep their own rule (inspection-service)',
  'POST /inspections/:id/reopen': 'inspections keep their own rule (inspection-service)',
  'POST /inspections/:id/take-over': 'inspections keep their own rule (inspection-service)',
  'POST /inspections/:id/follow-ups': 'inspections keep their own rule (inspection-service)',
  'PUT /inspections/:id/client-visibility': 'inspections keep their own rule (inspection-service)',
  'POST /conversations/:id/messages': 'chat: the team can still talk about it',
  'POST /conversations/:id/attachments': 'chat: the team can still talk about it',
  'POST /conversations/:id/read': 'the person’s own',
  'POST /conversations/:id/delivered': 'the person’s own',
  'PUT /conversations/:id/prefs': 'the person’s own',
  'PATCH /messages/:id': 'chat: the team can still talk about it',
  'DELETE /messages/:id': 'deleting, as today',
  'POST /messages/:id/reactions': 'chat: the team can still talk about it',
  'DELETE /messages/:id/reactions/:emoji': 'deleting, as today',
  'POST /templates/projects/from-project/:projectId': 'a read: saving it as a template',
  'POST /templates/tasks/from-task/:taskId': 'a read: saving a task as a template',
  'POST /templates/projects/:id/projects': 'a new project',
  'POST /ai/summary': 'a read: nothing is saved',
  'POST /ai/breakdown': 'a read: nothing is saved',
  'POST /ai/suggest-priority': 'a read: nothing is saved',
  'POST /ai/draft-agenda': 'a read: nothing is saved',
  'POST /ai/write-meeting-description': 'a read: nothing is saved',
  // 1.22 integration (lane N's Notifications page): a notification is the person's own row, read or
  // removed by them alone — not a change to the project it is about.
  'PUT /notifications/:id/read': 'the person’s own notification, not a change to its project',
  'POST /notifications/read-all': 'the person’s own notifications, not a change to any project',
  'POST /notifications/:id/unread': 'the person’s own notification, not a change to its project',
  'DELETE /notifications/:id': 'the person’s own notification, not a change to its project',
  'POST /notifications/bulk': 'the person’s own notifications, not a change to any project',
  // 1.22 Lane AI (§10): putting the AI's offer (or a failure's notice) away changes nothing in the minutes.
  'POST /meetings/:id/final-minutes/ai-draft/:jobId/discard': 'putting away the AI’s offered draft: the minutes don’t change',
  // 1.23: deleting a series (its meetings stay).
  'DELETE /meeting-series/:id': 'deleting, as today (its meetings stay)',
  // 1.23.1 Merge tasks: the merge and its undo refuse archived (and completed) projects themselves —
  // they check every project involved, not one (task-merge/merge-service.ts); the preview is a read.
  'POST /tasks/merge-preview': 'a read: what a merge would do (the merge itself checks every project)',
  'POST /tasks/merge': 'the merge refuses archived and completed projects itself, for every task involved (merge-service)',
  'POST /task-merges/:mergeId/undo': 'Undo refuses archived projects itself, for every task involved (merge-service)',
  // 1.23.6: a saved search shared with a project's team changes nothing in the project (its owner's search).
  'PUT /search/saved/:id/share': 'the owner’s saved search shown to a team: nothing in the project changes',
};

/** What a refused write is about: a project, and the meeting when it is one (its people may see it without the project). */
export interface ArchiveSubject {
  projectId: string | null;
  meetingId?: string | null;
  /** An action item's assignee and creator: they may change their own item without seeing its meeting, so they know it is there. */
  ownerIds?: readonly string[];
}

/** At most this many tasks are looked at in one bulk move (the route itself takes at most 500). */
export const MAX_GUARDED_TASKS = 1000;

export type ArchiveKind = 'task' | 'comment' | 'checklistItem' | 'checklistList' | 'externalContact' | 'column' | 'meeting' | 'actionItem' | 'series';

/** The facts the guard reads (Prisma: createPrismaArchiveLookup). */
export interface ArchiveLookup {
  /** The project (and meeting) of one thing; null when there is no such thing (the route answers then). */
  subjectOf(kind: ArchiveKind, id: string): Promise<ArchiveSubject | null>;
  /** Is this live project archived (its own status, or all its companies)? */
  isArchived(projectId: string): Promise<boolean>;
  /** The projects of these (live) tasks, each once — a bulk move's, in one read. */
  projectsOfTasks?(taskIds: readonly string[]): Promise<string[]>;
}

export interface ArchiveGuardDeps {
  lookup: ArchiveLookup;
  /** May this person see the project? (Its tasks, columns, comments… follow it.) */
  canSeeProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** May this person see the meeting (also as an invitee)? */
  canSeeMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The guard's check for one route: throws ProjectArchivedError when the write is refused. */
export function createArchiveGuard(deps: ArchiveGuardDeps) {
  const { lookup } = deps;
  const of = async (kind: ArchiveKind, id: unknown): Promise<ArchiveSubject[]> => {
    const key = str(id);
    const s = key ? await lookup.subjectOf(kind, key) : null;
    return s ? [s] : [];
  };
  const project = (id: unknown): ArchiveSubject[] => (str(id) ? [{ projectId: str(id) }] : []);

  async function subjectsOf(target: ArchiveTarget, req: FastifyRequest): Promise<ArchiveSubject[]> {
    const p = (req.params ?? {}) as Record<string, unknown>;
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    switch (target) {
      case 'task':
        return of('task', p.id);
      case 'comment':
        return of('comment', p.commentId);
      case 'checklistItem':
        return of('checklistItem', p.itemId);
      case 'checklistList':
        return of('checklistList', p.listId);
      case 'externalContact':
        return of('externalContact', p.contactId);
      case 'column':
        return of('column', p.columnId);
      case 'project':
        return project(p.id);
      case 'meeting':
        return [...(await of('meeting', p.id)), ...project(b.projectId)];
      case 'actionItem':
        return of('actionItem', p.id);
      case 'newTask':
        return [...project(b.projectId), ...(await of('column', b.columnId))];
      case 'newMeeting':
        return project(b.projectId);
      case 'series':
        return of('series', p.id);
      case 'seriesMeeting':
        return of('meeting', b.meetingId);
      case 'taskToProject':
        return [...(await of('task', p.id)), ...project(b.projectId)];
      case 'tasksToProject': {
        const ids = [...new Set((Array.isArray(b.taskIds) ? b.taskIds : []).filter((id): id is string => !!str(id)))].slice(0, MAX_GUARDED_TASKS);
        const sources = lookup.projectsOfTasks
          ? (await lookup.projectsOfTasks(ids)).map((projectId) => ({ projectId }))
          : (await Promise.all(ids.map((id) => of('task', id)))).flat();
        return [...project(b.projectId), ...sources];
      }
    }
  }

  /** Refuses the write when it touches an archived project the person can see. */
  return async function check(target: ArchiveTarget, req: FastifyRequest): Promise<void> {
    const user = req.user;
    if (!user) return; // not signed in: the route answers 401 itself
    const roles = user.roles ?? [];
    const asked = new Set<string>(); // each project once (a bulk move's tasks share a few)
    for (const s of await subjectsOf(target, req)) {
      if (!s.projectId || (asked.has(s.projectId) && !s.meetingId) || !(await lookup.isArchived(s.projectId))) continue;
      asked.add(s.projectId);
      const sees =
        (s.ownerIds ?? []).includes(user.id) ||
        (s.meetingId ? await deps.canSeeMeeting(user.id, roles, s.meetingId) : await deps.canSeeProject(user.id, roles, s.projectId));
      if (sees) throw new ProjectArchivedError();
    }
  };
}

export type ArchiveGuard = ReturnType<typeof createArchiveGuard>;

/**
 * Put the check on every refused route registered on `app` from now on, after its own preHandlers
 * (sign-in first). `prefix`: the API's (route keys are written without it).
 */
export function installArchiveGuard(app: FastifyInstance, guard: ArchiveGuard, prefix = ''): void {
  app.addHook('onRoute', (route: RouteOptions) => {
    const path = route.url.startsWith(prefix) ? route.url.slice(prefix.length) || '/' : route.url;
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      const target = ARCHIVE_REFUSED[`${String(method).toUpperCase()} ${path}`];
      if (!target) continue;
      const own = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
      const archived: preHandlerAsyncHookHandler = async (req) => guard(target, req);
      route.preHandler = [...own, archived];
      return;
    }
  });
}

/** The guard's facts over the database. */
export function createPrismaArchiveLookup(prisma: PrismaClient): ArchiveLookup {
  const taskProject = async (where: { id: string }) => (await prisma.task.findFirst({ where: { ...where, deletedAt: null }, select: { projectId: true } }))?.projectId ?? null;
  return {
    async subjectOf(kind, id) {
      switch (kind) {
        case 'task': {
          const projectId = await taskProject({ id });
          return projectId ? { projectId } : null;
        }
        case 'comment': {
          const c = await prisma.comment.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } });
          return c ? { projectId: c.task.projectId } : null;
        }
        case 'checklistItem': {
          const i = await prisma.checklistItem.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } });
          return i ? { projectId: i.task.projectId } : null;
        }
        case 'checklistList': {
          const l = await prisma.checklistList.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } });
          return l ? { projectId: l.task.projectId } : null;
        }
        case 'externalContact': {
          const c = await prisma.taskExternalContact.findUnique({ where: { id }, select: { task: { select: { projectId: true } } } });
          return c ? { projectId: c.task.projectId } : null;
        }
        case 'column': {
          const c = await prisma.kanbanColumn.findUnique({ where: { id }, select: { projectId: true } });
          return c ? { projectId: c.projectId } : null;
        }
        case 'meeting': {
          const m = await prisma.meeting.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
          return m ? { projectId: m.projectId, meetingId: id } : null;
        }
        case 'series': {
          const s = await prisma.meetingSeries.findUnique({ where: { id }, select: { projectId: true } });
          return s ? { projectId: s.projectId } : null;
        }
        case 'actionItem': {
          const a = await prisma.actionItem.findUnique({ where: { id }, select: { projectId: true, meetingId: true, assigneeId: true, createdById: true, meeting: { select: { projectId: true } } } });
          return a ? { projectId: a.projectId ?? a.meeting?.projectId ?? null, meetingId: a.meetingId, ownerIds: [a.assigneeId, a.createdById].filter((x): x is string => !!x) } : null;
        }
      }
    },
    async isArchived(projectId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: ARCHIVE_SELECT });
      return p ? archivedOf(p) : false;
    },
    async projectsOfTasks(taskIds) {
      if (taskIds.length === 0) return [];
      const rows = await prisma.task.findMany({ where: { id: { in: [...taskIds] }, deletedAt: null }, select: { projectId: true }, distinct: ['projectId'] });
      return rows.map((r) => r.projectId);
    },
  };
}

/** For changes made outside the routes (MICO AI's confirmed proposals): refuse an archived project's. */
export async function assertProjectOpen(lookup: ArchiveLookup, subject: ArchiveSubject | null): Promise<void> {
  if (subject?.projectId && (await lookup.isArchived(subject.projectId))) throw new ProjectArchivedError();
}
