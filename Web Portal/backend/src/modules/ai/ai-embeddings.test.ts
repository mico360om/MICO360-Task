import { describe, it, expect } from 'vitest';
import { cosine, embedTexts, fromVector, toVector } from './ai-embeddings';
import type { ChatModel } from './ai-completion';

const capture = (reply: unknown) => {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

describe('embedTexts', () => {
  it('OpenAI: /embeddings with the texts, asking text-embedding-3 models for 256 numbers', async () => {
    const { calls, fetchImpl } = capture({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, modelKey: 'text-embedding-3-small' };
    expect(await embedTexts(model, ['pump', 'valve'], fetchImpl)).toEqual([[1, 0], [0, 1]]);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(calls[0]!.body).toEqual({ model: 'text-embedding-3-small', input: ['pump', 'valve'], dimensions: 256 });
    expect(calls[0]!.headers.Authorization).toBe('Bearer k');
  });

  it('OpenAI-compatible services (MICO360 AI): the same call, without asking a size', async () => {
    const { calls, fetchImpl } = capture({ data: [{ embedding: [0.5, 0.5] }] });
    await embedTexts({ provider: { kind: 'custom', apiBaseUrl: 'https://ai.example.com/v1', apiKey: 'k', preset: 'mico360' }, modelKey: 'bge-m3' }, ['x'], fetchImpl);
    expect(calls[0]!.body).toEqual({ model: 'bge-m3', input: ['x'] });
  });

  it('Ollama: /api/embed', async () => {
    const { calls, fetchImpl } = capture({ embeddings: [[0.1, 0.2]] });
    expect(await embedTexts({ provider: { kind: 'ollama', apiBaseUrl: 'http://localhost:11434', apiKey: '' }, modelKey: 'nomic-embed-text' }, ['x'], fetchImpl, { allowPrivateHosts: true })).toEqual([[0.1, 0.2]]);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/embed');
  });

  it('refuses a provider without embeddings (Anthropic) and an answer of the wrong shape', async () => {
    const { fetchImpl } = capture({});
    await expect(embedTexts({ provider: { kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'a' }, modelKey: 'x' }, ['x'], fetchImpl)).rejects.toThrow(/embedding/i);
    await expect(embedTexts({ provider: { kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, modelKey: 'text-embedding-3-small' }, ['a', 'b'], capture({ data: [{ embedding: [1] }] }).fetchImpl)).rejects.toThrow();
  });
});

describe('vectors', () => {
  it('pack as float32 and back; cosine of unit and opposite vectors', () => {
    const v = [0.25, -1, 3.5];
    expect(fromVector(toVector(v))).toEqual(v);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
