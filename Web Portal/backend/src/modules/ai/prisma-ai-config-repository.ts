import type { PrismaClient, Prisma } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import { getEnv } from '../../config/env';
import { secretBoxFromEnv, type SecretBox } from '../settings/secret-box';
import { emptyConfig, type AiConfig, type AiProvider } from './ai-config';
import type { AiConfigRepository } from './ai-config-repository';

/** Persists the AI config as a single JSON document in system_settings (no schema change). */
const KEY = 'ai.config';
const MAX_UPDATE_ATTEMPTS = 5;

export interface PrismaAiConfigRepositoryOptions {
  /** Encrypts provider API keys at rest. Defaults to the key from SECRETS_ENCRYPTION_KEY / JWT_ACCESS_SECRET. */
  secrets?: SecretBox;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

export function createPrismaAiConfigRepository(prisma: PrismaClient, opts: PrismaAiConfigRepositoryOptions = {}): AiConfigRepository {
  let box: SecretBox | undefined = opts.secrets;
  const secrets = () => (box ??= secretBoxFromEnv(getEnv()));
  // Keys that could not be decrypted (e.g. the encryption key changed): kept as stored, so a save
  // of an unrelated change doesn't wipe them. Re-entering the key replaces them.
  const unreadable = new Map<string, string>();

  function decode(value: unknown): AiConfig {
    const doc = value as Partial<AiConfig> | null | undefined;
    if (!doc || typeof doc !== 'object') return emptyConfig();
    const providers = (Array.isArray(doc.providers) ? doc.providers : []).map((p: AiProvider): AiProvider => {
      if (!p.apiKey) return { ...p, apiKey: '' };
      try {
        const apiKey = secrets().decrypt(p.apiKey); // legacy plaintext passes straight through
        unreadable.delete(p.id);
        return { ...p, apiKey };
      } catch {
        unreadable.set(p.id, p.apiKey);
        opts.logger?.warn('an AI provider API key could not be decrypted — re-enter it in AI Management', { providerId: p.id });
        return { ...p, apiKey: '' };
      }
    });
    return {
      providers,
      models: Array.isArray(doc.models) ? doc.models : [],
      defaults: doc.defaults && typeof doc.defaults === 'object' ? doc.defaults : {},
    };
  }

  function encode(config: AiConfig): Prisma.InputJsonValue {
    const providers = config.providers.map((p) => {
      if (!p.apiKey) return { ...p, apiKey: unreadable.get(p.id) ?? '' };
      unreadable.delete(p.id);
      return { ...p, apiKey: secrets().encrypt(p.apiKey) };
    });
    return { ...config, providers } as unknown as Prisma.InputJsonValue;
  }

  return {
    async load() {
      const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
      return decode(row?.value);
    },
    async save(config) {
      const v = encode(config);
      await prisma.systemSetting.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } });
    },
    async update(change) {
      // Optimistic concurrency on the row's updatedAt: the write only lands if nobody else wrote
      // since we read; otherwise re-read and re-apply the change.
      for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
        const next = await change(decode(row?.value));
        const value = encode(next);
        if (!row) {
          try {
            await prisma.systemSetting.create({ data: { key: KEY, value } });
            return next;
          } catch (err) {
            if (isUniqueViolation(err)) continue;
            throw err;
          }
        }
        const { count } = await prisma.systemSetting.updateMany({ where: { key: KEY, updatedAt: row.updatedAt }, data: { value } });
        if (count === 1) return next;
      }
      throw new ConflictError('The AI settings were changed by someone else at the same time. Please try again.', 'AI_CONFIG_CONFLICT');
    },
  };
}
