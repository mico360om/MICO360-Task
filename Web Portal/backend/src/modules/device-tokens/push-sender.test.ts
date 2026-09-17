import { describe, it, expect, vi } from 'vitest';
import { createPushSender } from './push-sender';
import type { DeviceTokenRecord, DeviceTokenRepository } from './device-token-repository';

function repoWith(tokens: string[]): DeviceTokenRepository {
  const rows: DeviceTokenRecord[] = tokens.map((token, i) => ({
    id: `d${i}`,
    userId: 'u1',
    token,
    platform: 'ANDROID',
    createdAt: new Date(),
    lastSeenAt: new Date(),
  }));
  return {
    async findByToken() { return null; },
    async upsert() { throw new Error('unused'); },
    async deleteByToken() {},
    async listForUser() { return rows; },
  };
}

describe('createPushSender (A6.2 push sender)', () => {
  it('sends one message per device token, carrying deep-link entity data', async () => {
    const send = vi.fn(async (_messages: unknown) => {});
    const sender = createPushSender({ deviceTokens: repoWith(['tokA', 'tokB']), transport: { send } });
    const count = await sender.sendToUser('u1', { title: 'Assigned', body: 'You got a task', entityType: 'TASK', entityId: 't9' });
    expect(count).toBe(2);
    expect(send).toHaveBeenCalledOnce();
    const messages = send.mock.calls[0]![0] as { to: string; title: string; data: unknown }[];
    expect(messages.map((m) => m.to)).toEqual(['tokA', 'tokB']);
    expect(messages[0]).toMatchObject({ title: 'Assigned', body: 'You got a task', data: { entityType: 'TASK', entityId: 't9' } });
  });

  it('does nothing (and does not call the transport) when the user has no devices', async () => {
    const send = vi.fn(async () => {});
    const sender = createPushSender({ deviceTokens: repoWith([]), transport: { send } });
    expect(await sender.sendToUser('u1', { title: 'x' })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws if the transport fails (push is best-effort)', async () => {
    const send = vi.fn(async () => {
      throw new Error('FCM down');
    });
    const sender = createPushSender({ deviceTokens: repoWith(['tokA']), transport: { send } });
    await expect(sender.sendToUser('u1', { title: 'x' })).resolves.toBe(0);
  });
});
