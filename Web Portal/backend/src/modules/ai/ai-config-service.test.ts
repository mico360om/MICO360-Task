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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A provider that lists `models` and answers chat requests with "OK" (an empty list unless given). */
function provider(models: string[] = []) {
  return vi.fn(async (url: string) => (String(url).includes('/chat/completions') ? json({ choices: [{ message: { content: 'OK' } }] }) : json({ data: models.map((id) => ({ id })) })));
}

function make(fetchImpl: typeof fetch = provider() as unknown as typeof fetch, clock = { now: '2026-09-08T00:00:00.000Z' }) {
  let seq = 0;
  const { audit, entries } = fakeAudit();
  const repo = createMemoryAiConfigRepository();
  const svc = createAiConfigService({
    repo,
    audit,
    genId: () => `id${++seq}`,
    now: () => clock.now,
    fetchImpl,
  });
  return { svc, entries, repo };
}

const actor = { userId: 'admin1', ip: '127.0.0.1' };
const openai = { name: 'OpenAI', kind: 'openai' as const, apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-abcd1234' };

describe('AiConfigService', () => {
  it('adds a provider, persists it, audits it, and never returns the API key', async () => {
    const { svc, entries } = make();
    const cfg = await svc.addProvider(openai, actor);
    expect(cfg.providers).toHaveLength(1);
    expect('apiKey' in cfg.providers[0]!).toBe(false);
    expect(cfg.providers[0]!.hasApiKey).toBe(true);
    expect(entries[0]).toMatchObject({ action: 'ai.provider.create', module: 'ai', userId: 'admin1' });
  });

  it('adds models and hides disabled ones from the consumer view', async () => {
    const { svc } = make();
    await svc.addProvider(openai, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat', 'vision'] }, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-3.5', capabilities: ['chat'], enabled: false }, actor);
    const usable = await svc.getUsableModels('chat');
    expect(usable.map((m) => m.modelKey)).toEqual(['gpt-4o']); // disabled model hidden
  });

  it('sets a default and records an audit entry', async () => {
    const { svc, entries } = make();
    await svc.addProvider(openai, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] }, actor);
    const cfg = await svc.setDefault('chat', 'id2', actor);
    expect(cfg.defaults.chat).toBe('id2');
    expect(entries.some((e) => e.action === 'ai.default.set')).toBe(true);
  });

  it('syncs models from the provider (auto-detect) and audits the sync', async () => {
    const list = { models: [] as string[] };
    const fetchImpl = vi.fn(async () => json({ data: list.models.map((id) => ({ id })) })) as unknown as typeof fetch;
    const { svc, entries } = make(fetchImpl);
    await svc.addProvider(openai, actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] }, actor);
    list.models = ['gpt-4o', 'o1-mini'];
    const res = await svc.syncProvider('id1', actor);
    expect(res.detected).toBe(2);
    expect(res.added).toBe(1); // o1-mini was new
    expect(res.config.models.map((m) => m.modelKey).sort()).toEqual(['gpt-4o', 'o1-mini']);
    expect(entries.some((e) => e.action === 'ai.provider.sync')).toBe(true);
  });

  it('keeps both of two concurrent admin edits (atomic read-modify-write)', async () => {
    const { svc } = make();
    await svc.addProvider(openai, actor);
    await Promise.all([
      svc.addModel({ providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] }, actor),
      svc.addModel({ providerId: 'id1', modelKey: 'o1-mini', capabilities: ['chat'] }, actor),
      svc.updateProvider('id1', { name: 'OpenAI (prod)' }, actor),
    ]);
    const cfg = await svc.getConfig();
    expect(cfg.models.map((m) => m.modelKey).sort()).toEqual(['gpt-4o', 'o1-mini']);
    expect(cfg.providers[0]!.name).toBe('OpenAI (prod)');
  });

  it('applies a sync to the latest config, not a copy taken before the network call', async () => {
    let slow = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = (async () => {
      if (slow) await gate; // the provider is slow to answer
      return json({ data: slow ? [{ id: 'gpt-4o' }] : [] });
    }) as unknown as typeof fetch;
    const { svc } = make(fetchImpl);
    await svc.addProvider(openai, actor);
    slow = true;
    const syncing = svc.syncProvider('id1', actor);
    await svc.addModel({ providerId: 'id1', modelKey: 'manual-model', capabilities: ['chat'] }, actor); // edit during the sync
    release();
    const res = await syncing;
    expect(res.config.models.map((m) => m.modelKey).sort()).toEqual(['gpt-4o', 'manual-model']);
  });

  it('refuses a private provider address on add and on edit', async () => {
    const { svc } = make();
    await expect(svc.addProvider({ name: 'x', kind: 'custom', apiBaseUrl: 'http://10.0.0.8:8080' }, actor)).rejects.toThrow(/public address/);
    const cfg = await svc.addProvider(openai, actor);
    await expect(svc.updateProvider(cfg.providers[0]!.id, { apiBaseUrl: 'http://localhost:6379' }, actor)).rejects.toThrow(/public address/);
  });

  it('changes apply immediately (next read reflects the update — no restart)', async () => {
    const { svc } = make();
    await svc.addProvider(openai, actor);
    await svc.updateProvider('id1', { enabled: false }, actor);
    const cfg = await svc.getConfig();
    expect(cfg.providers[0]!.enabled).toBe(false);
  });
});

