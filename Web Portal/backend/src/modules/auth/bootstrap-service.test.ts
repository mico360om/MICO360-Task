import { describe, it, expect } from 'vitest';
import { createBootstrapService, type BootstrapUserRepo } from './bootstrap-service';
import { WeakPasswordError } from './errors';

function repo(adminExists: boolean) {
  const created: { email: string; passwordHash: string }[] = [];
  const r: BootstrapUserRepo = {
    async anyAdminExists() { return adminExists; },
    async createAdmin(data) { created.push({ email: data.email, passwordHash: data.passwordHash }); return { id: 'new-admin' }; },
  };
  return { r, created };
}

const input = { email: 'boss@co.com', username: 'boss', password: 'Password1!', firstName: 'Boss', lastName: 'Person' };

describe('BootstrapService.ensureFirstAdmin', () => {
  it('creates the first admin when none exists (password hashed)', async () => {
    const { r, created } = repo(false);
    const svc = createBootstrapService({ users: r, hashPassword: async (p) => `h:${p}` });
    const result = await svc.ensureFirstAdmin(input);
    expect(result).toEqual({ created: true, id: 'new-admin' });
    expect(created).toEqual([{ email: 'boss@co.com', passwordHash: 'h:Password1!' }]);
  });

  it('is a no-op when an admin already exists (never overwrites)', async () => {
    const { r, created } = repo(true);
    const svc = createBootstrapService({ users: r, hashPassword: async (p) => `h:${p}` });
    const result = await svc.ensureFirstAdmin(input);
    expect(result).toEqual({ created: false });
    expect(created).toHaveLength(0);
  });

  it('rejects a weak bootstrap password', async () => {
    const { r } = repo(false);
    const svc = createBootstrapService({ users: r, hashPassword: async (p) => `h:${p}` });
    await expect(svc.ensureFirstAdmin({ ...input, password: 'weak' })).rejects.toBeInstanceOf(WeakPasswordError);
  });
});
