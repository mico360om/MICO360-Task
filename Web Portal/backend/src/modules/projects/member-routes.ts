import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberService } from './member-service';
import type { ProjectAuthz } from './project-authz';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import { ForbiddenError } from '../../lib/http-errors';

const addSchema = z.object({ userIds: z.array(z.string().min(1)).min(1) });
const roleSchema = z.object({ role: z.enum(['MEMBER', 'MANAGER']) });

export interface MemberRouteDeps {
  memberService: MemberService;
  authz: ProjectAuthz;
  guard: AuthGuard;
  /** Records membership + role-grant changes to the audit log (security-relevant). */
  audit?: AuditService;
  /** Object-level view authorization: may this user see this project? (gates the member roster) */
  canViewProject?: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
}

export async function registerMemberRoutes(app: FastifyInstance, deps: MemberRouteDeps): Promise<void> {
  const { memberService, authz, guard } = deps;
  const logAudit = (req: FastifyRequest, action: string, entityId: string | null, newValue?: unknown) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'members', action, entityId, newValue });

  async function requireManage(req: { user?: { id: string; roles?: string[] } }, projectId: string): Promise<void> {
    const ok = await authz.canManageProject(req.user!.id, req.user!.roles ?? [], projectId);
    if (!ok) throw new ForbiddenError('Only an admin or a manager of this project can do that.');
  }

  app.get('/projects/:id/members', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (deps.canViewProject && !(await deps.canViewProject(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } });
    }
    return { data: await memberService.listMembers(id) };
  });

  app.post('/projects/:id/members', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await requireManage(req, id);
    const { userIds } = addSchema.parse(req.body);
    const result = await memberService.addMembers(id, userIds);
    await logAudit(req, 'member.add', id, { userIds });
    return { data: result };
  });

  app.patch('/projects/:id/members/:userId', { preHandler: guard.authenticate }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    await requireManage(req, id);
    const { role } = roleSchema.parse(req.body);
    const result = await memberService.setMemberRole(id, userId, role);
    await logAudit(req, 'member.role', id, { userId, role });
    return { data: result };
  });

  app.delete('/projects/:id/members/:userId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    await requireManage(req, id);
    await memberService.removeMember(id, userId);
    await logAudit(req, 'member.remove', id, { userId });
    return reply.status(204).send();
  });
}