describe('AiConfigService: connecting loads the models', () => {
  it('loads the list when a provider is added and switches on the recommended chat model', async () => {
    const { svc } = make(provider(['gpt-4o', 'gpt-4o-mini', 'dall-e-3', 'text-embedding-3-small']) as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    expect(cfg.models.map((m) => [m.modelKey, m.enabled])).toEqual([
      ['gpt-4o', false],
      ['gpt-4o-mini', true],
      ['text-embedding-3-small', false],
    ]);
    expect(cfg.providers[0]).toMatchObject({ lastSyncedAt: '2026-09-08T00:00:00.000Z', lastSyncError: null, recommendedModelId: cfg.models[1]!.id });
    expect(cfg.automatic.chat).toBe(cfg.models[1]!.id);
  });

  it('does not save a provider whose key is refused', async () => {
    const { svc } = make(vi.fn(async () => json({ error: { message: 'Incorrect API key' } }, 401)) as unknown as typeof fetch);
    await expect(svc.addProvider(openai, actor)).rejects.toThrow(/did not accept the API key/);
    expect((await svc.getConfig()).providers).toHaveLength(0);
  });

  it('saves a provider whose list cannot be loaded, with the reason, so models can be added by name', async () => {
    const { svc } = make(vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    const cfg = await svc.addProvider({ name: 'House AI', kind: 'custom', apiBaseUrl: 'https://ai.example.com/v1' }, actor);
    expect(cfg.providers[0]).toMatchObject({ name: 'House AI', lastSyncError: expect.stringMatching(/could not reach/i) });
    expect(cfg.providers[0]!.lastSyncedAt ?? null).toBeNull();
    expect(cfg.models).toHaveLength(0);
  });

  it('reloads the models with a new key, and keeps the old key when the new one is refused', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const key = (init?.headers as Record<string, string>).Authorization;
      if (key === 'Bearer sk-bad') return json({ error: 'no' }, 401);
      return json({ data: key === 'Bearer sk-new' ? [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] : [{ id: 'gpt-4o-mini' }] });
    });
    const { svc, repo } = make(fetchImpl as unknown as typeof fetch);
    await svc.addProvider(openai, actor);
    await expect(svc.updateProvider('id1', { apiKey: 'sk-bad' }, actor)).rejects.toThrow(/did not accept the API key/);
    expect((await repo.load()).providers[0]!.apiKey).toBe('sk-abcd1234');
    const cfg = await svc.updateProvider('id1', { apiKey: 'sk-new' }, actor);
    expect(cfg.models.map((m) => m.modelKey)).toEqual(['gpt-4o-mini', 'gpt-4.1']);
    expect((await repo.load()).providers[0]!.apiKey).toBe('sk-new');
  });

  it('notes a refresh that fails and still reports it', async () => {
    const answer = { ok: true };
    const fetchImpl = vi.fn(async () => (answer.ok ? json({ data: [{ id: 'gpt-4o-mini' }] }) : json({ error: 'busy' }, 503)));
    const { svc } = make(fetchImpl as unknown as typeof fetch);
    await svc.addProvider(openai, actor);
    answer.ok = false;
    await expect(svc.syncProvider('id1', actor)).rejects.toThrow(/HTTP 503/);
    const cfg = await svc.getConfig();
    expect(cfg.providers[0]!.lastSyncError).toMatch(/HTTP 503/);
    expect(cfg.models[0]!.available).toBe(true); // nothing changed
  });
});

