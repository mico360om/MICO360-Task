import { describe, it, expect } from 'vitest';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';

/** Onboarding in User Management's service: duplicates named by field, the detail rules on a change, the email-change rule. */
function make() {
  const mem = createMemoryUserRepository();
  const changed: { id: string; from: string; to: string }[] = [];
  const svc = createUserService({ users: mem.repo, onEmailChanged: async (id, from, to) => void changed.push({ id, from, to }) });
  return { svc, mem, changed };
}
const person = (o: Record<string, unknown> = {}) => ({ email: 'ahmed@acme.com', username: 'ahmed', password: 'Password1!', firstName: 'Ahmed', lastName: 'Al Harthy', roleNames: ['EMPLOYEE'], ...o });
const err = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; status?: number; message?: string; details?: unknown }) => ({ code: e.code, status: e.status, message: e.message, details: e.details }));

describe('Duplicates (case and spaces don’t matter), named by field', () => {
  it('an email already used — whatever its case — is 409 naming the field and the account', async () => {
    const { svc } = make();
    const a = await svc.createUser(person());
    const e = await err(svc.createUser(person({ email: 'AHMED@acme.COM', username: 'other' })));
    expect(e).toMatchObject({ status: 409, code: 'DUPLICATE_USER', message: 'This email address is already used by Ahmed Al Harthy.', details: { field: 'email', userId: a.id, name: 'Ahmed Al Harthy', kind: 'staff' } });
  });

  it('a username already taken (any case) is 409 on the username', async () => {
    const { svc } = make();
    await svc.createUser(person());
    const e = await err(svc.createUser(person({ email: 'new@acme.com', username: 'AHMED' })));
    expect(e).toMatchObject({ status: 409, code: 'DUPLICATE_USER', message: 'This username is taken.', details: { field: 'username' } });
  });

  it('a client holding the address is named as a client', async () => {
    const { svc } = make();
    await svc.createUser(person({ roleNames: ['CLIENT'] }));
    const e = await err(svc.createUser(person({ username: 'other' })));
    expect(e?.message).toBe('This email address is already used by Ahmed Al Harthy (client).');
    expect(e?.details).toMatchObject({ kind: 'client' });
  });

  it('an edit that clashes with someone else: 409 on that field; keeping your own (any case) is fine', async () => {
    const { svc } = make();
    const a = await svc.createUser(person());
    const b = await svc.createUser(person({ email: 'sara@acme.com', username: 'sara', firstName: 'Sara' }));
    expect((await err(svc.updateUser(b.id, { email: 'Ahmed@Acme.com' })))?.details).toMatchObject({ field: 'email', userId: a.id });
    expect((await err(svc.updateUser(b.id, { username: 'Ahmed' })))?.details).toMatchObject({ field: 'username' });
    expect((await svc.updateUser(a.id, { email: 'AHMED@acme.com', username: 'Ahmed' })).username).toBe('Ahmed');
  });
});

describe('Detail rules on an edit bite only on what changes', () => {
  it('a username that predates the rules still saves with other changes; a new one must follow them', async () => {
    const { svc, mem } = make();
    const a = await svc.createUser(person());
    await mem.repo.update(a.id, { username: 'x y' }); // an old account
    expect((await svc.updateUser(a.id, { firstName: 'Ahmad', username: 'x y' })).firstName).toBe('Ahmad');
    const e = await err(svc.updateUser(a.id, { username: 'no spaces please' }));
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION', details: { field: 'username' } });
  });

  it('an email change must be a valid address', async () => {
    const { svc } = make();
    const a = await svc.createUser(person());
    expect((await err(svc.updateUser(a.id, { email: 'not-an-email' })))?.details).toMatchObject({ field: 'email' });
  });
});

describe('Changing an account’s email', () => {
  it('sets it back to not verified, ends links sent to the old address, and tells the old address', async () => {
    const { svc, mem, changed } = make();
    const a = await svc.createUser(person());
    await mem.repo.update(a.id, { emailVerifiedAt: new Date('2026-10-01T00:00:00Z') });
    const links = mem.linksEnded(a.id);
    const u = await svc.updateUser(a.id, { email: 'ahmed@new.com' });
    expect(u.emailVerifiedAt).toBeNull();
    expect(mem.linksEnded(a.id)).toBe(links + 1);
    expect(changed).toEqual([{ id: a.id, from: 'ahmed@acme.com', to: 'ahmed@new.com' }]);
  });

  it('a change of case only keeps the verification and tells no one', async () => {
    const { svc, mem, changed } = make();
    const a = await svc.createUser(person());
    const at = new Date('2026-10-01T00:00:00Z');
    await mem.repo.update(a.id, { emailVerifiedAt: at });
    const u = await svc.updateUser(a.id, { email: 'Ahmed@Acme.com' });
    expect(u.emailVerifiedAt).toEqual(at);
    expect(changed).toEqual([]);
  });

  it('a failure telling the old address never undoes the change', async () => {
    const mem = createMemoryUserRepository();
    const svc = createUserService({ users: mem.repo, onEmailChanged: async () => { throw new Error('mail down'); } });
    const a = await svc.createUser(person());
    expect((await svc.updateUser(a.id, { email: 'ahmed@new.com' })).email).toBe('ahmed@new.com');
  });
});
