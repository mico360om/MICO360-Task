import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createCompanyMembership } from './company-membership';
import { createMemoryUserRepository } from '../users/memory-user-repository';
import type { OnCompanyAccessChanged } from './company-service';

const admin = { id: 'admin', roles: ['ADMIN'] };

let mem: ReturnType<typeof createMemoryUserRepository>;
let onAccess: Mock<OnCompanyAccessChanged>;
let audit: Record<string, unknown>[];
let membership: ReturnType<typeof createCompanyMembership>;
let ana: string;
let cat: string;
let boss: string;
let idle: string;

const person = async (firstName: string, companyIds: string[], primaryCompanyId: string | null, roleNames = ['EMPLOYEE']) =>
  (await mem.repo.create({ email: `${firstName}@x.co`, username: firstName.toLowerCase(), passwordHash: 'x', firstName, lastName: 'Test', roleNames, companyIds, primaryCompanyId })).id;
const companiesOf = async (id: string) => (await mem.repo.findById(id))!.companies!.map((c) => c.id);
const primaryOf = async (id: string) => (await mem.repo.findById(id))!.primaryCompanyId;

beforeEach(async () => {
  mem = createMemoryUserRepository();
  mem.addCompany({ id: 'A', name: 'Alpha Co', code: 'ALPHA' });
  mem.addCompany({ id: 'B', name: 'Beta Co', code: 'BETA' });
  mem.addCompany({ id: 'C', name: 'Gamma Co', code: 'GAMMA', status: 'ARCHIVED' });
  onAccess = vi.fn<OnCompanyAccessChanged>();
  audit = [];
  membership = createCompanyMembership({
    store: mem.membershipStore,
    onAccessChanged: onAccess,
    audit: { async record(d) { audit.push(d as unknown as Record<string, unknown>); return {} as never; } },
  });
  ana = await person('Ana', ['A'], 'A');
  cat = await person('Cat', ['A', 'B'], 'B');
  boss = await person('Boss', [], null, ['ADMIN']);
  idle = await person('Idle', ['A'], 'A');
  await mem.repo.setStatus(idle, 'INACTIVE');
});

