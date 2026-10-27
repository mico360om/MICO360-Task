import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { ProjectService } from '../projects/project-service';
import type { ProjectNotices } from '../projects/project-notices';
import { createSchema as projectCreateSchema } from '../projects/project-routes';
import { calendarDay, idString, longText, requiredText } from '../tasks/validation';
import { TEMPLATE_LIMITS, type TemplateActor, type TemplateService } from './template-service';
import type { ProjectTemplateInput, ProjectTemplateRecord, TaskTemplateInput, TaskTemplateRecord } from './template-repository';

const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const categoryEnum = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
/** Empty text is no text. */
const optionalText = longText.nullable().optional().transform((s) => (s && s.trim() ? s.trim() : null));
const checklistSchema = z.array(requiredText).max(TEMPLATE_LIMITS.checklistItems).default([]);

const projectTemplateSchema = z.object({
  name: requiredText,
  description: optionalText,
  columns: z.array(z.object({ name: requiredText, category: categoryEnum, color: z.string().trim().min(1).max(64) })).min(1).max(TEMPLATE_LIMITS.columns),
  roles: z.array(z.object({ key: idString, name: z.string().trim().min(1).max(TEMPLATE_LIMITS.roleName) })).max(TEMPLATE_LIMITS.roles).default([]),
  tasks: z
    .array(
      z.object({
        title: requiredText,
        description: optionalText,
        priority: priorityEnum.default('NORMAL'),
        dueOffsetDays: z.number().int().min(TEMPLATE_LIMITS.minOffset).max(TEMPLATE_LIMITS.maxOffset).nullable().default(null),
        roleKey: idString.nullable().default(null),
        checklist: checklistSchema,
      }),
    )
    .max(TEMPLATE_LIMITS.tasks)
    .default([]),
});

const taskTemplateSchema = z.object({ name: requiredText, title: requiredText, description: optionalText, priority: priorityEnum.default('NORMAL'), checklist: checklistSchema });

const fromProjectSchema = z.object({
  name: requiredText,
  description: optionalText,
  // A role name for some of the people on its tasks (empty: their tasks are left unassigned).
  roles: z.array(z.object({ userId: idString, name: z.string().max(TEMPLATE_LIMITS.roleName * 2) })).max(500).default([]),
  // Everyone can see a template: the saver may leave the tasks' descriptions out.
  includeDescriptions: z.boolean().default(true),
});
const fromTaskSchema = z.object({ name: z.string().max(191).optional(), includeDescription: z.boolean().default(true) });

