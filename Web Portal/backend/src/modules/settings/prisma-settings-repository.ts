import type { PrismaClient, Prisma } from '@prisma/client';
import type { SettingsRepository } from './settings-repository';

export function createPrismaSettingsRepository(prisma: PrismaClient): SettingsRepository {
  return {
    async getAll() {
      const rows = await prisma.systemSetting.findMany();
      return rows.map((r) => ({ key: r.key, value: r.value }));
    },
    async set(key, value) {
      const v = value as Prisma.InputJsonValue;
      const row = await prisma.systemSetting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
      return { key: row.key, value: row.value };
    },
  };
}
