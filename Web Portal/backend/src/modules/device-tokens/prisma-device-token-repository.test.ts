import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaDeviceTokenRepository } from './prisma-device-token-repository';

// The query shape against a stand-in client (no database needed).
describe('createPrismaDeviceTokenRepository', () => {
  it('deleteForUser removes only that user’s tokens and returns the count', async () => {
    const deleteMany = vi.fn(async () => ({ count: 2 }));
    const repo = createPrismaDeviceTokenRepository({ deviceToken: { deleteMany } } as unknown as PrismaClient);
    expect(await repo.deleteForUser('u1')).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});
