import { describe, it, expect } from 'vitest';
import { createUserService, type UserServiceDeps } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { WeakPasswordError } from '../auth/errors';

function make(extra: Partial<UserServiceDeps> = {}) {
  const mem = createMemoryUserRepository();
  const revoked: string[] = [];
  const disconnected: string[] = [];
  const svc = createUserService({
    users: mem.repo,
    revokeSessions: async (id) => { revoked.push(id); },
    onSessionsRevoked: (id) => { disconnected.push(id); },
    ...extra,
  });
  return { svc, mem, revoked, disconnected };
}

const person = (o: Record<string, unknown> = {}) => ({ email: 'a@x', username: 'ada', password: 'Password1!', firstName: 'Ada', lastName: 'L', roleNames: ['EMPLOYEE'], ...o });

describe('UserService', () => {
  it('creates a user with a hashed password and roles', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person());
    expect(u.username).toBe('ada');
    expect(u.roles).toEqual(['EMPLOYEE']);
    expect(mem.hashOf(u.id)).toBeTruthy();
    expect(mem.hashOf(u.id)).not.toBe('Password1!');
  });

  it('defaults a new user to the EMPLOYEE role and refuses an empty role list', async () => {
    const { svc } = make();
    const { roleNames, ...noRoles } = person();
    void roleNames; // dropped on purpose: createUser must default it
    expect((await svc.createUser(noRoles)).roles).toEqual(['EMPLOYEE']);
    await expect(svc.createUser(person({ email: 'b@x', username: 'b', roleNames: [] }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces the password policy on create', async () => {
    const { svc } = make();
    await expect(svc.createUser(person({ password: '123456' }))).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(svc.createUser(person({ password: 'aaaaaaaa' }))).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('rejects a duplicate email or username', async () => {
    const { svc } = make();
    await svc.createUser(person());
    await expect(svc.createUser(person({ username: 'other' }))).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets a deleted user’s email and username be used again', async () => {
    const { svc } = make();
    const first = await svc.createUser(person({ roleNames: ['EMPLOYEE'] }));
    await svc.deleteUser(first.id);
    const again = await svc.createUser(person());
    expect(again.email).toBe('a@x');
    expect(again.id).not.toBe(first.id);
  });

  it('frees the identity of accounts deleted before deletes renamed them', async () => {
    const { svc, mem } = make();
    const first = await svc.createUser(person());
    mem.legacyDelete(first.id);
    await expect(svc.createUser(person())).resolves.toMatchObject({ email: 'a@x' });
  });

  it('throws NotFound for an unknown user', async () => {
    await expect(make().svc.getUser('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets a user status and ends their sessions when leaving ACTIVE', async () => {
    const { svc, mem, revoked, disconnected } = make();
    const u = await svc.createUser(person());
    const suspended = await svc.setUserStatus(u.id, 'SUSPENDED');
    expect(suspended.status).toBe('SUSPENDED');
    expect(mem.tokenVersion(u.id)).toBe(1);
    expect(revoked).toEqual([u.id]);
    expect(disconnected).toEqual([u.id]);
  });

  it('does not revoke sessions when re-activating a user', async () => {
    const { svc, revoked } = make();
    const u = await svc.createUser(person());
    await svc.setUserStatus(u.id, 'ACTIVE');
    expect(revoked).toEqual([]);
  });

  it('updates profile details, email, username and roles', async () => {
    const { svc } = make();
    const u = await svc.createUser(person());
    const updated = await svc.updateUser(u.id, { firstName: 'Ada', email: 'ada@new.co', username: 'ada2', roleNames: ['MANAGER', 'EMPLOYEE'] });
    expect(updated.firstName).toBe('Ada');
    expect(updated.email).toBe('ada@new.co');
    expect(updated.username).toBe('ada2');
    expect(updated.roles).toEqual(['MANAGER', 'EMPLOYEE']);
  });

  it('ends sessions on a real role change only (the edit dialog always resends roles)', async () => {
    const { svc, mem, revoked } = make();
    const u = await svc.createUser(person());
    await svc.updateUser(u.id, { firstName: 'Ada', roleNames: ['EMPLOYEE'] });
    expect(revoked).toEqual([]);
    await svc.updateUser(u.id, { roleNames: ['ADMIN'] });
    expect(revoked).toEqual([u.id]);
    expect(mem.tokenVersion(u.id)).toBe(1);
  });

  it('requires at least one role on update', async () => {
    const { svc } = make();
    const u = await svc.createUser(person());
    await expect(svc.updateUser(u.id, { roleNames: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an update whose new email collides with another user', async () => {
    const { svc } = make();
    await svc.createUser(person({ email: 'taken@x', username: 'taken' }));
    const u = await svc.createUser(person({ email: 'me@x', username: 'me' }));
    await expect(svc.updateUser(u.id, { email: 'taken@x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows an update that keeps the user’s own email/username unchanged', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ email: 'me@x', username: 'me' }));
    const updated = await svc.updateUser(u.id, { firstName: 'Mo', email: 'me@x' });
    expect(updated.firstName).toBe('Mo');
  });

  it('lets an admin reset a user’s password to a fresh hash, lifting the lock and ending sessions', async () => {
    const { svc, mem, revoked } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    mem.lock(u.id, new Date(Date.now() + 60 * 60_000));
    expect((await svc.getUser(u.id)).locked).toBe(true);
    const before = mem.hashOf(u.id);
    await svc.adminResetPassword(u.id, 'BrandNew1!');
    expect(mem.hashOf(u.id)).toBeTruthy();
    expect(mem.hashOf(u.id)).not.toBe(before);
    expect(mem.hashOf(u.id)).not.toBe('BrandNew1!');
    expect((await svc.getUser(u.id)).locked).toBe(false);
    expect(revoked).toEqual([u.id]);
    expect(mem.tokenVersion(u.id)).toBe(1);
  });

  it('enforces the password policy on admin reset and self change', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    await expect(svc.adminResetPassword(u.id, '123456')).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(svc.changeOwnPassword(u.id, 'OldPass1!', 'aaaaaa')).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('throws NotFound when resetting an unknown user’s password', async () => {
    await expect(make().svc.adminResetPassword('nope', 'BrandNew1!')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changes own password, ends every old session and returns a fresh one for the caller', async () => {
    const issued: { id: string; roles: string[]; tokenVersion: number }[] = [];
    const { svc, mem, revoked } = make({
      issueSession: async (user) => {
        issued.push(user);
        return { accessToken: 'new-access', refreshToken: 'new-refresh' };
      },
    });
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    const before = mem.hashOf(u.id);
    const session = await svc.changeOwnPassword(u.id, 'OldPass1!', 'NextPass1!');
    expect(mem.hashOf(u.id)).not.toBe(before);
    expect(revoked).toEqual([u.id]);
    expect(session).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(issued).toEqual([{ id: u.id, roles: ['EMPLOYEE'], tokenVersion: 1 }]); // issued after the bump
  });

  it('rejects a self password change when the current password is wrong', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    await expect(svc.changeOwnPassword(u.id, 'WrongPass!', 'NextPass1!')).rejects.toBeInstanceOf(ValidationError);
  });

  it('lets an admin unlock a locked account', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person());
    mem.lock(u.id, new Date(Date.now() + 60 * 60_000));
    const unlocked = await svc.unlockUser(u.id);
    expect(unlocked.locked).toBe(false);
  });

  it('ends sessions when a user is deleted', async () => {
    const { svc, revoked } = make();
    const u = await svc.createUser(person());
    await svc.deleteUser(u.id);
    expect(revoked).toEqual([u.id]);
  });
});

describe('UserService — never lose the last active administrator', () => {
  async function withAdmins(count: number) {
    const h = make();
    const admins = [];
    for (let i = 0; i < count; i++) admins.push(await h.svc.createUser(person({ email: `admin${i}@x`, username: `admin${i}`, roleNames: ['ADMIN'] })));
    return { ...h, admins };
  }

  it('refuses to remove the ADMIN role from the last active admin', async () => {
    const { svc, admins } = await withAdmins(1);
    await expect(svc.updateUser(admins[0]!.id, { roleNames: ['EMPLOYEE'] })).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
  });

  it('refuses to deactivate, suspend or delete the last active admin', async () => {
    const { svc, admins } = await withAdmins(1);
    await expect(svc.setUserStatus(admins[0]!.id, 'INACTIVE')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(svc.setUserStatus(admins[0]!.id, 'SUSPENDED')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(svc.deleteUser(admins[0]!.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('allows it while another active admin remains', async () => {
    const { svc, admins } = await withAdmins(2);
    await expect(svc.updateUser(admins[0]!.id, { roleNames: ['EMPLOYEE'] })).resolves.toMatchObject({ roles: ['EMPLOYEE'] });
    await expect(svc.setUserStatus(admins[1]!.id, 'INACTIVE')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('does not count an inactive admin as the remaining one', async () => {
    const { svc, admins } = await withAdmins(2);
    await svc.setUserStatus(admins[1]!.id, 'SUSPENDED');
    await expect(svc.deleteUser(admins[0]!.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
});
