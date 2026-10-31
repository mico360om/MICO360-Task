import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { CompanyAccess } from './company-access';
import type { PersonOptions } from './person-options';

/** `?companyIds=a,b`: 1–20 company ids, comma-separated. */
const candidatesQuery = z.object({
  companyIds: z
    .string()
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(20)),
});

export interface PeopleRouteDeps {
  guard: AuthGuard;
  companyAccess: Pick<CompanyAccess, 'checkPick' | 'projectCompanyPeople'>;
  personOptions: PersonOptions;
}

/**
 * Companies: people for pickers inside projects. GET /people/candidates?companyIds=… lists who may be
 * on the team of a project in those companies — the active people of any of them (the project form's
 * team picker). Each company must be one of the caller's active companies (403 COMPANY_NOT_AVAILABLE
 * otherwise, never widened); administrators may ask about any company.
 */
export async function registerPeopleRoutes(app: FastifyInstance, deps: PeopleRouteDeps): Promise<void> {
  app.get('/people/candidates', { preHandler: deps.guard.authenticate }, async (req) => {
    const { companyIds } = candidatesQuery.parse(req.query);
    const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
    for (const id of companyIds) await deps.companyAccess.checkPick(viewer, id);
    return { data: await deps.personOptions(await deps.companyAccess.projectCompanyPeople(companyIds)) };
  });
}
