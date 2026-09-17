import { describe, it, expect, vi } from 'vitest';
import { createAiConfigService } from './ai-config-service.js';
import { createMemoryAiConfigRepository } from './ai-config-repository.js';

function fakeAudit() {
  const entries: Array<{ action: string; module: string; entityId: string | null; userId: string | null }> = [];
  return {
    audit: {
      async record(d: { action: string; module: string; entityId?: string | null; userId?: string | null }) {
        entries.push({ action: d.action, module: d.module, entityId: d.entityId ?? null, userId: d.userId ?? null });
        return { id: 'a', ...d } as never;
      },
      async list() {
        return [] as never;
      },
    },
    entries,
  };
}

function make(fetchImpl?: typeof fetch) {
  let seq = 0;
  const { audit, entries } = fakeAudit();
  const svc = createAiConfigService({
    repo: createMemoryAiConfigRepository(),
    audit,
    genId: () => `id${++seq}`,
    now: () => '2026-09-08T00:00:00.000Z',
    fetchImpl,
  });
  return { svc, entries };
}

const actor = { userId: 'admin1', ip: '127.0.0.1' };

describe('AiConfigService', () => {
  it('adds a provider, persists it, audits it, and never returns the API key', async () => {
    const { svc, entries } = make();
    const cfg = await svc.addProvider({ name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-abcd1234' }, actor);
    expect(cfg.providers).toHaveLength(1);
    expect('apiKey' in cfg.providers[0]!).toBe(false);
    expect(cfg.providers[0]!.hasApiKey).toBe(true);
    expect(entries[0]).toMatchObject({ action: 'ai.provider.create', module: 'ai', userId: 'admin1' });
  });

  it('adds models and hides disabled ones from the consumer view', async () => {
    const { svc } = make();
    await svc.addProvider({ name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat', 'vision'] }, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-3.5', capabilities: ['chat'], enabled: false }, actor);
    const usable = await svc.getUsableModels('chat');
    expect(usable.map((m) => m.modelKey)).toEqual(['gpt-4o']); // disabled model hidden
  });

  it('sets a default and records an audit entry', async () => {
    const { svc, entries } = make();
    await svc.addProvider({ name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] }, actor);
    const cfg = await svc.setDefault('chat', 'id2', actor);
    expect(cfg.defaults.chat).toBe('id2');
    expect(entries.some((e) => e.action === 'ai.default.set')).toBe(true);
  });

  it('syncs models from the provider (auto-detect) and audits the sync', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'o1-mini' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { svc, entries } = make(fetchImpl);
    await svc.addProvider({ name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] }, actor);
    const res = await svc.syncProvider('id1', actor);
    expect(res.detected).toBe(2);
    expect(res.added).toBe(1); // o1-mini was new
    expect(res.config.models.map((m) => m.modelKey).sort()).toEqual(['gpt-4o', 'o1-mini']);
    expect(entries.some((e) => e.action === 'ai.provider.sync')).toBe(true);
  });

  it('changes apply immediately (next read reflects the update — no restart)', async () => {
    const { svc } = make();
    await svc.addProvider({ name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, actor);
    await svc.updateProvider('id1', { enabled: false }, actor);
    const cfg = await svc.getConfig();
    expect(cfg.providers[0]!.enabled).toBe(false);
  });
});
