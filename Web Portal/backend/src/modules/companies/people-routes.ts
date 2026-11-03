import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { ForbiddenError } from '../../lib/http-errors';
import type { CompanyAccess } from './company-access';
import type { PersonOptions } from './person-options';

/** `?companyIds=a,b` (1–20 company ids, comma-separated) or `?projectId=…` — one of the two. */
const candidatesQuery = z
  .object({
    companyIds: z
      .string()
      .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
      .pipe(z.array(z.string().min(1).max(64)).min(1).max(20))
      .optional(),
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .refine((q) => !!q.companyIds !== !!q.projectId, { message: 'Give companies or a project.' });

export interface PeopleRouteDeps {
  guard: AuthGuard;
  companyAccess: Pick<CompanyAccess, 'checkPick' | 'projectCompanyPeople'>;
  personOptions: PersonOptions;
  /** May this person run the project's team (an administrator, its owner, its named manager or a MANAGER on it)? */
  canManageProject?: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** The project's ACTIVE companies (null: a project from before companies, with none at all). */
  projectCompanyIds?: (projectId: string) => Promise<string[] | null>;
}

/** Words for someone who may not run a project's team. */
export const NOT_YOUR_TEAM = 'Only an administrator or someone who runs this project can change its team.';

/**
 * Companies: people for pickers inside projects.
 * - `GET /people/candidates?companyIds=…` lists who may be on the team of a project in those companies
 *   — the active people of any of them (the new-project form's team picker). Each company must be one
 *   of the caller's active companies (403 COMPANY_NOT_AVAILABLE otherwise, never widened);
 *   administrators may ask about any company.
 * - `GET /people/candidates?projectId=…` (a project's Team tab, its edit form): for someone who may
 *   run that project's team, the active people of ANY of the project's active companies (owner,
 *   31 Oct: a shared project's team can include people from any of its companies); anyone else 403.
 */
export async function registerPeopleRoutes(app: FastifyInstance, deps: PeopleRouteDeps): Promise<void> {
  app.get('/people/candidates', { preHandler: deps.guard.authenticate }, async (req) => {
    const q = candidatesQuery.parse(req.query);
    const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
    if (q.projectId) {
      const may = deps.canManageProject ? await deps.canManageProject(viewer.id, viewer.roles, q.projectId) : false;
      if (!may) throw new ForbiddenError(NOT_YOUR_TEAM);
      const companyIds = deps.projectCompanyIds ? await deps.projectCompanyIds(q.projectId) : null;
      if (!companyIds || companyIds.length === 0) return { data: [] };
      return { data: await deps.personOptions(await deps.companyAccess.projectCompanyPeople(companyIds)) };
    }
    const companyIds = q.companyIds!;
    for (const id of companyIds) await deps.companyAccess.checkPick(viewer, id);
    return { data: await deps.personOptions(await deps.companyAccess.projectCompanyPeople(companyIds)) };
  });
}
