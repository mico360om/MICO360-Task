import { describe, it, expect } from 'vitest';
import {
  emptyConfig,
  addProvider,
  updateProvider,
  removeProvider,
  addModel,
  updateModel,
  setDefault,
  applySync,
  usableModels,
  resolveDefaultModel,
  effectiveModel,
  automaticModels,
  recordSyncFailure,
  redactConfig,
} from './ai-config.js';
import { ValidationError, NotFoundError } from '../../lib/http-errors.js';

const meta = (id: string) => ({ id, now: '2026-09-08T00:00:00.000Z' });

function seed() {
  let cfg = emptyConfig();
  const p = addProvider(cfg, { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-key-1234' }, meta('p1'));
  cfg = p.config;
  const m = addModel(cfg, { providerId: 'p1', modelKey: 'gpt-4o', capabilities: ['chat', 'vision'] }, meta('m1'));
  cfg = m.config;
  return cfg;
}

describe('ai-config: providers', () => {
  it('adds a provider (URL trimmed, defaults enabled)', () => {
    const { provider, config } = addProvider(emptyConfig(), { name: ' OpenAI ', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1/' }, meta('p1'));
    expect(provider.name).toBe('OpenAI');
    expect(provider.apiBaseUrl).toBe('https://api.openai.com/v1');
    expect(provider.enabled).toBe(true);
    expect(config.providers).toHaveLength(1);
  });

  it('rejects an invalid URL or kind', () => {
    expect(() => addProvider(emptyConfig(), { name: 'x', kind: 'openai', apiBaseUrl: 'ftp://x' }, meta('p'))).toThrow(ValidationError);
    // @ts-expect-error invalid kind
    expect(() => addProvider(emptyConfig(), { name: 'x', kind: 'nope', apiBaseUrl: 'https://x' }, meta('p'))).toThrow(ValidationError);
  });

  it('refuses internal / private provider hosts unless explicitly allowed (SSRF)', () => {
    for (const url of ['http://localhost:11434', 'http://127.0.0.1:3306', 'http://169.254.169.254/latest', 'http://10.0.0.5', 'http://[::1]:8080', 'http://mysql:3306', 'http://admin.internal']) {
      expect(() => addProvider(emptyConfig(), { name: 'x', kind: 'custom', apiBaseUrl: url }, meta('p'))).toThrow(ValidationError);
    }
    const local = addProvider(emptyConfig(), { name: 'Ollama', kind: 'ollama', apiBaseUrl: 'http://localhost:11434' }, meta('p'), { allowPrivateHosts: true });
    expect(local.provider.apiBaseUrl).toBe('http://localhost:11434');
  });

  it('refuses credentials embedded in the URL', () => {
    expect(() => addProvider(emptyConfig(), { name: 'x', kind: 'openai', apiBaseUrl: 'https://user:pw@api.openai.com/v1' }, meta('p'))).toThrow(ValidationError);
  });

  it('validates the URL on update too (editing used to skip the check)', () => {
    const cfg = seed();
    expect(() => updateProvider(cfg, 'p1', { apiBaseUrl: 'ftp://x' }, 'now')).toThrow(ValidationError);
    expect(() => updateProvider(cfg, 'p1', { apiBaseUrl: 'http://169.254.169.254' }, 'now')).toThrow(ValidationError);
    expect(updateProvider(cfg, 'p1', { apiBaseUrl: 'https://api.openai.com/v2/' }, 'now').providers[0]!.apiBaseUrl).toBe('https://api.openai.com/v2');
  });

  it('updateProvider only overwrites the API key when a non-empty one is given', () => {
    let cfg = seed();
    cfg = updateProvider(cfg, 'p1', { apiKey: '' }, 'now'); // blank must NOT wipe the key
    expect(cfg.providers[0]!.apiKey).toBe('sk-secret-key-1234');
    cfg = updateProvider(cfg, 'p1', { apiKey: 'sk-new-9999' }, 'now');
    expect(cfg.providers[0]!.apiKey).toBe('sk-new-9999');
  });

  it('removeProvider cascades to its models and clears defaults', () => {
    let cfg = seed();
    cfg = setDefault(cfg, 'chat', 'm1', 'now');
    cfg = removeProvider(cfg, 'p1');
    expect(cfg.providers).toHaveLength(0);
    expect(cfg.models).toHaveLength(0);
    expect(cfg.defaults.chat).toBeNull();
  });
});

describe('ai-config: models', () => {
  it('adds a model with capabilities + defaults', () => {
    const cfg = seed();
    const m = cfg.models[0]!;
    expect(m.modelKey).toBe('gpt-4o');
    expect(m.displayName).toBe('gpt-4o');
    expect(m.capabilities).toEqual(['chat', 'vision']);
    expect(m.concurrencyLimit).toBe(4);
    expect(m.enabled).toBe(true);
  });

  it('rejects an unknown capability + duplicate model', () => {
    const cfg = seed();
    // @ts-expect-error bad capability
    expect(() => addModel(cfg, { providerId: 'p1', modelKey: 'x', capabilities: ['telepathy'] }, meta('m'))).toThrow(ValidationError);
    expect(() => addModel(cfg, { providerId: 'p1', modelKey: 'gpt-4o', capabilities: ['chat'] }, meta('m2'))).toThrow(ValidationError);
  });

  it('clamps concurrency and normalizes parameters', () => {
    let cfg = seed();
    cfg = updateModel(cfg, 'm1', { concurrencyLimit: 999, parameters: { temperature: 5, topP: 3, maxTokens: 100.7 } }, 'now');
    const m = cfg.models[0]!;
    expect(m.concurrencyLimit).toBe(64);
    expect(m.parameters.temperature).toBe(2);
    expect(m.parameters.topP).toBe(1);
    expect(m.parameters.maxTokens).toBe(101);
  });

  it('throws NotFound for a missing model', () => {
    expect(() => updateModel(seed(), 'nope', { enabled: false }, 'now')).toThrow(NotFoundError);
  });
});

describe('ai-config: defaults', () => {
  it('sets a default only for a supported, enabled model', () => {
    let cfg = seed();
    cfg = setDefault(cfg, 'chat', 'm1', 'now');
    expect(cfg.defaults.chat).toBe('m1');
    expect(() => setDefault(cfg, 'ocr', 'm1', 'now')).toThrow(ValidationError); // m1 has no ocr capability
  });

  it('refuses a disabled model as default and drops the default when disabled', () => {
    let cfg = seed();
    cfg = setDefault(cfg, 'chat', 'm1', 'now');
    cfg = updateModel(cfg, 'm1', { enabled: false }, 'now'); // disabling clears the default
    expect(cfg.defaults.chat).toBeNull();
    expect(() => setDefault(cfg, 'chat', 'm1', 'now')).toThrow(ValidationError);
  });
});

describe('ai-config: usable models (hide disabled/unavailable)', () => {
  it('excludes disabled, unavailable, or disabled-provider models', () => {
    let cfg = seed();
    // add a second, disabled model + a third that is unavailable
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'gpt-3.5', capabilities: ['chat'], enabled: false }, meta('m2')).config;
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'ghost', capabilities: ['chat'], available: false }, meta('m3')).config;
    expect(usableModels(cfg, 'chat').map((m) => m.id)).toEqual(['m1']);

    // disabling the provider hides all its models
    cfg = updateProvider(cfg, 'p1', { enabled: false }, 'now');
    expect(usableModels(cfg)).toHaveLength(0);
  });

  it('resolveDefaultModel returns null once the default becomes unavailable', () => {
    let cfg = seed();
    cfg = setDefault(cfg, 'chat', 'm1', 'now');
    expect(resolveDefaultModel(cfg, 'chat')?.id).toBe('m1');
    cfg = applySync(cfg, 'p1', [], meta('s')); // gpt-4o no longer offered → unavailable
    expect(resolveDefaultModel(cfg, 'chat')).toBeNull();
  });
});

