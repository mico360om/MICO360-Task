import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import type { ExternalContactService } from './external-contact-service';
import type { ExternalContactRecord } from './external-contact-repository';
import type { TaskRecord } from './task-repository';
import { idString } from './validation';

/**
 * A field as sent: text (checked and cleaned by the shared rules, which say what is wrong in plain
 * words) or null to clear it. Bounded here only so a huge body can't reach the checks.
 */
const field = z.string().max(5000).nullable().optional();
/** An external contact as sent (to add or change one, or with a new task). */
export const externalContactSchema = z.object({ name: field, company: field, designation: field, email: field, phone: field, remarks: field });
const contactSchema = externalContactSchema;
const suggestQuery = z.object({ q: z.string().max(120).optional() });

type Check = (userId: string, roles: string[], id: string) => Promise<boolean>;

export interface ExternalContactRouteDeps {
  service: ExternalContactService;
  guard: AuthGuard;
  /** May this person see the task (and so its contacts)? */
  canViewTask?: Check;
  /** May this person add, change or remove the task's contacts — whoever may edit the task. Defaults to canViewTask. */
  canEditTask?: Check;
  /** May this person see the project (its earlier contacts are suggested)? */
  canViewProject?: Check;
  /** Tell open boards and task views that the task changed (`task:updated`, with the task as it is now). */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** The task as it is now, for that broadcast. */
  taskOf?: (taskId: string) => Promise<TaskRecord | null>;
  /** Write a line to the task's history (who added, changed or removed which contact). */
  recordActivity?: RecordTaskActivity;
}

const noAccess = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };
const cannotEdit = { error: { code: 'FORBIDDEN', message: 'You can’t change the external contacts of this task.' } };
const noProject = { error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } };

/** The contact as the task's history names it. */
const named = (c: ExternalContactRecord) => ({ name: c.name, company: c.company });

export async function registerExternalContactRoutes(app: FastifyInstance, deps: ExternalContactRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const ask = (check: Check | undefined, req: FastifyRequest, id: string) => (check ? check(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true));
  const canView = (req: FastifyRequest, taskId: string) => ask(deps.canViewTask, req, taskId);
  const canEdit = async (req: FastifyRequest, taskId: string) => (await canView(req, taskId)) && (await ask(deps.canEditTask, req, taskId));

  /** After a change: open boards and task views refresh, and the history gets its line. */
  async function changed(req: FastifyRequest, taskId: string, action: string, contact: ExternalContactRecord): Promise<void> {
    if (deps.broadcast && deps.taskOf) {
      const task = await deps.taskOf(taskId).catch(() => null);
      if (task) deps.broadcast(task.projectId, 'task:updated', task);
    }
    await noteActivity(deps.recordActivity, { taskId, userId: req.user!.id, action, meta: named(contact) });
  }

  app.get('/tasks/:id/external-contacts', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(noAccess);
    return { data: await service.list(id) };
  });

  app.post('/tasks/:id/external-contacts', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(noAccess);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const { alreadyOnTask, ...contact } = await service.add(id, contactSchema.parse(req.body ?? {}), req.user!.id);
    // 1.24: the task had this guest already — no second history line.
    if (!alreadyOnTask) await changed(req, id, 'EXTERNAL_CONTACT_ADDED', contact);
    return reply.status(201).send({ data: contact });
  });

  // A contact's own routes find its task first (404 once it is gone) and check access to that task.
  app.put('/external-contacts/:contactId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { contactId } = req.params as { contactId: string };
    const body = contactSchema.parse(req.body ?? {});
    const existing = await service.get(idString.parse(contactId));
    if (!(await canView(req, existing.taskId))) return reply.status(403).send(noAccess);
    if (!(await canEdit(req, existing.taskId))) return reply.status(403).send(cannotEdit);
    const { after, changed: didChange } = await service.update(existing.id, body, req.user!.id);
    if (didChange) await changed(req, after.taskId, 'EXTERNAL_CONTACT_CHANGED', after);
    return { data: after };
  });

  app.delete('/external-contacts/:contactId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { contactId } = req.params as { contactId: string };
    const existing = await service.get(idString.parse(contactId));
    if (!(await canView(req, existing.taskId))) return reply.status(403).send(noAccess);
    if (!(await canEdit(req, existing.taskId))) return reply.status(403).send(cannotEdit);
    const removed = await service.remove(existing.id);
    await changed(req, removed.taskId, 'EXTERNAL_CONTACT_REMOVED', removed);
    return reply.status(204).send();
  });

  // Earlier contacts on this project's tasks, by the start of a word of the name or company typed.
  app.get('/projects/:projectId/external-contacts', { preHandler: guard.authenticate }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await ask(deps.canViewProject, req, projectId))) return reply.status(403).send(noProject);
    const { q } = suggestQuery.parse(req.query);
    return { data: await service.suggest(projectId, q ?? '', { id: req.user!.id, roles: req.user!.roles ?? [] }) };
  });
}
