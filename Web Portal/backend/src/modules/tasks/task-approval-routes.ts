import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { Logger } from '../../lib/logger';
import type { TaskService } from './task-service';
import type { TaskRecord } from './task-repository';
import { NO_PICK, type PickOf } from '../companies/company-pick';

/** Someone asking about approvals. */
export interface ApprovalViewer {
  id: string;
  roles: string[];
}

export interface ApprovalPerson {
  id: string;
  name: string;
}

/** A task waiting for the viewer's approval, as the To approve list shows it. */
export type ApprovalRow = TaskRecord & {
  project: { id: string; code: string; name: string; color: string | null; icon: string | null; imageUrl: string | null };
  /** Who finished it (asked for approval); null once that account is gone. */
  requestedBy: ApprovalPerson | null;
};

/** A task's approval, as its details show it to one person. */
export interface TaskApprovalDetails {
  /** This person may approve it or send it back (and turn approval off while it waits). */
  canApprove: boolean;
  requestedBy: ApprovalPerson | null;
  approvedBy: ApprovalPerson | null;
  /** The one person who runs the project ("Waiting for Omar's approval"); null when several do, or none. */
  approverName: string | null;
}

export interface ApprovalSource {
  /** The tasks waiting for approval that this person can approve (an admin: all of them), the longest waiting first. */
  list(viewer: ApprovalViewer): Promise<ApprovalRow[]>;
  /** They may approve some project's tasks: an admin, or someone who runs a project. */
  canApproveAny(viewer: ApprovalViewer): Promise<boolean>;
}

export interface ApprovalRouteDeps {
  taskService: Pick<TaskService, 'approveTask' | 'sendBackTask'>;
  source: ApprovalSource;
  guard: AuthGuard;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** May this person open the task? (undefined: everyone — unit tests). */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  audit?: AuditService;
  logger?: Pick<Logger, 'error'>;
  /** companies: the caller's project ids in a picked company — with a pick, the list keeps only those projects' tasks. */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** companies: the request's picked company (X-Company-Id). Absent: no pick. */
  pickOf?: PickOf;
}

const approveSchema = z.object({ expectedVersion: z.number().int().optional() });
// The reason is checked (blank, too long) by the task service, in words.
const sendBackSchema = z.object({ reason: z.string().max(10_000), expectedVersion: z.number().int().optional() });

/**
 * Task approvals: the To approve list, Approve and Send back (task-approval). Only the people who run
 * a task's project — and administrators — may approve it or send it back; a task the person can't
 * open answers 404, as everywhere.
 */
export async function registerTaskApprovalRoutes(app: FastifyInstance, deps: ApprovalRouteDeps): Promise<void> {
  const { guard } = deps;
  const notFound = { error: { code: 'NOT_FOUND', message: 'Task not found.' } };
  const viewer = (req: FastifyRequest): ApprovalViewer => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const visible = (req: FastifyRequest, id: string) => (deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true));

  /** The audit log line (a failure to write it is logged, never turned into an error: the step is saved). */
  async function audit(req: FastifyRequest, action: string, task: TaskRecord, extra: Record<string, unknown> = {}): Promise<void> {
    try {
      await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'tasks', action, entityId: task.id, newValue: { key: task.key, projectId: task.projectId, ...extra } });
    } catch (err) {
      deps.logger?.error('task approvals: the audit log line failed', { err, taskId: task.id, action });
    }
  }

  app.get('/tasks/approvals', { preHandler: guard.authenticate }, async (req) => {
    const v = viewer(req);
    const pick = await (deps.pickOf ?? NO_PICK)(req);
    const [canApprove, tasks, picked] = await Promise.all([
      deps.source.canApproveAny(v),
      deps.source.list(v),
      // companies: with a pick, only that company's projects (none = all the person's companies).
      pick && deps.accessibleProjectIds ? deps.accessibleProjectIds(v.id, v.roles, pick) : Promise.resolve(null),
    ]);
    const inPick = picked ? new Set(picked) : null;
    return { data: { canApprove, tasks: inPick ? tasks.filter((t) => inPick.has(t.projectId)) : tasks } };
  });

  app.post('/tasks/:id/approve', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = approveSchema.parse(req.body ?? {});
    if (!(await visible(req, id))) return reply.status(404).send(notFound);
    const task = await deps.taskService.approveTask(id, req.user!.id, { expectedVersion: body.expectedVersion });
    await audit(req, 'task.approve', task);
    deps.broadcast?.(task.projectId, 'task:moved', task);
    return { data: task };
  });

  app.post('/tasks/:id/send-back', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = sendBackSchema.parse(req.body ?? {});
    if (!(await visible(req, id))) return reply.status(404).send(notFound);
    const task = await deps.taskService.sendBackTask(id, req.user!.id, body.reason, { expectedVersion: body.expectedVersion });
    await audit(req, 'task.send-back', task, { reason: body.reason.trim() });
    deps.broadcast?.(task.projectId, 'task:moved', task);
    return { data: task };
  });
}
