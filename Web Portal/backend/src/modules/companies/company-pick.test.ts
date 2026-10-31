import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { COMPANY_HEADER, CompanyNotAvailableError, createPickResolver, rawPickOf } from './company-pick';
import type { CompanyAccess, Viewer } from './company-access';

// The people's active companies, as the access service would read them.
const companiesOf: Record<string, string[]> = { ana: ['A'], cat: ['A', 'B'] };
const ana: Viewer = { id: 'ana', roles: ['EMPLOYEE'] };
const cat: Viewer = { id: 'cat', roles: ['EMPLOYEE'] };

const access = {
  checkPick: vi.fn(async (viewer: Viewer, pick: string | null) => {
    if (pick === null) return null;
    if (!(companiesOf[viewer.id] ?? []).includes(pick)) throw new CompanyNotAvailableError();
    return pick;
  }),
} as unknown as CompanyAccess & { checkPick: ReturnType<typeof vi.fn> };
const resolve = createPickResolver(access);
const reqWith = (header: string | undefined, user: Viewer) =>
  ({ headers: header === undefined ? {} : { [COMPANY_HEADER]: header }, user }) as unknown as FastifyRequest;

describe('The picked company (X-Company-Id)', () => {
  it('no header means all my companies', async () => {
    expect(await resolve(reqWith(undefined, ana))).toBeNull();
    expect(await resolve(reqWith('   ', ana))).toBeNull();
  });

  it('a company of mine is my pick, read once per request', async () => {
    const r = reqWith('A', cat);
    expect(await resolve(r)).toBe('A');
    await resolve(r);
    expect(access.checkPick).toHaveBeenCalledTimes(1);
    expect(access.checkPick).toHaveBeenCalledWith(cat, 'A');
  });

  it('a pick that isn’t the person’s is refused, not widened', async () => {
    await expect(resolve(reqWith('B', ana))).rejects.toMatchObject({ status: 403, code: 'COMPANY_NOT_AVAILABLE', message: 'You no longer have access to this company.' });
    await expect(resolve(reqWith('x'.repeat(65), ana))).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
  });

  it('only an id-shaped value is read: anything else is refused before any lookup', () => {
    expect(rawPickOf(reqWith(' company_prolens ', ana))).toBe('company_prolens');
    expect(() => rawPickOf(reqWith('A,B', ana))).toThrow(CompanyNotAvailableError);
    expect(() => rawPickOf(reqWith("A' OR 1=1", ana))).toThrow(CompanyNotAvailableError);
    expect(() => rawPickOf(reqWith('x'.repeat(64), ana))).not.toThrow();
  });

  it('needs a signed-in request', async () => {
    await expect(resolve({ headers: {} } as unknown as FastifyRequest)).rejects.toThrow();
  });
});
