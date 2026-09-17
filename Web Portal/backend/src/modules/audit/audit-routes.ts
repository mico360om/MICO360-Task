import type { FastifyInstance } from 'fastify';
import type { AuditService } from './audit-service';
import type { AuthGuard } from '../auth/auth-guard';

export interface AuditRouteDeps {
  auditService: AuditService;
  guard: AuthGuard;
}

export async function registerAuditRoutes(app: FastifyInstance, deps: AuditRouteDeps): Promise<void> {
  const { auditService, guard } = deps;
  app.get('/audit-logs', { preHandler: guard.requireRoles('ADMIN') }, async () => {
    return { data: await auditService.list(200) };
  });
}
