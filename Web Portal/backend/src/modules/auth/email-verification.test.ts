import { describe, it, expect, beforeEach } from 'vitest';
import { createEmailVerification, type VerificationPerson } from './email-verification';

let people: Map<string, VerificationPerson & { activatedAt: Date | null }>;
let mailOn: boolean;
let audit: { userId: string | null; action: string; entityId: string | null; newValue?: unknown; ip: string | null; module: string }[];
const AT = new Date('2026-11-07T08:00:00Z');

function person(id: string, o: Partial<VerificationPerson> = {}) {
  people.set(id, { id, email: `${id}@x.co`, emailVerifiedAt: null, roles: ['EMPLOYEE'], status: 'ACTIVE', activatedAt: null, ...o });
}
function make() {
  return createEmailVerification({
    mailConfigured: () => mailOn,
    now: () => AT,
    audit: { record: async (e) => void audit.push(e as never) },
    repo: {
      async find(id) {
        return people.get(id) ?? null;
      },
      async otherVerifiedAdmins(id) {
        return [...people.values()].filter((p) => p.id !== id && p.status === 'ACTIVE' && p.roles.includes('ADMIN') && p.emailVerifiedAt).length;
      },
      async markVerified(id, at, email) {
        const p = people.get(id);
        if (!p || p.emailVerifiedAt || (email !== undefined && p.email.toLowerCase() !== email.trim().toLowerCase())) return false;
        p.emailVerifiedAt = at;
        p.activatedAt ??= at;
        return true;
      },
    },
  });
}

beforeEach(() => {
  people = new Map();
  mailOn = true;
  audit = [];
});

describe('Email verification: who is asked for a code at sign-in', () => {
  it('an unverified account is asked; a verified (or grandfathered) one is not', async () => {
    person('ann');
    person('bo', { emailVerifiedAt: new Date('2026-10-01T00:00:00Z') });
    person('admin', { roles: ['ADMIN'], emailVerifiedAt: AT });
    const v = make();
    expect(await v.needsCode('ann')).toBe(true);
    expect(await v.needsCode('bo')).toBe(false);
  });

  it('with no mail settings nobody is asked (the temporary-password path works as before)', async () => {
    person('ann');
    mailOn = false;
    expect(await make().needsCode('ann')).toBe(false);
  });

  it('clients are asked too (before the portal)', async () => {
    person('cli', { roles: ['CLIENT'] });
    expect(await make().needsCode('cli')).toBe(true);
  });

  it('the last active administrator is never put through the code step', async () => {
    person('solo', { roles: ['ADMIN'] });
    person('emp');
    const v = make();
    expect(await v.needsCode('solo')).toBe(false);
  });

  it('two unverified administrators: neither is asked (no one could let the other in); once one is verified, the other is', async () => {
    person('a1', { roles: ['ADMIN'] });
    person('a2', { roles: ['ADMIN'] });
    const v = make();
    expect(await v.needsCode('a1')).toBe(false);
    expect(await v.needsCode('a2')).toBe(false);
    people.get('a2')!.emailVerifiedAt = AT;
    expect(await v.needsCode('a1')).toBe(true);
  });

  it('an inactive verified administrator doesn’t count as another one who can sign in', async () => {
    person('a1', { roles: ['ADMIN'] });
    person('a2', { roles: ['ADMIN'], emailVerifiedAt: AT, status: 'INACTIVE' });
    expect(await make().needsCode('a1')).toBe(false);
  });

  it('an unknown account is never asked (sign-in already refused it)', async () => {
    expect(await make().needsCode('ghost')).toBe(false);
  });
});

describe('Email verification: confirming', () => {
  it('a code confirms the address, audited as the person’s own act', async () => {
    person('ann');
    const v = make();
    expect(await v.confirm('ann', 'code', { email: 'ann@x.co', actorId: 'ann', ip: '1.2.3.4' })).toBe('verified');
    expect(people.get('ann')!.emailVerifiedAt).toEqual(AT);
    expect(people.get('ann')!.activatedAt).toEqual(AT);
    expect(audit).toEqual([{ userId: 'ann', ip: '1.2.3.4', module: 'users', action: 'user.email.verified', entityId: 'ann', newValue: { how: 'code', email: 'ann@x.co' } }]);
  });

  it('a code sent to an address that has since changed confirms nothing', async () => {
    person('ann');
    people.get('ann')!.email = 'ann@new.co';
    expect(await make().confirm('ann', 'code', { email: 'ann@x.co', actorId: 'ann' })).toBe('address-changed');
    expect(people.get('ann')!.emailVerifiedAt).toBeNull();
    expect(audit).toEqual([]);
  });

  it('already verified: nothing is written and nothing audited', async () => {
    person('bo', { emailVerifiedAt: new Date('2026-10-01T00:00:00Z') });
    expect(await make().confirm('bo', 'sign-in code', { actorId: 'bo' })).toBe('already');
    expect(people.get('bo')!.emailVerifiedAt).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(audit).toEqual([]);
  });

  it('an administrator by hand: audited with who did it and the reason', async () => {
    person('ann');
    expect(await make().confirm('ann', 'administrator', { actorId: 'admin', reason: 'Phoned them; the address is right' })).toBe('verified');
    expect(audit[0]).toMatchObject({ userId: 'admin', entityId: 'ann', action: 'user.email.verified', newValue: { how: 'administrator', email: 'ann@x.co', reason: 'Phoned them; the address is right' } });
  });
});
