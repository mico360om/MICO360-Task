import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaAiConfigRepository } from './prisma-ai-config-repository';
import { createSecretBox } from '../settings/secret-box';
import { addProvider, emptyConfig, type AiConfig } from './ai-config';

/** Just enough of prisma.systemSetting for the repository, with @updatedAt semantics. */
function fakePrisma(initial?: unknown) {
  let row: { key: string; value: unknown; updatedAt: Date } | null = initial === undefined ? null : { key: 'ai.config', value: initial, updatedAt: new Date(1) };
  let tick = 1;
  let beforeWrite: (() => void) | null = null;
  const systemSetting = {
    async findUnique() {
      return row ? { ...row } : null;
    },
    async create({ data }: { data: { key: string; value: unknown } }) {
      if (row) throw Object.assign(new Error('unique'), { code: 'P2002' });
      row = { ...data, updatedAt: new Date(++tick) };
    },
    async updateMany({ where, data }: { where: { updatedAt: Date }; data: { value: unknown } }) {
      beforeWrite?.();
      beforeWrite = null;
      if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      row = { ...row, value: data.value, updatedAt: new Date(++tick) };
      return { count: 1 };
    },
    async upsert({ create, update }: { create: { key: string; value: unknown }; update: { value: unknown } }) {
      row = row ? { ...row, value: update.value, updatedAt: new Date(++tick) } : { ...create, updatedAt: new Date(++tick) };
    },
  };
  return {
    prisma: { systemSetting } as unknown as PrismaClient,
    stored: () => row?.value as AiConfig | undefined,
    /** Simulate another admin's write landing between our read and our write. */
    interleave: (fn: () => void) => (beforeWrite = fn),
    bump: (value: unknown) => (row = { key: 'ai.config', value, updatedAt: new Date(++tick) }),
  };
}

const box = createSecretBox([{ material: 'test-secret-material', info: 'test' }]);
const withProvider = (apiKey: string) =>
  addProvider(emptyConfig(), { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey }, { id: 'p1', now: 'now' }).config;

describe('PrismaAiConfigRepository', () => {
  it('encrypts API keys at rest and decrypts them on load', async () => {
    const db = fakePrisma();
    const repo = createPrismaAiConfigRepository(db.prisma, { secrets: box });
    await repo.save(withProvider('sk-live-123456'));
    const stored = db.stored()!;
    expect(stored.providers[0]!.apiKey).toMatch(/^enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain('sk-live-123456');
    expect((await repo.load()).providers[0]!.apiKey).toBe('sk-live-123456');
  });

  it('still loads a legacy plaintext key, and encrypts it on the next save', async () => {
    const db = fakePrisma(withProvider('sk-legacy-plain'));
    const repo = createPrismaAiConfigRepository(db.prisma, { secrets: box });
    const loaded = await repo.load();
    expect(loaded.providers[0]!.apiKey).toBe('sk-legacy-plain');
    await repo.update((c) => ({ ...c, defaults: { chat: null } }));
    expect(db.stored()!.providers[0]!.apiKey).toMatch(/^enc:v1:/);
  });

  it('keeps an undecryptable key as stored instead of wiping it on an unrelated save', async () => {
    const other = createSecretBox([{ material: 'rotated-away-key', info: 'test' }]);
    const encrypted = { ...withProvider(''), providers: [{ ...withProvider('').providers[0]!, apiKey: other.encrypt('sk-old') }] };
    const db = fakePrisma(encrypted);
    const repo = createPrismaAiConfigRepository(db.prisma, { secrets: box });
    expect((await repo.load()).providers[0]!.apiKey).toBe('');
    await repo.update((c) => ({ ...c, defaults: { chat: null } }));
    expect(other.decrypt(db.stored()!.providers[0]!.apiKey)).toBe('sk-old');
  });

  it('re-applies a change when another write landed in between (no lost update)', async () => {
    const db = fakePrisma(emptyConfig());
    const repo = createPrismaAiConfigRepository(db.prisma, { secrets: box });
    db.interleave(() => db.bump({ ...emptyConfig(), defaults: { vision: 'from-other-admin' } }));
    const next = await repo.update((c) => ({ ...c, defaults: { ...c.defaults, chat: 'mine' } }));
    expect(next.defaults).toEqual({ vision: 'from-other-admin', chat: 'mine' });
    expect(db.stored()!.defaults).toEqual({ vision: 'from-other-admin', chat: 'mine' });
  });

  it('creates the document on first update', async () => {
    const db = fakePrisma();
    const repo = createPrismaAiConfigRepository(db.prisma, { secrets: box });
    await repo.update((c) => ({ ...c, defaults: { chat: null } }));
    expect(db.stored()!.defaults).toEqual({ chat: null });
  });
});
