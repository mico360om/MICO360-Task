import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { NoteService } from './note-service';
import type { NoteTaskService } from './note-task-service';
import type { AuthGuard } from '../auth/auth-guard';

const typeEnum = z.enum(['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createTaskFromNoteSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  columnId: z.string().min(1).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

const addSchema = z.object({
  body: z.string().min(1),
  type: typeEnum.optional(),
  agendaItemId: z.string().min(1).nullable().optional(),
  highlighted: z.boolean().optional(),
});

const patchSchema = z.object({
  body: z.string().min(1).optional(),
  type: typeEnum.optional(),
  agendaItemId: z.string().min(1).nullable().optional(),
  highlighted: z.boolean().optional(),
});

export interface NoteRouteDeps {
  noteService: NoteService;
  guard: AuthGuard;
  /** Object-level view/edit authorization on the parent meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** When present, enables ⭐ Create Task from Note. */
  noteTaskService?: NoteTaskService;
  /** Project ids the caller may target when creating a task (null = admin/any). */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
}

export async function registerNoteRoutes(app: FastifyInstance, deps: NoteRouteDeps): Promise<void> {
  const { noteService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const notAuthor = { error: { code: 'FORBIDDEN', message: 'You can only change your own notes.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);
  const canModerate = (req: FastifyRequest, id: string): Promise<boolean> => noteService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);
  const canUseProject = async (req: FastifyRequest, projectId: string): Promise<boolean> => {
    if (!deps.accessibleProjectIds) return true;
    const allowed = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
    return !allowed || allowed.includes(projectId);
  };

  app.get('/meetings/:id/notes', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    return { data: await noteService.listNotes(id) };
  });

  app.post('/meetings/:id/notes', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const note = await noteService.addNote(id, req.user!.id, addSchema.parse(req.body));
    return reply.status(201).send({ data: note });
  });

  app.patch('/meetings/:id/notes/:noteId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, noteId } = req.params as { id: string; noteId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const patch = patchSchema.parse(req.body);
    const note = await noteService.getNote(id, noteId);
    if (note.authorId !== req.user!.id) {
      // Only the author edits a note's content; the organizer may still highlight it.
      const highlightOnly = Object.keys(patch).every((k) => k === 'highlighted');
      if (!highlightOnly || !(await canModerate(req, id))) return reply.status(403).send(notAuthor);
    }
    return { data: await noteService.updateNote(id, noteId, patch) };
  });

  app.delete('/meetings/:id/notes/:noteId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, noteId } = req.params as { id: string; noteId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const note = await noteService.getNote(id, noteId);
    if (note.authorId !== req.user!.id && !(await canModerate(req, id))) return reply.status(403).send(notAuthor);
    await noteService.removeNote(id, noteId);
    return reply.status(204).send();
  });

  // Undo a delete (MTG-07): same rule as deleting — the author, or someone who moderates the meeting.
  app.post('/meetings/:id/notes/:noteId/restore', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, noteId } = req.params as { id: string; noteId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const note = await noteService.getDeletedNote(id, noteId);
    if (note.authorId !== req.user!.id && !(await canModerate(req, id))) return reply.status(403).send(notAuthor);
    return { data: await noteService.restoreNote(id, noteId) };
  });

  // ⭐ Create Task from Note — promote a note into a board task and back-link it.
  if (deps.noteTaskService) {
    const noteTaskService = deps.noteTaskService;
    app.post('/meetings/:id/notes/:noteId/task', { preHandler: guard.authenticate }, async (req, reply) => {
      const { id, noteId } = req.params as { id: string; noteId: string };
      if (!(await canView(req, id))) return reply.status(403).send(forbidden);
      const body = createTaskFromNoteSchema.parse(req.body);
      // A chosen target project must be one the caller can access (fail fast before any lookups).
      if (body.projectId && !(await canUseProject(req, body.projectId))) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to that project.' } });
      }
      // The service re-checks whichever project it resolves to — including the meeting's own.
      const result = await noteTaskService.createTaskFromNote(id, noteId, req.user!.id, body, {
        canUseProject: (projectId) => canUseProject(req, projectId),
      });
      return reply.status(201).send({ data: result });
    });
  }
}
