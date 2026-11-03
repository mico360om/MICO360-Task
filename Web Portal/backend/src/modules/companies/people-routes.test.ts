import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { CompanyAccess } from './company-access';
import { CompanyNotAvailableError } from './company-pick';
import type { PersonOption } from './person-options';

// GET /people/candidates?companyIds=a,b — who may join a team in these companies (the project form's
// team picker): active people in them. Each company must be one of the caller's; admins: any.
const tokenService = createTokenService({
  accessSecret: 'people-access',
  refreshSecret: 'people-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const inCompany: Record<string, string[]> = { A: ['ana', 'amy'], B: ['ben'] };
const mine: Record<string, string[]> = { ana: ['A'] };
const person = (id: string): PersonOption => ({ id, firstName: id, lastName: 'X', username: id, avatarUrl: null });

async function makeApp() {
  const asked: string[][] = [];
  const companyAccess = {
    async checkPick(viewer: { id: string; roles: string[] }, pick: string | null) {
      if (pick && !viewer.roles.includes('ADMIN') && !(mine[viewer.id] ?? []).includes(pick)) throw new CompanyNotAvailableError();
      if (pick && !inCompany[pick]) throw new CompanyNotAvailableError();
      return pick;
    },
    async projectCompanyPeople(ids: readonly string[]) {
      asked.push([...ids]);
      return ids.flatMap((c) => inCompany[c] ?? []);
    },
  } as unknown as CompanyAccess;
  const app = await buildApp({ authService, tokenService, companyAccess, personOptions: async (ids) => [...ids].sort().map(person) });
  return { app, asked };
}
const as = (id: string, roles: string[]) => ({ authorization: `Bearer ${tokenService.issueAccessToken({ id, roles })}` });

describe('GET /people/candidates', () => {
  it('lists the active people of the chosen companies, by name, with nothing private', async () => {
    const { app, asked } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/people/candidates?companyIds=A,B', headers: as('admin', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([person('amy'), person('ana'), person('ben')]);
    expect(asked).toEqual([['A', 'B']]);
  });

  it('an employee may ask only about their own companies', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/people/candidates?companyIds=A', headers: as('ana', ['EMPLOYEE']) })).json().data.map((p: PersonOption) => p.id)).toEqual(['amy', 'ana']);
    const refused = await app.inject({ method: 'GET', url: '/api/v1/people/candidates?companyIds=A,B', headers: as('ana', ['EMPLOYEE']) });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toEqual({ code: 'COMPANY_NOT_AVAILABLE', message: 'You no longer have access to this company.' });
  });

  it('needs at least one company, at most 20, and sign-in', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/people/candidates', headers: as('ana', ['EMPLOYEE']) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/people/candidates?companyIds=${Array.from({ length: 21 }, (_, i) => `C${i}`).join(",")}`, headers: as('admin', ['ADMIN']) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/people/candidates?companyIds=A' })).statusCode).toBe(401);
  });
});

// GET /people/candidates?projectId= — the Team tab of a project: someone who may run its team gets the
// active people of ANY of the project's active companies (owner, 31 Oct: a shared project's team can
// include people from any of its companies), not only of their own companies.
describe('GET /people/candidates?projectId=', () => {
  async function makeProjectApp() {
    const asked: string[][] = [];
    const companyAccess = {
      async checkPick() { throw new CompanyNotAvailableError(); },
      async projectCompanyPeople(ids: readonly string[]) {
        asked.push([...ids]);
        return ids.flatMap((c) => inCompany[c] ?? []);
      },
    } as unknown as CompanyAccess;
    // PAB is in Alpha and Beta; ben (Beta only) runs it; ana is on nothing she runs.
    const projectAuthz = { async canManageProject(userId: string, roles: string[], projectId: string) { return roles.includes('ADMIN') || (userId === 'ben' && projectId === 'PAB'); } };
    const projectCompanyIds = async (projectId: string) => (projectId === 'PAB' ? ['A', 'B'] : null);
    const app = await buildApp({ authService, tokenService, companyAccess, personOptions: async (ids) => [...ids].sort().map(person), projectAuthz: projectAuthz as never, projectCompanyIds });
    return { app, asked };
  }

  it('someone who runs the project gets the people of all its companies — not only their own', async () => {
    const { app, asked } = await makeProjectApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/people/candidates?projectId=PAB', headers: as('ben', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([person('amy'), person('ana'), person('ben')]);
    expect(asked).toEqual([['A', 'B']]);
  });

  it('someone who doesn’t run the project is refused, and is told nothing of its people', async () => {
    const { app, asked } = await makeProjectApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/people/candidates?projectId=PAB', headers: as('ana', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(asked).toEqual([]);
  });

  it('a project with no companies (from before companies) offers nobody', async () => {
    const { app } = await makeProjectApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/people/candidates?projectId=OLD', headers: as('admin', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('companies or a project, not both', async () => {
    const { app } = await makeProjectApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/people/candidates?projectId=PAB&companyIds=A', headers: as('admin', ['ADMIN']) })).statusCode).toBe(400);
  });
});

