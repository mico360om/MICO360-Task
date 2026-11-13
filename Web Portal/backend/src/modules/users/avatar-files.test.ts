import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// Review fixes #24 and #23 (batch 4b): a replaced or removed profile photo — and its small face copy — is deleted
// from storage (best effort, logged, never failing the request); a photo whose save to the account fails is not
// left on disk.
const tokenService = createTokenService({
  accessSecret: 'avf-access',
  refreshSecret: 'avf-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const BOUNDARY = '----mico360avatarfiles';
const upload = () =>
  Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
const key = (n: number) => `0b2f6c1e-1d2a-4c3b-9e8f-${String(n).padStart(12, '0')}.png`;

async function world(opts: { failRemove?: boolean; failSetAvatar?: boolean } = {}) {
  const mem = createMemoryUserRepository();
  const users = opts.failSetAvatar
    ? { ...mem.repo, async setAvatar() { throw new Error('db down'); } }
    : mem.repo;
  const userService = createUserService({ users, issueSession: (user) => tokenService.issueTokens(user) });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  let n = 0;
  const onDisk = new Set<string>();
  const removed: string[] = [];
  const storage = {
    async save() {
      const storageKey = key(++n);
      onDisk.add(storageKey);
      return { storageKey, url: `/uploads/${storageKey}`, sizeBytes: PNG.length };
    },
    async remove(k: string) {
      removed.push(k);
      if (opts.failRemove) throw new Error('EPERM: operation not permitted');
      onDisk.delete(k);
    },
  };
  const faces = new Set<string>();
  const discarded: string[] = [];
  const avatarFaces = {
    async prepare(url: string) { faces.add(url); },
    async discard(url: string) {
      discarded.push(url);
      if (opts.failRemove) throw new Error('EPERM');
      faces.delete(url);
    },
  };
  const a = await buildApp({ authService, tokenService, userService, chatAttachmentStorage: storage as never, avatarFaces });
  const admin = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken}` };
  const sara = (await a.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: { email: 'sara@x.co', username: 'sara', password: 'Password1!', firstName: 'Sara', lastName: 'A' } })).json().data;
  const headers = { authorization: `Bearer ${(await tokenService.issueTokens({ id: sara.id, roles: ['EMPLOYEE'] })).accessToken}` };
  const put = () => a.inject({ method: 'POST', url: '/api/v1/users/me/avatar', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: upload() });
  const clear = () => a.inject({ method: 'DELETE', url: '/api/v1/users/me/avatar', headers });
  return { a, put, clear, onDisk, removed, faces, discarded };
}

describe('#24 an old profile photo doesn’t stay reachable', () => {
  it('replacing a photo deletes the old one and its face copy; the new one stays', async () => {
    const w = await world();
    expect((await w.put()).statusCode).toBe(200);
    const second = await w.put();
    expect(second.statusCode).toBe(200);
    expect(second.json().data.avatarUrl).toBe(`/uploads/${key(2)}`);
    expect([...w.onDisk]).toEqual([key(2)]);
    expect(w.discarded).toEqual([`/uploads/${key(1)}`]);
    expect([...w.faces]).toEqual([`/uploads/${key(2)}`]);
  });

  it('removing a photo deletes it and its face copy', async () => {
    const w = await world();
    await w.put();
    const res = await w.clear();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.avatarUrl).toBeNull();
    expect([...w.onDisk]).toEqual([]);
    expect(w.discarded).toEqual([`/uploads/${key(1)}`]);
  });

  it('a file storage won’t delete never fails the change (it is logged)', async () => {
    const w = await world({ failRemove: true });
    await w.put();
    const second = await w.put();
    expect(second.statusCode).toBe(200);
    expect(second.json().data.avatarUrl).toBe(`/uploads/${key(2)}`);
    expect((await w.clear()).statusCode).toBe(200);
    expect(w.removed.filter((k) => k === key(1)).length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

describe('#23 a photo whose save to the account fails is not left on disk', () => {
  it('the new file (and its face copy) is removed and the error reported', async () => {
    const w = await world({ failSetAvatar: true });
    const res = await w.put();
    expect(res.statusCode).toBe(500);
    expect([...w.onDisk]).toEqual([]);
    expect(w.discarded).toEqual([`/uploads/${key(1)}`]);
  });
});
