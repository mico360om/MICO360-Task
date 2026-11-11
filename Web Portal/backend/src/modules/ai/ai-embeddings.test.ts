import { describe, it, expect } from 'vitest';
import { cosine, embedTexts, EmbeddingModelChangedError, fromVector, toVector } from './ai-embeddings';
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

  // MICO360 AI's guide (§5, §11): at most 64 texts a request, 8,000 characters each, 32,000 together.
  describe('within the embedding limits', () => {
    /** Answers each call with one vector per text: [the text's length, its batch number]. */
    const perText = () => {
      const calls: string[][] = [];
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        const input = JSON.parse(String(init!.body)).input as string[];
        calls.push(input);
        return new Response(JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: [t.length, calls.length] })) }), { status: 200 });
      }) as unknown as typeof fetch;
      return { calls, fetchImpl };
    };
    const mico: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'k', preset: 'mico360' }, modelKey: 'nomic-embed-text:latest' };
    const total = (input: string[]) => input.reduce((n, t) => n + t.length, 0);

    it('splits texts that would pass 32,000 characters together into several calls, answers in order', async () => {
      const { calls, fetchImpl } = perText();
      // Each a different length, so a vector out of order would show (review minor 10).
      const texts = Array.from({ length: 25 }, (_, i) => `${i}`.padEnd(1700 + i * 3, 'x'));
      const vectors = await embedTexts(mico, texts, fetchImpl);
      expect(calls.length).toBeGreaterThan(1);
      for (const c of calls) expect(total(c)).toBeLessThanOrEqual(30_000);
      expect(calls.flat()).toEqual(texts);
      expect(vectors).toHaveLength(25);
      expect(vectors.map((v) => v[0])).toEqual(texts.map((t) => t.length));
    });

    it('sends at most 64 texts a call', async () => {
      const { calls, fetchImpl } = perText();
      const vectors = await embedTexts(mico, Array.from({ length: 100 }, (_, i) => `item ${i}`), fetchImpl);
      expect(calls.map((c) => c.length)).toEqual([64, 36]);
      expect(vectors).toHaveLength(100);
    });

    it('cuts a text over 8,000 characters (never inside a character pair)', async () => {
      const { calls, fetchImpl } = perText();
      await embedTexts(mico, ['a'.repeat(12_000), `${'b'.repeat(7_999)}😀tail`], fetchImpl);
      const sent = calls.flat();
      expect(sent[0]).toHaveLength(8_000);
      expect(sent[1]!.length).toBeLessThanOrEqual(8_000);
      expect(sent[1]).toBe('b'.repeat(7_999)); // the emoji's two halves are not split
    });

    // Review I2: a text cut elsewhere (the search sweep's 1,500 characters, a name cut "…") may end on half
    // a character; sent as "\ud83d" a strict JSON reader refuses the whole request, every run.
    it('never sends half a character, whatever the text', async () => {
      const bodies: string[] = [];
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        bodies.push(String(init!.body));
        const input = JSON.parse(String(init!.body)).input as string[];
        return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1] })) }), { status: 200 });
      }) as unknown as typeof fetch;
      await embedTexts(mico, ['pump \ud83d', '\ude00 valve', 'whole 😀 مضخة'], fetchImpl);
      expect(bodies[0]).not.toMatch(/\\ud8[0-9a-f]{2}|\\ude[0-9a-f]{2}/i);
      expect(JSON.parse(bodies[0]!).input).toEqual(['pump �', '� valve', 'whole 😀 مضخة']);
    });

    it('never sends a blank text (the platform refuses "input contained no text")', async () => {
      const { calls, fetchImpl } = perText();
      const vectors = await embedTexts(mico, ['', '   ', 'pump'], fetchImpl);
      expect(calls.flat().every((t) => t.trim().length > 0)).toBe(true);
      expect(calls.flat()[2]).toBe('pump');
      expect(vectors).toHaveLength(3);
    });
  });

  // MICO360 AI's guide (§5, §6): when the named embedding model is unavailable another one answers, said only
  // by the X-Mico-Model-Warning header and the answer's `model`. Its vectors can't be compared with ours.
  describe('another embedding model answered (MICO360 AI)', () => {
    const answer = (model: string, headers: Record<string, string> = {}) =>
      (async () => new Response(JSON.stringify({ object: 'list', model, data: [{ index: 0, embedding: [0.1, 0.2] }] }), { status: 200, headers })) as unknown as typeof fetch;
    const mico = (modelKey = 'nomic-embed-text:latest'): ChatModel => ({ provider: { kind: 'custom', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'k', preset: 'mico360' }, modelKey });

    it('refuses the vectors when the platform says another model answered', async () => {
      const warned = answer('bge-m3:latest', { 'x-mico-model-warning': "Requested model 'nomic-embed-text:latest' is unavailable; processing on 'bge-m3:latest' instead." });
      await expect(embedTexts(mico(), ['pump'], warned)).rejects.toThrow(/another embedding model \(bge-m3:latest\)/);
      await expect(embedTexts(mico(), ['pump'], answer('bge-m3'))).rejects.toBeInstanceOf(EmbeddingModelChangedError);
    });

    it('keeps them when the model that answered is the one named (":latest" or not)', async () => {
      expect(await embedTexts(mico(), ['pump'], answer('nomic-embed-text:latest'))).toEqual([[0.1, 0.2]]);
      expect(await embedTexts(mico(), ['pump'], answer('nomic-embed-text'))).toEqual([[0.1, 0.2]]);
      expect(await embedTexts(mico('nomic-embed-text'), ['pump'], answer('nomic-embed-text:latest'))).toEqual([[0.1, 0.2]]);
    });

    it('leaves other providers as they were', async () => {
      const other: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://api.example.com/v1', apiKey: 'k', preset: 'custom' }, modelKey: 'embed-v1' };
      expect(await embedTexts(other, ['pump'], answer('embed-v1-2026-01'))).toEqual([[0.1, 0.2]]);
    });

    it('a used-up quota is said as one (as for chat)', async () => {
      const quota = (async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded: requests per hour (500).', type: 'rate_limit_exceeded', code: null } }), { status: 429, headers: { 'retry-after': '1800' } })) as unknown as typeof fetch;
      await expect(embedTexts(mico(), ['pump'], quota)).rejects.toMatchObject({ providerStatus: 429, quota: true });
    });
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
