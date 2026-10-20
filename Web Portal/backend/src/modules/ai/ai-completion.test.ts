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

describe('MICO360 AI (the company’s platform, per its API guide)', () => {
  const mico = (): ChatModel => ({
    provider: { kind: 'custom', preset: 'mico360', apiBaseUrl: 'http://ai.mico360.com:5310/v1', apiKey: 'mico_x' },
    modelKey: 'llama3.1:latest',
  });
  const reply = (content: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: content, type: 'x', code: null } }), { status, headers });

  it('asks for a JSON answer when the feature parses one (the platform holds the model to it)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      bodies.push({ url, ...JSON.parse(String(init!.body)) });
      return reply('{"a":1}');
    }) as unknown as typeof fetch;
    await complete(mico(), { system: 'Reply with ONLY JSON', prompt: 'hi', json: true }, fetchImpl, { allowPrivateHosts: true });
    await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true });
    expect(bodies[0]).toMatchObject({ url: 'http://ai.mico360.com:5310/v1/chat/completions', response_format: { type: 'json_object' } });
    expect(bodies[1]).not.toHaveProperty('response_format');
  });

  it('other OpenAI-compatible services are sent nothing new', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return reply('{}');
    }) as unknown as typeof fetch;
    const groq: ChatModel = { provider: { kind: 'custom', preset: 'groq', apiBaseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k' }, modelKey: 'llama-3.3-70b-versatile' };
    await complete(groq, { prompt: 'hi', json: true }, fetchImpl);
    expect(bodies[0]).not.toHaveProperty('response_format');
  });

  it('"busy, try again in a second" (429 with a short Retry-After) is retried once', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => (++calls === 1 ? reply('Concurrency limit', 429, { 'retry-after': '1' }) : reply('done'))) as unknown as typeof fetch;
    const out = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true, sleep: async (ms) => void waits.push(ms) });
    expect(out).toBe('done');
    expect(calls).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it('a longer wait (a quota, the minute’s rate limit) is not waited out: the person is told the service is busy', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return reply('Quota exceeded', 429, { 'retry-after': '40' });
    }) as unknown as typeof fetch;
    const err = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true, sleep: async () => {} }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((err as Error).message).toBe('The AI service is busy right now (HTTP 429). Try again in a moment.');
    expect((err as { detail?: string }).detail).toBe('Quota exceeded');
  });

  it('plain messages for no model available, too slow and too long; the platform’s reason stays for admins', async () => {
    const cases: Array<[number, string]> = [
      [503, 'The AI service has no model available right now (HTTP 503). Try again in a minute, or ask an admin to check AI Management.'],
      [504, 'The AI service took too long to answer (HTTP 504). Try again.'],
      [413, 'That is too long for the AI service to read (HTTP 413).'],
    ];
    for (const [status, message] of cases) {
      const fetchImpl = (async () => reply("No connected node provides the 'Chat' capability.", status)) as unknown as typeof fetch;
      const err = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true }).catch((e: unknown) => e);
      expect((err as Error).message, String(status)).toBe(message);
      expect((err as { detail?: string }).detail).toBe("No connected node provides the 'Chat' capability.");
    }
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