describe('AiConfigService: daily refresh', () => {
  it('refreshes the switched-on providers whose list is more than a day old', async () => {
    const clock = { now: '2026-09-08T00:00:00.000Z' };
    const fetchImpl = provider(['gpt-4o-mini']);
    const { svc } = make(fetchImpl as unknown as typeof fetch, clock);
    await svc.addProvider(openai, actor); // id1, loaded at 00:00
    await svc.addProvider({ ...openai, name: 'Off' }, actor); // id2, switched off below
    await svc.updateProvider('id2', { enabled: false }, actor);
    clock.now = '2026-09-08T20:00:00.000Z';
    await svc.addProvider({ ...openai, name: 'Recent' }, actor); // id3, loaded at 20:00
    fetchImpl.mockClear();

    clock.now = '2026-09-09T01:00:00.000Z'; // 25 h after the first, 5 h after the last
    expect(await svc.refreshDueProviders()).toEqual({ refreshed: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const cfg = await svc.getConfig();
    expect(cfg.providers.find((p) => p.id === 'id1')!.lastSyncedAt).toBe('2026-09-09T01:00:00.000Z');
    expect(await svc.refreshDueProviders()).toEqual({ refreshed: 0, failed: 0 }); // nothing due any more
  });

  it('counts a provider that fails and carries on', async () => {
    const clock = { now: '2026-09-08T00:00:00.000Z' };
    const answer = { ok: true };
    const fetchImpl = vi.fn(async () => (answer.ok ? json({ data: [] }) : json({ error: 'down' }, 500)));
    const { svc } = make(fetchImpl as unknown as typeof fetch, clock);
    await svc.addProvider(openai, actor);
    answer.ok = false;
    clock.now = '2026-09-10T00:00:00.000Z';
    expect(await svc.refreshDueProviders()).toEqual({ refreshed: 0, failed: 1 });
    expect((await svc.getConfig()).providers[0]!.lastSyncError).toMatch(/HTTP 500/);
  });
});

describe('AiConfigService: testing a model', () => {
  it('says the model works and how long it took', async () => {
    const { svc } = make(provider(['gpt-4o-mini']) as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    const res = await svc.testModel(cfg.models[0]!.id);
    expect(res).toMatchObject({ ok: true, reply: 'OK' });
    expect(typeof (res as { ms: number }).ms).toBe('number');
  });

  it('works for a model that is switched off, so it can be tried before it is used', async () => {
    const { svc } = make(provider(['gpt-4o-mini', 'gpt-4o']) as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    const off = cfg.models.find((m) => !m.enabled)!;
    expect((await svc.testModel(off.id)).ok).toBe(true);
  });

  it('shows the provider’s own reason when the model fails', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/chat/completions') ? json({ error: { message: 'You exceeded your current quota.' } }, 429) : json({ data: [{ id: 'gpt-4o-mini' }] }),
    );
    const { svc } = make(fetchImpl as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    expect(await svc.testModel(cfg.models[0]!.id)).toEqual({ ok: false, message: 'HTTP 429: You exceeded your current quota.' });
  });

  it('waits up to 2 minutes, as the features do (a model may be loading cold)', async () => {
    const { svc } = make(provider(['gpt-4o-mini']) as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    const waits: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      waits.push(ms);
      return real(ms);
    });
    try {
      await svc.testModel(cfg.models[0]!.id);
      expect(waits).toEqual([120_000]);
    } finally {
      spy.mockRestore();
    }
  });

  it('only tests chat models', async () => {
    const { svc } = make(provider(['text-embedding-3-small']) as unknown as typeof fetch);
    const cfg = await svc.addProvider(openai, actor);
    await expect(svc.testModel(cfg.models[0]!.id)).rejects.toThrow(/chat models/);
    await expect(svc.testModel('nope')).rejects.toThrow(/not found/);
  });
});
