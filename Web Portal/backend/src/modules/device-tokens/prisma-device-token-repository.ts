import type { PrismaClient, DeviceToken } from '@prisma/client';
import type { DeviceTokenRecord, DeviceTokenRepository, DevicePlatform } from './device-token-repository';

function toRecord(d: DeviceToken): DeviceTokenRecord {
  return {
    id: d.id,
    userId: d.userId,
    token: d.token,
    platform: d.platform as DevicePlatform,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  };
}

export function createPrismaDeviceTokenRepository(prisma: PrismaClient): DeviceTokenRepository {
  return {
    async findByToken(token) {
      const d = await prisma.deviceToken.findUnique({ where: { token } });
      return d ? toRecord(d) : null;
    },
    async upsert(data) {
      const d = await prisma.deviceToken.upsert({
        where: { token: data.token },
        create: { userId: data.userId, token: data.token, platform: data.platform },
        update: { userId: data.userId, platform: data.platform, lastSeenAt: new Date() },
      });
      return toRecord(d);
    },
    async deleteByToken(token) {
      await prisma.deviceToken.deleteMany({ where: { token } });
    },
    async listForUser(userId) {
      const ds = await prisma.deviceToken.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
      return ds.map(toRecord);
    },
  };
}
