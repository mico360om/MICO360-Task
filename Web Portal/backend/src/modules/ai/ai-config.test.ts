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