/** A project from a template: the New project form's fields, its start day and who fills each role. */
const useSchema = projectCreateSchema.extend({
  startDate: calendarDay,
  roles: z.record(idString, idString.nullable()).optional(),
  /** When the template the preview showed was last changed (its plan's `template.updatedAt`): a later change is refused. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

/** A template of 500 tasks with long descriptions is more than the usual 1 MB request. */
const TEMPLATE_BODY_LIMIT = 8 * 1024 * 1024;

export interface TemplateRouteDeps {
  templateService: TemplateService;
  guard: AuthGuard;
  /** Creates the project when one is made from a template (the New project form's path). */
  projectService?: ProjectService;
  audit?: AuditService;
  /** Tells the owner and the team of a project made from a template that they're on it. */
  notices?: ProjectNotices;
}

/** What the audit log keeps of a project template: enough to see what changed. */
const projectTemplateAudit = (t: ProjectTemplateRecord) => ({
  name: t.name,
  columns: t.columns.map((c) => c.name),
  roles: t.roles.map((r) => r.name),
  taskCount: t.tasks.length,
});
const taskTemplateAudit = (t: TaskTemplateRecord) => ({ name: t.name, title: t.title, priority: t.priority, checklistCount: t.checklist.length });

export async function registerTemplateRoutes(app: FastifyInstance, deps: TemplateRouteDeps): Promise<void> {
  const { templateService: service, guard } = deps;
  const actor = (req: FastifyRequest): TemplateActor => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const record = (req: FastifyRequest, action: string, entityId: string | null, values: { oldValue?: unknown; newValue?: unknown }, module = 'templates') =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module, action, entityId, ...values });
  const param = (req: FastifyRequest, name: string) => idString.parse((req.params as Record<string, string>)[name]);
  const projectInput = (body: z.infer<typeof projectTemplateSchema>): ProjectTemplateInput => body;
  const taskInput = (body: z.infer<typeof taskTemplateSchema>): TaskTemplateInput => body;
  const auth = { preHandler: guard.authenticate };
  // A large body is only read for someone signed in: the check runs before the body is parsed.
  const big = { onRequest: guard.authenticate, bodyLimit: TEMPLATE_BODY_LIMIT };

  // ── Project templates: everyone uses them ──
  app.get('/templates/projects', auth, async (req) => ({ data: await service.listProjectTemplates(actor(req)) }));

  app.get('/templates/projects/:id', auth, async (req) => ({ data: await service.getProjectTemplate(param(req, 'id'), actor(req)) }));

  // The New project form's preview: the tasks with their due days for a start day.
  app.get('/templates/projects/:id/plan', auth, async (req) => {
    const { start } = z.object({ start: calendarDay }).parse(req.query);
    return { data: await service.planProject(param(req, 'id'), start) };
  });

  // An administrator creates one from scratch; its maker or an administrator changes or deletes it.
  app.post('/templates/projects', big, async (req, reply) => {
    const created = await service.createProjectTemplate(projectInput(projectTemplateSchema.parse(req.body)), actor(req));
    await record(req, 'template.project.create', created.id, { newValue: projectTemplateAudit(created) });
    return reply.status(201).send({ data: await service.getProjectTemplate(created.id, actor(req)) });
  });

  app.put('/templates/projects/:id', big, async (req) => {
    const id = param(req, 'id');
    const { before, after } = await service.updateProjectTemplate(id, projectInput(projectTemplateSchema.parse(req.body)), actor(req));
    await record(req, 'template.project.update', id, { oldValue: projectTemplateAudit(before), newValue: projectTemplateAudit(after) });
    return { data: await service.getProjectTemplate(id, actor(req)) };
  });

  app.delete('/templates/projects/:id', auth, async (req, reply) => {
    const id = param(req, 'id');
    const gone = await service.deleteProjectTemplate(id, actor(req));
    await record(req, 'template.project.delete', id, { oldValue: projectTemplateAudit(gone) });
    return reply.status(204).send();
  });

  // Save a project as a template: whoever runs it (its owner, a manager) or an administrator.
  app.get('/templates/projects/from-project/:projectId', auth, async (req) => ({ data: await service.projectDraft(param(req, 'projectId'), actor(req)) }));

  app.post('/templates/projects/from-project/:projectId', auth, async (req, reply) => {
    const projectId = param(req, 'projectId');
    const created = await service.saveProjectAsTemplate(projectId, fromProjectSchema.parse(req.body), actor(req));
    await record(req, 'template.project.create', created.id, { newValue: { ...projectTemplateAudit(created), fromProject: projectId } });
    return reply.status(201).send({ data: await service.getProjectTemplate(created.id, actor(req)) });
  });

  // Make a project from a template (anyone may create a project): the project, its board, its tasks
  // with their checklists and its team are one write.
  if (deps.projectService) {
    const projects = deps.projectService;
    app.post('/templates/projects/:id/projects', auth, async (req, reply) => {
      const id = param(req, 'id');
      const user = actor(req);
      const { startDate, roles = {}, memberIds = [], expectedUpdatedAt, ...project } = useSchema.parse(req.body);
      const prepared = await service.prepareProject(id, { startKey: startDate, fillers: roles, defaultDueToday: project.defaultDueToday ?? false, expectedUpdatedAt });
      const { team, ...created } = await projects.createProject(
        {
          ...project,
          memberIds: [...memberIds, ...prepared.fillerIds],
          startDate: new Date(`${startDate}T00:00:00.000Z`),
          createdById: user.id,
          startWith: prepared.startWith,
        },
        user,
      );
      const taskCount = prepared.startWith.tasks.length;
      await record(
        req,
        'project.create_from_template',
        created.id,
        {
          newValue: {
            code: created.code,
            name: created.name,
            template: { id: prepared.template.id, name: prepared.template.name },
            startDate,
            taskCount,
            roles: prepared.filledRoles.map((r) => ({ role: r.role, userId: r.userId })),
            ownerId: created.ownerId,
            team,
          },
        },
        'projects',
      );
      await deps.notices?.projectCreated({ actorId: user.id, project: created, userIds: team.map((m) => m.userId) });
      // Whoever creates a project runs it (an employee is on its team as a manager).
      return reply.status(201).send({ data: { ...created, canManage: true, taskCount } });
    });
  }

  // ── Task templates ──
  app.get('/templates/tasks', auth, async (req) => ({ data: await service.listTaskTemplates(actor(req)) }));

  app.get('/templates/tasks/:id', auth, async (req) => ({ data: await service.getTaskTemplate(param(req, 'id'), actor(req)) }));

  app.post('/templates/tasks', auth, async (req, reply) => {
    const created = await service.createTaskTemplate(taskInput(taskTemplateSchema.parse(req.body)), actor(req));
    await record(req, 'template.task.create', created.id, { newValue: taskTemplateAudit(created) });
    return reply.status(201).send({ data: await service.getTaskTemplate(created.id, actor(req)) });
  });

  app.put('/templates/tasks/:id', auth, async (req) => {
    const id = param(req, 'id');
    const { before, after } = await service.updateTaskTemplate(id, taskInput(taskTemplateSchema.parse(req.body)), actor(req));
    await record(req, 'template.task.update', id, { oldValue: taskTemplateAudit(before), newValue: taskTemplateAudit(after) });
    return { data: await service.getTaskTemplate(id, actor(req)) };
  });

  app.delete('/templates/tasks/:id', auth, async (req, reply) => {
    const id = param(req, 'id');
    const gone = await service.deleteTaskTemplate(id, actor(req));
    await record(req, 'template.task.delete', id, { oldValue: taskTemplateAudit(gone) });
    return reply.status(204).send();
  });

  // Save a task as a template: whoever runs its project, or an administrator.
  app.post('/templates/tasks/from-task/:taskId', auth, async (req, reply) => {
    const taskId = param(req, 'taskId');
    const created = await service.saveTaskAsTemplate(taskId, fromTaskSchema.parse(req.body ?? {}), actor(req));
    await record(req, 'template.task.create', created.id, { newValue: { ...taskTemplateAudit(created), fromTask: taskId } });
    return reply.status(201).send({ data: await service.getTaskTemplate(created.id, actor(req)) });
  });
}