describe('ai-config: sync', () => {
  it('marks known models available/unavailable and auto-adds new ones (disabled)', () => {
    let cfg = seed();
    cfg = applySync(cfg, 'p1', ['gpt-4o', 'o1-mini'], meta('s'));
    const byKey = Object.fromEntries(cfg.models.map((m) => [m.modelKey, m]));
    expect(byKey['gpt-4o']!.available).toBe(true);
    expect(byKey['o1-mini']).toBeDefined();
    expect(byKey['o1-mini']!.enabled).toBe(false); // newly detected = disabled until an admin enables it
    expect(byKey['o1-mini']!.available).toBe(true);
  });

  it('adds new models with what the provider says about them, or a readable name and the likely capabilities', () => {
    let cfg = seed();
    cfg = applySync(cfg, 'p1', [{ key: 'claude-x', displayName: 'Claude X', capabilities: ['chat'], created: 100 }, 'text-embedding-3-small'], meta('s'));
    const byKey = Object.fromEntries(cfg.models.map((m) => [m.modelKey, m]));
    expect(byKey['claude-x']).toMatchObject({ displayName: 'Claude X', capabilities: ['chat'], created: 100, enabled: false });
    expect(byKey['text-embedding-3-small']).toMatchObject({ displayName: 'Text embedding 3 small', capabilities: ['embedding'] });
  });

  it('gives a known model the name the provider sends, unless an admin renamed it', () => {
    let cfg = seed();
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'gpt-4.1', displayName: 'Our house model', capabilities: ['chat'] }, meta('m2')).config;
    cfg = applySync(cfg, 'p1', [{ key: 'gpt-4o', displayName: 'GPT-4o' }, { key: 'gpt-4.1', displayName: 'GPT-4.1' }], meta('s'));
    const byKey = Object.fromEntries(cfg.models.map((m) => [m.modelKey, m]));
    expect(byKey['gpt-4o']!.displayName).toBe('GPT-4o');
    expect(byKey['gpt-4.1']!.displayName).toBe('Our house model');
  });

  it('notes when the list was loaded and clears an earlier problem', () => {
    let cfg = seed();
    cfg = recordSyncFailure(cfg, 'p1', 'Could not reach the AI provider.', '2026-09-08T01:00:00.000Z');
    expect(cfg.providers[0]).toMatchObject({ lastSyncError: 'Could not reach the AI provider.', lastSyncAttemptAt: '2026-09-08T01:00:00.000Z' });
    expect(cfg.models[0]!.available).toBe(true); // a failed check changes no model
    cfg = applySync(cfg, 'p1', ['gpt-4o'], { id: 's', now: '2026-09-08T02:00:00.000Z' });
    expect(cfg.providers[0]).toMatchObject({ lastSyncError: null, lastSyncedAt: '2026-09-08T02:00:00.000Z', lastSyncAttemptAt: '2026-09-08T02:00:00.000Z' });
  });

  it('switches on the recommended chat model the first time a provider list is loaded', () => {
    let cfg = addProvider(emptyConfig(), { name: 'Anthropic', kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'k' }, meta('p1')).config;
    cfg = applySync(
      cfg,
      'p1',
      [
        { key: 'claude-opus-4-1-20250805', created: 3 },
        { key: 'claude-haiku-4-5-20251001', created: 5 },
        { key: 'claude-sonnet-4-5-20250929', created: 4 },
      ],
      meta('s'),
    );
    expect(cfg.models.filter((m) => m.enabled).map((m) => m.modelKey)).toEqual(['claude-haiku-4-5-20251001']);
  });

  it('never changes on/off choices after that', () => {
    let cfg = addProvider(emptyConfig(), { name: 'Anthropic', kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'k' }, meta('p1')).config;
    cfg = applySync(cfg, 'p1', ['claude-haiku-4-5'], meta('s1'));
    cfg = updateModel(cfg, cfg.models[0]!.id, { enabled: false }, 'now'); // the admin switches everything off
    cfg = applySync(cfg, 'p1', ['claude-haiku-4-5', 'claude-sonnet-4-5'], meta('s2'));
    expect(cfg.models.filter((m) => m.enabled)).toHaveLength(0);
  });
});

