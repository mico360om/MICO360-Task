import { describe, it, expect, beforeEach } from 'vitest';
import { createDeviceTokenService } from './device-token-service';
import type { DeviceTokenRecord, DeviceTokenRepository, RegisterDeviceTokenData } from './device-token-repository';

function inMemory(): DeviceTokenRepository {
  const rows = new Map<string, DeviceTokenRecord>(); // keyed by token (unique)
  let seq = 0;
  return {
    async findByToken(token) {
      return rows.get(token) ?? null;
    },
    async upsert(data: RegisterDeviceTokenData) {
      const existing = rows.get(data.token);
      const rec: DeviceTokenRecord = existing
        ? { ...existing, userId: data.userId, platform: data.platform, lastSeenAt: new Date() }
        : { id: `d${seq++}`, userId: data.userId, token: data.token, platform: data.platform, createdAt: new Date(), lastSeenAt: new Date() };
      rows.set(data.token, rec);
      return rec;
    },
    async deleteByToken(token) {
      rows.delete(token);
    },
    async listForUser(userId) {
      return [...rows.values()].filter((r) => r.userId === userId);
    },
  };
}

let svc: ReturnType<typeof createDeviceTokenService>;
beforeEach(() => {
  svc = createDeviceTokenService({ deviceTokens: inMemory() });
});

describe('DeviceTokenService', () => {
  it('registers a token for a user and lists it', async () => {
    await svc.register({ userId: 'u1', token: 'fcm-abc', platform: 'ANDROID' });
    const list = await svc.listForUser('u1');
    expect(list).toHaveLength(1);
    expect(list[0]!.token).toBe('fcm-abc');
    expect(list[0]!.platform).toBe('ANDROID');
  });

  it('is idempotent — re-registering the same token does not duplicate it', async () => {
    await svc.register({ userId: 'u1', token: 'fcm-abc', platform: 'ANDROID' });
    await svc.register({ userId: 'u1', token: 'fcm-abc', platform: 'ANDROID' });
    expect(await svc.listForUser('u1')).toHaveLength(1);
  });

  it('reassigns a token to a new user (shared device / re-login)', async () => {
    await svc.register({ userId: 'u1', token: 'fcm-abc', platform: 'ANDROID' });
    await svc.register({ userId: 'u2', token: 'fcm-abc', platform: 'ANDROID' });
    expect(await svc.listForUser('u1')).toHaveLength(0);
    expect(await svc.listForUser('u2')).toHaveLength(1);
  });

  it('unregisters only the caller’s own token', async () => {
    await svc.register({ userId: 'u1', token: 'fcm-abc', platform: 'ANDROID' });
    await svc.unregister('fcm-abc', 'u2'); // not the owner → no-op
    expect(await svc.listForUser('u1')).toHaveLength(1);
    await svc.unregister('fcm-abc', 'u1');
    expect(await svc.listForUser('u1')).toHaveLength(0);
  });

  it('unregistering an unknown token is a no-op', async () => {
    await expect(svc.unregister('nope', 'u1')).resolves.toBeUndefined();
  });
});
