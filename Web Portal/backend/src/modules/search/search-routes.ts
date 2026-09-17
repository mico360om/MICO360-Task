import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SearchService } from './search-service';
import type { AuthGuard } from '../auth/auth-guard';

const querySchema = z.object({ q: z.string().default('') });

export interface SearchRouteDeps {
  searchService: SearchService;
  guard: AuthGuard;
  /** Project ids a user may see (`null` = admin, unscoped) — scopes task/project results. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
}

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchRouteDeps): Promise<void> {
  const { searchService, guard } = deps;
  app.get('/search', { preHandler: guard.authenticate }, async (req) => {
    const { q } = querySchema.parse(req.query);
    // Object-level scope: a non-admin only ever finds tasks/projects in projects they belong to.
    const allowedProjectIds = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
    return { data: await searchService.search(q, { allowedProjectIds, userId: req.user!.id }) };
  });
}