describe('ai-config: automatic model choice', () => {
  function threeModels() {
    let cfg = addProvider(emptyConfig(), { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, meta('p1')).config;
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'gpt-4o', capabilities: ['chat', 'vision'] }, meta('big')).config;
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'gpt-4o-mini', capabilities: ['chat', 'vision'] }, meta('mini')).config;
    cfg = addModel(cfg, { providerId: 'p1', modelKey: 'text-embedding-3-small', capabilities: ['embedding'] }, meta('emb')).config;
    return cfg;
  }

  it('picks the recommended usable model for each capability', () => {
    expect(automaticModels(threeModels())).toEqual({ chat: 'mini', vision: 'mini', ocr: null, document: null, embedding: 'emb' });
  });

  it('uses the chosen default while it is usable, and the automatic choice otherwise', () => {
    let cfg = threeModels();
    expect(effectiveModel(cfg, 'chat')?.id).toBe('mini'); // nothing chosen: automatic
    cfg = setDefault(cfg, 'chat', 'big', 'now');
    expect(effectiveModel(cfg, 'chat')?.id).toBe('big');
    cfg = applySync(cfg, 'p1', ['gpt-4o-mini', 'text-embedding-3-small'], meta('s')); // gpt-4o is gone
    expect(effectiveModel(cfg, 'chat')?.id).toBe('mini');
    cfg = updateModel(cfg, 'mini', { enabled: false }, 'now');
    expect(effectiveModel(cfg, 'chat')).toBeNull();
  });

  it('shows admins the automatic choice and each provider recommended chat model', () => {
    const r = redactConfig(threeModels());
    expect(r.automatic.chat).toBe('mini');
    expect(r.providers[0]!.recommendedModelId).toBe('mini');
  });
});

describe('ai-config: provider presets', () => {
  it('keeps which preset a provider came from, and refuses an unknown one', () => {
    const { provider } = addProvider(emptyConfig(), { name: 'Groq', kind: 'custom', preset: 'groq', apiBaseUrl: 'https://api.groq.com/openai/v1' }, meta('p1'));
    expect(provider.preset).toBe('groq');
    expect(() => addProvider(emptyConfig(), { name: 'X', kind: 'custom', preset: 'nope' as never, apiBaseUrl: 'https://x.test' }, meta('p2'))).toThrow(ValidationError);
  });

  it('knows MICO360 AI (the company’s own OpenAI-compatible platform)', () => {
    const { provider } = addProvider(emptyConfig(), { name: 'MICO360 AI', kind: 'custom', preset: 'mico360', apiBaseUrl: 'http://ai.mico360.com:5310/v1' }, meta('p1'));
    expect(provider.preset).toBe('mico360');
  });
});

describe('ai-config: redaction', () => {
  it('never returns the raw API key', () => {
    const r = redactConfig(seed());
    const p = r.providers[0]!;
    expect('apiKey' in p).toBe(false);
    expect(p.hasApiKey).toBe(true);
    expect(p.apiKeyHint).toBe('…1234');
  });
});
