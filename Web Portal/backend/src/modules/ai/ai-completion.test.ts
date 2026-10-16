import { describe, it, expect } from 'vitest';
import { complete, extractText, type ChatModel } from './ai-completion';

describe('extractText', () => {
  it('reads Anthropic messages content', () => {
    expect(extractText('anthropic', { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] })).toBe('hello world');
  });
  it('reads OpenAI chat completions', () => {
    expect(extractText('openai', { choices: [{ message: { content: ' hi ' } }] })).toBe('hi');
  });
  it('reads Ollama chat', () => {
    expect(extractText('ollama', { message: { content: 'yo' } })).toBe('yo');
  });
});

describe('complete', () => {
  it('calls the Anthropic Messages endpoint with the key + version and returns text', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '["a","b"]' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' }, modelKey: 'claude-x' };
    const out = await complete(model, { system: 'be brief', prompt: 'hi' }, fetchImpl);
    expect(out).toBe('["a","b"]');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.model).toBe('claude-x');
    expect(body.system).toBe('be brief');
  });

  const capture = () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    return { bodies, fetchImpl };
  };
  const openai = (modelKey: string, kind: 'openai' | 'custom' = 'openai'): ChatModel => ({
    provider: { kind, apiBaseUrl: 'https://api.example.com/v1', apiKey: 'k' },
    modelKey,
  });

  it('sends OpenAI the current length setting (max_completion_tokens) with the temperature', async () => {
    const { bodies, fetchImpl } = capture();
    await complete(openai('gpt-4o-mini'), { prompt: 'hi', maxTokens: 200 }, fetchImpl);
    expect(bodies[0]).toMatchObject({ model: 'gpt-4o-mini', max_completion_tokens: 200, temperature: 0.3 });
    expect(bodies[0]).not.toHaveProperty('max_tokens');
  });

  it('sends OpenAI reasoning models no temperature, a low effort and room to think', async () => {
    const { bodies, fetchImpl } = capture();
    await complete(openai('gpt-5-mini'), { prompt: 'hi', maxTokens: 120 }, fetchImpl);
    await complete(openai('o3-mini'), { prompt: 'hi' }, fetchImpl);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('temperature');
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_completion_tokens).toBeGreaterThanOrEqual(4096);
    }
  });

  it('keeps max_tokens for other OpenAI-compatible services', async () => {
    const { bodies, fetchImpl } = capture();
    await complete(openai('llama-3.3-70b-versatile', 'custom'), { prompt: 'hi', maxTokens: 200 }, fetchImpl);
    expect(bodies[0]).toMatchObject({ max_tokens: 200, temperature: 0.3 });
  });

  it('keeps the provider’s own explanation of a refusal for admins', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'The model `gpt-9` does not exist.' } }), { status: 404 })) as unknown as typeof fetch;
    const err = await complete(openai('gpt-9'), { prompt: 'hi' }, fetchImpl).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/HTTP 404/); // what users see
    expect((err as { detail?: string }).detail).toBe('The model `gpt-9` does not exist.');
  });

  it('throws a readable error on a non-OK provider response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, modelKey: 'gpt' };
    await expect(complete(model, { prompt: 'hi' }, fetchImpl)).rejects.toThrow(/HTTP 401/);
  });

  it('reports a non-JSON 200 answer as a readable error, not a crash', async () => {
    const fetchImpl = (async () => new Response('<html>proxy page</html>', { status: 200 })) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, modelKey: 'gpt' };
    await expect(complete(model, { prompt: 'hi' }, fetchImpl)).rejects.toThrow(/unreadable response/);
  });

  it('gives up on a provider that does not answer in time', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, modelKey: 'gpt' };
    await expect(complete(model, { prompt: 'hi' }, fetchImpl, { timeoutMs: 20 })).rejects.toThrow(/did not respond in time/);
  });

  it('refuses to call a provider stored with an internal address', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'http://169.254.169.254/latest', apiKey: '' }, modelKey: 'x' };
    await expect(complete(model, { prompt: 'hi' }, fetchImpl)).rejects.toThrow(/public address/);
    expect(called).toBe(false);
  });
});

describe('extractText tolerates odd shapes', () => {
  it('returns empty text instead of throwing', () => {
    expect(extractText('openai', null)).toBe('');
    expect(extractText('anthropic', { content: 'not-an-array' })).toBe('');
    expect(extractText('openai', { choices: [{ message: { content: [{ type: 'text' }] } }] })).toBe('');
  });
});

describe('a provider refusal is not our own HTTP status', () => {
  it('answers 400 to our caller, whatever the provider said (a provider 401 must not look like an expired session)', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: 'k' }, modelKey: 'gpt-4o' };
    const err = await complete(model, { prompt: 'hi' }, fetchImpl).catch((e: unknown) => e);
    expect((err as { status: number }).status).toBe(400);
    expect((err as { providerStatus: number }).providerStatus).toBe(401);
  });
});
