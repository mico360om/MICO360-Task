import { describe, it, expect } from 'vitest';
import {
  friendlyModelName,
  inferCapabilities,
  isReasoningModel,
  isUsableModelKey,
  pickRecommended,
  type RankedModel,
} from './ai-model-catalog';

describe('isUsableModelKey: only text and embedding models are listed', () => {
  it.each([
    'dall-e-3', 'gpt-image-1', 'whisper-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-audio-preview', 'gpt-realtime',
    'gpt-4o-transcribe', 'omni-moderation-latest', 'text-moderation-latest', 'sora-2', 'davinci-002', 'babbage-002',
    'computer-use-preview', 'imagen-3.0-generate-002', 'gemini-2.0-flash-preview-image-generation', 'veo-3.0-generate-preview',
    'meta-llama/llama-guard-4-12b', 'playai-tts',
  ])('leaves out %s', (key) => {
    expect(isUsableModelKey('custom', key)).toBe(false);
  });

  it.each(['gpt-4o-mini', 'gpt-5', 'o3-mini', 'claude-haiku-4-5-20251001', 'gemini-2.5-flash', 'text-embedding-3-small', 'llama3.1:latest', 'gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct'])(
    'keeps %s',
    (key) => {
      expect(isUsableModelKey('custom', key)).toBe(true);
    },
  );

  it('leaves out OpenAI models its chat endpoint cannot run (Responses-only, completions-only)', () => {
    for (const key of ['o1-pro', 'o3-pro-2025-06-10', 'gpt-5-pro', 'gpt-5-codex', 'codex-mini-latest', 'o3-deep-research', 'gpt-3.5-turbo-instruct']) {
      expect(isUsableModelKey('openai', key)).toBe(false);
    }
    // The same words are fine elsewhere: Gemini Pro and open "-instruct" models are chat models.
    expect(isUsableModelKey('custom', 'gemini-2.5-pro')).toBe(true);
    expect(isUsableModelKey('custom', 'llama-3.1-8b-instruct')).toBe(true);
  });
});

describe('inferCapabilities', () => {
  it('marks embedding models as embeddings only', () => {
    expect(inferCapabilities('text-embedding-3-small')).toEqual(['embedding']);
    expect(inferCapabilities('nomic-embed-text:latest')).toEqual(['embedding']);
    expect(inferCapabilities('models/gemini-embedding-001')).toEqual(['embedding']);
  });

  it('gives models that read images vision, OCR and document processing as well as chat', () => {
    for (const key of ['gpt-4o-mini', 'gpt-4.1', 'gpt-5-mini', 'o3', 'claude-sonnet-4-5-20250929', 'claude-3-haiku-20240307', 'gemini-2.5-flash', 'llava:13b', 'llama3.2-vision:latest', 'qwen2.5vl:7b', 'gemma3:4b']) {
      expect(inferCapabilities(key), key).toEqual(['chat', 'vision', 'ocr', 'document']);
    }
  });

  it('gives text-only models chat', () => {
    for (const key of ['o3-mini', 'o1-mini', 'gpt-3.5-turbo', 'llama3.1:latest', 'deepseek-chat', 'mistral-small-latest']) {
      expect(inferCapabilities(key), key).toEqual(['chat']);
    }
  });
});

describe('friendlyModelName', () => {
  it.each([
    ['gpt-4o-mini', 'GPT-4o mini'],
    ['gpt-4.1', 'GPT-4.1'],
    ['gpt-5-nano', 'GPT-5 nano'],
    ['gpt-4o-2024-08-06', 'GPT-4o (2024-08-06)'],
    ['chatgpt-4o-latest', 'ChatGPT-4o latest'],
    ['o3-mini', 'o3-mini'],
    ['text-embedding-3-small', 'Text embedding 3 small'],
    ['llama3.1:latest', 'Llama3.1'],
    ['qwen2.5:7b', 'Qwen2.5 7B'],
    ['gemini-2.5-flash', 'Gemini 2.5 flash'],
    ['deepseek-chat', 'DeepSeek chat'],
    ['claude-3-5-haiku-20241022', 'Claude 3.5 haiku (20241022)'],
    ['claude-haiku-4-5', 'Claude haiku 4.5'],
  ])('%s → %s', (key, name) => {
    expect(friendlyModelName(key)).toBe(name);
  });
});

describe('isReasoningModel', () => {
  it('knows the OpenAI reasoning families', () => {
    for (const key of ['o1', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5.1', 'openai/gpt-5-mini']) expect(isReasoningModel(key), key).toBe(true);
    for (const key of ['gpt-4o', 'gpt-4.1-mini', 'gpt-5-chat-latest', 'claude-sonnet-4-5', 'llama3.1:latest']) expect(isReasoningModel(key), key).toBe(false);
  });
});

describe('pickRecommended', () => {
  const m = (id: string, created?: number, capabilities: RankedModel['capabilities'] = inferCapabilities(id)): RankedModel => ({ id, modelKey: id, capabilities, created });

  it('prefers a fast general chat model, newest first', () => {
    const models = [m('claude-opus-4-1-20250805', 3), m('claude-sonnet-4-5-20250929', 4), m('claude-3-haiku-20240307', 1), m('claude-haiku-4-5-20251001', 5)];
    expect(pickRecommended(models, 'chat')).toBe('claude-haiku-4-5-20251001');
  });

  it('picks the plain name over dated snapshots and previews, and a quick model over a reasoning one', () => {
    const models = [
      m('gpt-4o-mini-2024-07-18', 10),
      m('gpt-4o-mini-search-preview', 12),
      m('gpt-4o-mini', 9),
      m('gpt-4.1-mini', 11),
      m('gpt-5-mini', 13),
      m('gpt-5', 14),
      m('o3-mini', 8),
    ];
    expect(pickRecommended(models, 'chat')).toBe('gpt-4.1-mini');
    // With only reasoning models left, one of them is still picked.
    expect(pickRecommended([m('gpt-5', 14), m('gpt-5-mini', 13)], 'chat')).toBe('gpt-5-mini');
  });

  it('compares version numbers when the provider gives no dates', () => {
    expect(pickRecommended([m('gemini-1.5-flash'), m('gemini-2.5-flash'), m('gemini-2.0-flash')], 'chat')).toBe('gemini-2.5-flash');
  });

  it('falls back to any model with the capability', () => {
    expect(pickRecommended([m('my-house-model')], 'chat')).toBe('my-house-model');
    expect(pickRecommended([m('text-embedding-3-large'), m('text-embedding-3-small'), m('gpt-4o')], 'embedding')).toBe('text-embedding-3-small');
    expect(pickRecommended([m('gpt-4o')], 'embedding')).toBeNull();
    expect(pickRecommended([], 'chat')).toBeNull();
  });
});