describe('A person’s companies', () => {
  it('set replaces them; the first one added is primary, and a kept primary stays', async () => {
    await membership.set(boss, ['B', 'A'], undefined, admin);
    expect(await companiesOf(boss)).toEqual(['A', 'B']); // shown A–Z
    expect(await primaryOf(boss)).toBe('B');
    await membership.set(cat, ['B'], undefined, admin);
    expect(await primaryOf(cat)).toBe('B');
    expect(onAccess).toHaveBeenLastCalledWith([cat]);
    expect(audit.at(-1)).toMatchObject({ module: 'users', action: 'user.companies', entityId: cat, userId: 'admin', oldValue: { companyIds: ['A', 'B'], primaryCompanyId: 'B' }, newValue: { companyIds: ['B'], primaryCompanyId: 'B' } });
  });

  it('removing the primary company makes the oldest remaining one primary', async () => {
    await membership.set(ana, ['A', 'B'], undefined, admin);
    await membership.remove([ana], ['A'], admin);
    expect(await primaryOf(ana)).toBe('B');
    await membership.add([ana], ['A'], admin);
    await membership.remove([cat], ['B'], admin); // cat joined A before B
    expect(await primaryOf(cat)).toBe('A');
  });

  it('the primary company must be one of theirs; a named one wins', async () => {
    await expect(membership.set(ana, undefined, 'B', admin)).rejects.toMatchObject({ status: 400, message: 'The primary company must be one of this person’s companies.' });
    await expect(membership.set(ana, ['A'], 'B', admin)).rejects.toMatchObject({ status: 400 });
    await membership.set(cat, undefined, 'A', admin);
    expect(await primaryOf(cat)).toBe('A');
  });

  it('an active employee keeps at least one company; an admin or an inactive person may have none', async () => {
    await expect(membership.set(ana, [], undefined, admin)).rejects.toMatchObject({ status: 409, code: 'LAST_COMPANY', message: 'Ana Test must keep at least one company. Add another company first.' });
    expect(await companiesOf(ana)).toEqual(['A']);
    await expect(membership.check(boss, [], undefined, { roles: ['EMPLOYEE'] })).rejects.toMatchObject({ code: 'LAST_COMPANY' }); // made an employee
    await membership.set(idle, [], undefined, admin);
    expect(await companiesOf(idle)).toEqual([]);
    expect(await primaryOf(idle)).toBeNull();
    await membership.set(cat, ['A'], undefined, admin);
    await membership.set(boss, ['A'], undefined, admin);
    await membership.set(boss, [], undefined, admin);
    expect(await companiesOf(boss)).toEqual([]);
  });

  it('unknown companies are refused; nothing changes when nothing would', async () => {
    await expect(membership.set(ana, ['A', 'nope'], undefined, admin)).rejects.toMatchObject({ status: 400, message: 'Company not found.' });
    await expect(membership.add([ana], ['nope'], admin)).rejects.toMatchObject({ status: 400 });
    onAccess.mockClear();
    audit.length = 0;
    await membership.set(ana, ['A'], 'A', admin);
    expect(await membership.add([ana], ['A'], admin)).toEqual({ changed: 0, refused: [] });
    expect(onAccess).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it('bulk: adds and removes for several people, says who it couldn’t change, and tells realtime who changed', async () => {
    expect(await membership.change([ana, cat, boss], { add: ['B'], remove: ['A'] }, admin)).toEqual({ changed: 3, refused: [] });
    expect([await companiesOf(ana), await companiesOf(cat), await companiesOf(boss)]).toEqual([['B'], ['B'], ['B']]);
    expect(await primaryOf(ana)).toBe('B');
    expect(onAccess).toHaveBeenLastCalledWith([ana, cat, boss]);
    const r = await membership.remove([ana, cat, 'gone'], ['B'], admin);
    expect(r).toEqual({
      changed: 0,
      refused: [
        { userId: ana, name: 'Ana Test', reason: 'Ana Test must keep at least one company. Add another company first.' },
        { userId: cat, name: 'Cat Test', reason: 'Cat Test must keep at least one company. Add another company first.' },
        { userId: 'gone', name: '', reason: 'User not found.' },
      ],
    });
  });
});

describe('The companies a new person gets', () => {
  it('the ones named; else the picked company; else the only active one; else none for an admin', async () => {
    expect(await membership.defaultsFor({ companyIds: ['B', 'A', 'B'], isAdmin: false }, 'A')).toEqual(['B', 'A']);
    expect(await membership.defaultsFor({ isAdmin: false }, 'B')).toEqual(['B']);
    expect(await membership.defaultsFor({ isAdmin: true }, null)).toEqual([]);
    await expect(membership.defaultsFor({ isAdmin: false }, null)).rejects.toMatchObject({ status: 400, message: 'Choose at least one company.' });
    await expect(membership.defaultsFor({ companyIds: [], isAdmin: false }, 'A')).rejects.toMatchObject({ message: 'Choose at least one company.' });
    expect(await membership.defaultsFor({ companyIds: [], isAdmin: true }, 'A')).toEqual([]);
    await expect(membership.defaultsFor({ companyIds: ['nope'], isAdmin: false }, null)).rejects.toMatchObject({ message: 'Company not found.' });
    mem.addCompany({ id: 'B', name: 'Beta Co', code: 'BETA', status: 'ARCHIVED' });
    expect(await membership.defaultsFor({ isAdmin: false }, null)).toEqual(['A']); // one active company
  });

  it('the primary of a new person is the named one (one of theirs), else the first', () => {
    expect(membership.primaryFor(['B', 'A'], undefined)).toBe('B');
    expect(membership.primaryFor(['B', 'A'], 'A')).toBe('A');
    expect(membership.primaryFor([], null)).toBeNull();
    expect(() => membership.primaryFor(['A'], 'B')).toThrow('The primary company must be one of this person’s companies.');
  });
});
