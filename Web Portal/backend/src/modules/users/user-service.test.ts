import { describe, it, expect } from 'vitest';
import { createUserService } from './user-service';
import type { CreateUserData, UserRepository, UserSummary } from './user-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';

function inMemory() {
  const rows = new Map<string, UserSummary>();
  const hashes: Record<string, string> = {};
  let seq = 0;
  const repo: UserRepository = {
    async create(data: CreateUserData) {
      const u: UserSummary = {
        id: `u${seq++}`,
        email: data.email,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: null,
        status: 'ACTIVE',
        departmentId: data.departmentId ?? null,
        roles: data.roleNames,
      };
      rows.set(u.id, u);
      hashes[u.id] = data.passwordHash;
      return u;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByEmailOrUsername(email, username) {
      return [...rows.values()].find((u) => u.email === email || u.username === username) ?? null;
    },
    async list() { return [...rows.values()]; },
    async update(id, patch) {
      const { roleNames, ...rest } = patch;
      const u = { ...rows.get(id)!, ...rest, ...(roleNames ? { roles: roleNames } : {}) };
      rows.set(id, u);
      return u;
    },
    async setStatus(id, status) { const u = { ...rows.get(id)!, status }; rows.set(id, u); return u; },
    async setAvatar(id, avatarUrl) { const u = { ...rows.get(id)!, avatarUrl }; rows.set(id, u); return u; },
    async setPassword(id, passwordHash) { hashes[id] = passwordHash; },
    async getPasswordHash(id) { return hashes[id] ?? null; },
    async softDelete(id) { rows.delete(id); },
  };
  return { repo, hashes };
}

describe('UserService', () => {
  it('creates a user with a hashed password and roles', async () => {
    const { repo, hashes } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'Password1!', firstName: 'Ada', lastName: 'L', roleNames: ['EMPLOYEE'] });
    expect(u.username).toBe('ada');
    expect(u.roles).toEqual(['EMPLOYEE']);
    expect(hashes[u.id]).toBeTruthy();
    expect(hashes[u.id]).not.toBe('Password1!');
  });

  it('rejects a duplicate email or username', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    await svc.createUser({ email: 'a@x', username: 'ada', password: 'p1234567', firstName: 'A', lastName: 'L', roleNames: [] });
    await expect(
      svc.createUser({ email: 'a@x', username: 'other', password: 'p1234567', firstName: 'B', lastName: 'M', roleNames: [] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFound for an unknown user', async () => {
    const { repo } = inMemory();
    await expect(createUserService({ users: repo }).getUser('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets a user status (activate/deactivate/suspend)', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'p1234567', firstName: 'A', lastName: 'L', roleNames: [] });
    const suspended = await svc.setUserStatus(u.id, 'SUSPENDED');
    expect(suspended.status).toBe('SUSPENDED');
  });

  it('updates profile details, email, username and roles', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'p1234567', firstName: 'A', lastName: 'L', roleNames: ['EMPLOYEE'] });
    const updated = await svc.updateUser(u.id, { firstName: 'Ada', email: 'ada@new.co', username: 'ada2', roleNames: ['MANAGER', 'EMPLOYEE'] });
    expect(updated.firstName).toBe('Ada');
    expect(updated.email).toBe('ada@new.co');
    expect(updated.username).toBe('ada2');
    expect(updated.roles).toEqual(['MANAGER', 'EMPLOYEE']);
  });

  it('rejects an update whose new email collides with another user', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    await svc.createUser({ email: 'taken@x', username: 'taken', password: 'p1234567', firstName: 'T', lastName: 'K', roleNames: [] });
    const u = await svc.createUser({ email: 'me@x', username: 'me', password: 'p1234567', firstName: 'M', lastName: 'E', roleNames: [] });
    await expect(svc.updateUser(u.id, { email: 'taken@x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows an update that keeps the user’s own email/username unchanged', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'me@x', username: 'me', password: 'p1234567', firstName: 'M', lastName: 'E', roleNames: [] });
    const updated = await svc.updateUser(u.id, { firstName: 'Mo', email: 'me@x' });
    expect(updated.firstName).toBe('Mo');
  });

  it('lets an admin reset a user’s password to a fresh hash', async () => {
    const { repo, hashes } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'OldPass1!', firstName: 'A', lastName: 'L', roleNames: [] });
    const before = hashes[u.id];
    await svc.adminResetPassword(u.id, 'BrandNew1!');
    expect(hashes[u.id]).toBeTruthy();
    expect(hashes[u.id]).not.toBe(before);
    expect(hashes[u.id]).not.toBe('BrandNew1!');
  });

  it('throws NotFound when resetting an unknown user’s password', async () => {
    const { repo } = inMemory();
    await expect(createUserService({ users: repo }).adminResetPassword('nope', 'BrandNew1!')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changes own password when the current password is correct', async () => {
    const { repo, hashes } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'OldPass1!', firstName: 'A', lastName: 'L', roleNames: [] });
    const before = hashes[u.id];
    await svc.changeOwnPassword(u.id, 'OldPass1!', 'NextPass1!');
    expect(hashes[u.id]).not.toBe(before);
  });

  it('rejects a self password change when the current password is wrong', async () => {
    const { repo } = inMemory();
    const svc = createUserService({ users: repo });
    const u = await svc.createUser({ email: 'a@x', username: 'ada', password: 'OldPass1!', firstName: 'A', lastName: 'L', roleNames: [] });
    await expect(svc.changeOwnPassword(u.id, 'WrongPass!', 'NextPass1!')).rejects.toBeInstanceOf(ValidationError);
  });
});
