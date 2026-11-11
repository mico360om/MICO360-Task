import { describe, it, expect } from 'vitest';
import { addProvider, applyPlatform, applySync, automaticModels, emptyConfig, recordOcrFallback, recordStrictJsonRefusal, recordSubstitution, redactConfig, strictJsonPaused, STRICT_JSON_PAUSE_MS, type AiConfig } from './ai-config';

const meta = (id: string, now = '2026-11-11T08:00:00.000Z') => ({ id, now });
const mico = (): AiConfig => addProvider(emptyConfig(), { name: 'MICO360 AI', kind: 'custom', preset: 'mico360', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_k' }, meta('p1')).config;

describe('b14: MICO360 AI’s `created` is the time of the request, not of the model', () => {
  it('is not kept from its list, so it never decides what “Automatic” picks', () => {
    let cfg = mico();
    cfg = applySync(cfg, 'p1', [{ key: 'qwen2.5:0.5b', created: 1_800_000_000 }, { key: 'llama3.1:latest', created: 1_700_000_000 }], meta('s1'));
    expect(cfg.models.every((m) => m.created === undefined)).toBe(true);
  });

  it('a model listed later is not preferred over an equal one listed earlier', () => {
    let cfg = mico();
    // The bigger model is listed first; the smaller one appears a day later — with a later "created".
    cfg = applySync(cfg, 'p1', [{ key: 'qwen2.5:14b', created: 1_700_000_000 }], meta('s1'));
    cfg = applySync(cfg, 'p1', [{ key: 'qwen2.5:14b', created: 1_800_000_000 }, { key: 'qwen2.5:7b', created: 1_800_000_000 }], meta('s2', '2026-11-12T08:00:00.000Z'));
    cfg = { ...cfg, models: cfg.models.map((m) => ({ ...m, enabled: true })) };
    const auto = automaticModels(cfg).chat;
    // Ranked by the version in the name (14b > 7b), never by when the list was asked for.
    expect(cfg.models.find((m) => m.id === auto)!.modelKey).toBe('qwen2.5:14b');
  });

  it('a `created` saved before this release is ignored too (and dropped at the next list)', () => {
    let cfg = mico();
    cfg = applySync(cfg, 'p1', ['llama3.1:8b', 'llama3.1:70b'], meta('s1'));
    // As an older release saved them: the newer request time on the smaller model.
    cfg = { ...cfg, models: cfg.models.map((m) => ({ ...m, enabled: true, created: m.modelKey === 'llama3.1:8b' ? 1_900_000_000 : 1_700_000_000 })) };
    expect(cfg.models.find((m) => m.id === automaticModels(cfg).chat)!.modelKey).toBe('llama3.1:70b');
    cfg = applySync(cfg, 'p1', ['llama3.1:8b', 'llama3.1:70b'], meta('s2'));
    expect(cfg.models.every((m) => m.created === undefined)).toBe(true);
  });

  it('other providers keep `created` (a real release date) as before', () => {
    let cfg = addProvider(emptyConfig(), { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, meta('p2')).config;
    cfg = applySync(cfg, 'p2', [{ key: 'gpt-4o', created: 1_700_000_000 }], meta('s'));
    expect(cfg.models[0]!.created).toBe(1_700_000_000);
  });
});

describe('platform facts on the provider (b4, b5, b7, b11, b12)', () => {
  it('keeps the Connect version, the fleet’s capabilities and the key’s concurrency, as of when they were read', () => {
    const cfg = applyPlatform(mico(), 'p1', { version: '2.6.28', commit: '0383615', capabilities: ['Chat', 'Embedding'], concurrencyLimit: 6 }, '2026-11-11T08:00:00.000Z');
    expect(cfg.providers[0]!.platform).toEqual({ version: '2.6.28', commit: '0383615', capabilities: ['Chat', 'Embedding'], concurrencyLimit: 6, checkedAt: '2026-11-11T08:00:00.000Z' });
  });

  it('a fact that could not be read keeps the last one known; notes and substitutions stay', () => {
    let cfg = applyPlatform(mico(), 'p1', { version: '2.6.28', commit: null, capabilities: ['Chat', 'Vision', 'Embedding', 'Ocr'], concurrencyLimit: 4 }, '2026-11-11T08:00:00.000Z');
    cfg = recordSubstitution(cfg, 'p1', { asked: 'llama3.1:latest', answered: 'qwen2.5:0.5b' }, '2026-11-11T09:00:00.000Z');
    cfg = recordOcrFallback(cfg, 'p1', { status: 403, reason: "This API key may not use the 'Ocr' capability." }, '2026-11-11T09:30:00.000Z');
    cfg = applyPlatform(cfg, 'p1', { version: null, commit: null, capabilities: null, concurrencyLimit: null }, '2026-11-12T08:00:00.000Z');
    expect(cfg.providers[0]!.platform).toMatchObject({ version: '2.6.28', capabilities: ['Chat', 'Vision', 'Embedding', 'Ocr'], concurrencyLimit: 4, checkedAt: '2026-11-12T08:00:00.000Z' });
    expect(cfg.providers[0]!.platform!.substitutions).toHaveLength(1);
    expect(cfg.providers[0]!.platform!.ocrFallback).toMatchObject({ status: 403 });
  });

  it('b5: a substitution is logged once per pair, counted, newest first, at most 10', () => {
    let cfg = mico();
    cfg = recordSubstitution(cfg, 'p1', { asked: 'a', answered: 'b' }, '2026-11-11T08:00:00.000Z');
    cfg = recordSubstitution(cfg, 'p1', { asked: 'a', answered: 'b' }, '2026-11-11T09:00:00.000Z');
    expect(cfg.providers[0]!.platform!.substitutions).toEqual([{ asked: 'a', answered: 'b', count: 2, firstAt: '2026-11-11T08:00:00.000Z', at: '2026-11-11T09:00:00.000Z' }]);
    for (let i = 0; i < 12; i++) cfg = recordSubstitution(cfg, 'p1', { asked: `m${i}`, answered: 'b' }, `2026-11-12T08:${String(i).padStart(2, '0')}:00.000Z`);
    const subs = cfg.providers[0]!.platform!.substitutions!;
    expect(subs).toHaveLength(10);
    expect(subs[0]!.asked).toBe('m11');
  });

  it('b4: the OCR fallback note is kept until whole-document reading works again', () => {
    let cfg = recordOcrFallback(mico(), 'p1', { status: 503, reason: "No connected node provides the 'Ocr' capability." }, '2026-11-11T08:00:00.000Z');
    expect(cfg.providers[0]!.platform!.ocrFallback).toEqual({ status: 503, reason: "No connected node provides the 'Ocr' capability.", at: '2026-11-11T08:00:00.000Z' });
    cfg = recordOcrFallback(cfg, 'p1', null, '2026-11-11T09:00:00.000Z');
    expect(cfg.providers[0]!.platform!.ocrFallback).toBeNull();
  });

  it('admins see the facts; no key is in them', () => {
    const cfg = applyPlatform(mico(), 'p1', { version: '2.6.28', commit: null, capabilities: ['Chat'], concurrencyLimit: 4 }, '2026-11-11T08:00:00.000Z');
    const out = redactConfig(cfg);
    expect(out.providers[0]!.platform).toMatchObject({ version: '2.6.28', capabilities: ['Chat'] });
    expect(JSON.stringify(out)).not.toContain('mico_k');
  });
});

describe('safety net: strict answer shapes refused by the Connect', () => {
  const refusal = { status: 400, reason: 'response_format json_schema is not supported.' };

  it('is remembered on the provider (status, reason, when), and shown to admins', () => {
    const cfg = recordStrictJsonRefusal(mico(), 'p1', refusal, '2026-11-11T08:00:00.000Z');
    expect(cfg.providers[0]!.platform!.strictJsonRefused).toEqual({ status: 400, reason: 'response_format json_schema is not supported.', at: '2026-11-11T08:00:00.000Z' });
    expect(redactConfig(cfg).providers[0]!.platform!.strictJsonRefused).toMatchObject({ status: 400 });
  });

  it('pauses strict shapes for 24 hours, then they are tried again', () => {
    const p = recordStrictJsonRefusal(mico(), 'p1', refusal, '2026-11-11T08:00:00.000Z').providers[0]!;
    expect(STRICT_JSON_PAUSE_MS).toBe(24 * 60 * 60 * 1000);
    expect(strictJsonPaused(p, Date.parse('2026-11-11T08:00:01.000Z'))).toBe(true);
    expect(strictJsonPaused(p, Date.parse('2026-11-12T07:59:59.000Z'))).toBe(true);
    expect(strictJsonPaused(p, Date.parse('2026-11-12T08:00:00.000Z'))).toBe(false);
    expect(strictJsonPaused(mico().providers[0]!, Date.parse('2026-11-11T08:00:01.000Z'))).toBe(false);
  });

  it('is forgotten at the next model refresh (the Connect may have been updated)', () => {
    let cfg = recordStrictJsonRefusal(mico(), 'p1', refusal, '2026-11-11T08:00:00.000Z');
    cfg = applyPlatform(cfg, 'p1', { version: '2.6.29', commit: null, capabilities: ['Chat'], concurrencyLimit: 4 }, '2026-11-11T09:00:00.000Z');
    expect(cfg.providers[0]!.platform!.strictJsonRefused ?? null).toBeNull();
    expect(strictJsonPaused(cfg.providers[0]!, Date.parse('2026-11-11T09:00:01.000Z'))).toBe(false);
  });

  it('the reason is kept short', () => {
    const cfg = recordStrictJsonRefusal(mico(), 'p1', { status: 422, reason: 'x'.repeat(1000) }, '2026-11-11T08:00:00.000Z');
    expect(cfg.providers[0]!.platform!.strictJsonRefused!.reason).toHaveLength(300);
  });
});
