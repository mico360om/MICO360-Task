import type { PrismaClient, Prisma } from '@prisma/client';
import { emptyConfig, type AiConfig } from './ai-config';
import type { AiConfigRepository } from './ai-config-repository';

/** Persists the AI config as a single JSON document in system_settings (no schema change). */
const KEY = 'ai.config';

export function createPrismaAiConfigRepository(prisma: PrismaClient): AiConfigRepository {
  return {
    async load() {
      const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
      const value = row?.value as Partial<AiConfig> | undefined;
      if (!value || typeof value !== 'object') return emptyConfig();
      return {
        providers: Array.isArray(value.providers) ? value.providers : [],
        models: Array.isArray(value.models) ? value.models : [],
        defaults: value.defaults && typeof value.defaults === 'object' ? value.defaults : {},
      };
    },
    async save(config) {
      const v = config as unknown as Prisma.InputJsonValue;
      await prisma.systemSetting.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } });
    },
  };
}
