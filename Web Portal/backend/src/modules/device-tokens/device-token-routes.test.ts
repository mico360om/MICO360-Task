import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createDeviceTokenService } from './device-token-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { DeviceTokenRecord, DeviceTokenRepository } from './device-token-repository';

function inMemory(): DeviceTokenRepository {
  const rows = new Map<string, DeviceTokenRecord>();
  let seq = 0;
  return {
    async findByToken(token) { return rows.get(token) ?? null; },
    async upsert(data) {
      const existing = rows.get(data.token);
      const rec: DeviceTokenRecord = existing
        ? { ...existing, userId: data.userId, platform: data.platform, lastSeenAt: new Date() }
        : { id: `d${seq++}`, userId: data.userId, token: data.token, platform: data.platform, createdAt: new Date(), lastSeenAt: new Date() };
      rows.set(data.token, rec);
      return rec;
    },
    async deleteByToken(token) { rows.delete(token); },
    async listForUser(userId) { return [...rows.values()].filter((r) => r.userId === userId); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'dt-access',
  refreshSecret: 'dt-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const deviceTokenService = createDeviceTokenService({ deviceTokens: inMemory() });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, deviceTokenService });
}
const auth = async () => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken}` });

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Device-token routes', () => {
  it('registers a device token (201) and lists it', async () => {
    const headers = await auth();
    const post = await app.inject({ method: 'POST', url: '/api/v1/device-tokens', headers, payload: { token: 'fcm-1', platform: 'ANDROID' } });
    expect(post.statusCode).toBe(201);
    expect(post.json().data.token).toBe('fcm-1');

    const list = await app.inject({ method: 'GET', url: '/api/v1/device-tokens', headers });
    expect(list.json().data).toHaveLength(1);
  });

  it('defaults platform to ANDROID when omitted', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/device-tokens', headers: await auth(), payload: { token: 'fcm-2' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.platform).toBe('ANDROID');
  });

  it('rejects a missing token (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/device-tokens', headers: await auth(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('unregisters a device token (204)', async () => {
    const headers = await auth();
    await app.inject({ method: 'POST', url: '/api/v1/device-tokens', headers, payload: { token: 'fcm-3', platform: 'ANDROID' } });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/device-tokens/fcm-3', headers });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/v1/device-tokens', headers });
    expect(list.json().data).toHaveLength(0);
  });

  it('rejects unauthenticated registration (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/device-tokens', payload: { token: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});
