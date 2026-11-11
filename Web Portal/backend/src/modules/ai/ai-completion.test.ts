import { describe, it, expect } from 'vitest';
import { complete, extractText, ProviderRefusedError, type ChatModel } from './ai-completion';
import { AiCallStoppedError } from './ai-network';
import { isRetryable } from '../ai-jobs/ai-job-runner';

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

  it('stops a provider call when the caller says stop (MICO AI’s Stop), as a stop, not a timeout', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, modelKey: 'gpt' };
    const stop = new AbortController();
    const call = complete(model, { prompt: 'hi' }, fetchImpl, { timeoutMs: 60_000, signal: stop.signal });
    stop.abort();
    await expect(call).rejects.toBeInstanceOf(AiCallStoppedError);
  });

  it('does not call the provider at all once stopped', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const model: ChatModel = { provider: { kind: 'openai', apiBaseUrl: 'https://api.example.com', apiKey: '' }, modelKey: 'gpt' };
    const stop = new AbortController();
    stop.abort();
    await expect(complete(model, { prompt: 'hi' }, fetchImpl, { signal: stop.signal })).rejects.toBeInstanceOf(AiCallStoppedError);
    expect(called).toBe(false);
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
    provider: { kind: 'custom', preset: 'mico360', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_x' },
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
    expect(bodies[0]).toMatchObject({ url: 'https://ai.mico360.com:5310/v1/chat/completions', response_format: { type: 'json_object' } });
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

  // Review I2: half a character (a cut emoji) is sent as "\ud83d", which a strict JSON reader refuses.
  it('never sends half a character to MICO360 AI (instructions or prompt)', async () => {
    const raw: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      raw.push(String(init!.body));
      return reply('ok');
    }) as unknown as typeof fetch;
    await complete(mico(), { system: 'Rules for Sara \ud83d', prompt: 'Notes: pump 😀 then \ude00' }, fetchImpl);
    expect(raw[0]).not.toMatch(/\\ud8[0-9a-f]{2}|\\ude[0-9a-f]{2}/i);
    const sent = JSON.parse(raw[0]!) as { messages: Array<{ content: string }> };
    expect(sent.messages.map((m) => m.content)).toEqual(['Rules for Sara �', 'Notes: pump 😀 then �']);
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

  it('a longer wait (the minute’s rate limit) is not waited out: the person is told the service is busy', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return reply('Rate limit exceeded for this API key.', 429, { 'retry-after': '40' });
    }) as unknown as typeof fetch;
    const err = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true, sleep: async () => {} }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((err as Error).message).toBe('The AI service is busy right now (HTTP 429). Try again in a moment.');
    expect((err as { detail?: string }).detail).toBe('Rate limit exceeded for this API key.');
    expect(err).toMatchObject({ quota: false });
    expect(isRetryable(err)).toBe(true);
  });

  // Its guide (§2, §8): a quota (requests per hour, tokens per day or month…) is a 429 "Quota exceeded: …"
  // with a Retry-After until the period resets — not "busy, try again in a moment".
  it('a used-up quota is said as one, and background work does not try it again', async () => {
    for (const [message, retryAfter] of [['Quota exceeded: tokens per day (200000).', '41000'], ['Too many requests.', '3600']] as const) {
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return reply(message, 429, { 'retry-after': retryAfter });
      }) as unknown as typeof fetch;
      const err = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true, sleep: async () => {} }).catch((e: unknown) => e);
      expect(calls, message).toBe(1);
      expect((err as Error).message, message).toBe(
        'The AI service’s usage allowance is used up for now (HTTP 429). It starts again when its period resets — an admin can check the key’s quota in MICO360 Connect.',
      );
      expect(err).toMatchObject({ providerStatus: 429, quota: true, detail: message, retryAfterSeconds: Number(retryAfter) });
      expect(isRetryable(err), message).toBe(false);
    }
  });

  // Review I3: a per-minute quota resets within the background retries (30 s, 2 min, 5 min): tried again.
  it('a quota that resets within 5 minutes is still tried again in the background', async () => {
    const fetchImpl = (async () => reply('Quota exceeded: requests per minute (30).', 429, { 'retry-after': '40' })) as unknown as typeof fetch;
    const err = await complete(mico(), { prompt: 'hi' }, fetchImpl, { allowPrivateHosts: true, sleep: async () => {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({ quota: true, retryAfterSeconds: 40 });
    expect(isRetryable(err)).toBe(true);
    const unknownWait = (async () => reply('Quota exceeded: tokens per month.', 429)) as unknown as typeof fetch;
    const err2 = await complete(mico(), { prompt: 'hi' }, unknownWait, { allowPrivateHosts: true }).catch((e: unknown) => e);
    expect(err2).toMatchObject({ quota: true, retryAfterSeconds: null });
    expect(isRetryable(err2)).toBe(false);
  });

  it('other providers: a 429 is “busy” and tried again later, as before', async () => {
    const groq: ChatModel = { provider: { kind: 'custom', preset: 'groq', apiBaseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k' }, modelKey: 'm' };
    const err = await complete(groq, { prompt: 'hi' }, (async () => reply('Quota exceeded', 429, { 'retry-after': '41000' })) as unknown as typeof fetch).catch((e: unknown) => e);
    expect((err as Error).message).toBe('The AI service is busy right now (HTTP 429). Try again in a moment.');
    expect(isRetryable(err)).toBe(true);
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

describe('complete with pictures (1.23 OCR)', () => {
  const picture = { data: Buffer.from([0xff, 0xd8, 0xff, 0x01]), mimeType: 'image/jpeg' };
  const take = (reply: unknown) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init!.body)) });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it('OpenAI-compatible: the prompt and each picture as content parts (data URLs)', async () => {
    const { calls, fetchImpl } = take({ choices: [{ message: { content: 'PERMIT TO WORK' } }] });
    const model: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://ai.example.com/v1', apiKey: 'k', preset: 'mico360' }, modelKey: 'glm-ocr' };
    expect(await complete(model, { prompt: 'Read it', images: [picture] }, fetchImpl)).toBe('PERMIT TO WORK');
    const messages = calls[0]!.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.at(-1)!.content).toEqual([
      { type: 'text', text: 'Read it' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${picture.data.toString('base64')}` } },
    ]);
  });

  it('Anthropic: base64 image blocks before the text', async () => {
    const { calls, fetchImpl } = take({ content: [{ type: 'text', text: 'ok' }] });
    await complete({ provider: { kind: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', apiKey: 'a' }, modelKey: 'claude-x' }, { prompt: 'Read it', images: [picture] }, fetchImpl);
    const content = (calls[0]!.body.messages as Array<{ content: unknown[] }>)[0]!.content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: picture.data.toString('base64') } });
    expect(content[1]).toEqual({ type: 'text', text: 'Read it' });
  });

  it('Ollama: the pictures beside the message', async () => {
    const { calls, fetchImpl } = take({ message: { content: 'ok' } });
    await complete({ provider: { kind: 'ollama', apiBaseUrl: 'http://localhost:11434', apiKey: '' }, modelKey: 'llava' }, { prompt: 'Read it', images: [picture] }, fetchImpl, { allowPrivateHosts: true });
    expect((calls[0]!.body.messages as unknown[]).at(-1)).toEqual({ role: 'user', content: 'Read it', images: [picture.data.toString('base64')] });
  });
});

describe('MICO360 AI (b) bundles in complete()', () => {
  const mico: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_key', preset: 'mico360' }, modelKey: 'llama3.1:latest' };
  const other: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', preset: 'groq' }, modelKey: 'llama-3.3' };
  const ok = (content: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ id: 'JOB-GW1-1', object: 'chat.completion', model: 'llama3.1:latest', choices: [{ message: { content } }], ...extra }), { status: 200, headers });
  const record = (answer: (url: string, n: number) => Response) => {
    const calls: { url: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(String(init?.body));
      } catch {
        body = null;
      }
      calls.push({ url: String(url), headers: new Headers(init?.headers), body });
      return answer(String(url), calls.length);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const schema = { name: 'priority', schema: { type: 'object', properties: { priority: { type: 'string', enum: ['LOW', 'HIGH'] } }, required: ['priority'] } };

  it('b1: a feature’s JSON Schema is sent as response_format json_schema; other services get none', async () => {
    const m = record(() => ok('{"priority":"HIGH"}'));
    await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl);
    expect(m.calls[0]!.body!.response_format).toEqual({ type: 'json_schema', json_schema: schema });
    const o = record(() => ok('{}'));
    await complete(other, { prompt: 'p', json: true, schema }, o.fetchImpl);
    expect(o.calls[0]!.body).not.toHaveProperty('response_format');
  });

  it('b6: the Tasks user id goes as `user` (MICO360 AI only)', async () => {
    const m = record(() => ok('x'));
    await complete(mico, { prompt: 'p', user: 'cuser123' }, m.fetchImpl);
    expect(m.calls[0]!.body!.user).toBe('cuser123');
    const o = record(() => ok('x'));
    await complete(other, { prompt: 'p', user: 'cuser123' }, o.fetchImpl);
    expect(o.calls[0]!.body).not.toHaveProperty('user');
  });

  it('b2: a background job’s scope becomes an Idempotency-Key, the same for the same request', async () => {
    const m = record(() => ok('x'));
    await complete(mico, { prompt: 'same' }, m.fetchImpl, { idempotencyKey: 'tasks-mom-job1' });
    await complete(mico, { prompt: 'same' }, m.fetchImpl, { idempotencyKey: 'tasks-mom-job1' });
    await complete(mico, { prompt: 'changed' }, m.fetchImpl, { idempotencyKey: 'tasks-mom-job1' });
    const keys = m.calls.map((c) => c.headers.get('idempotency-key'));
    expect(keys[0]).toMatch(/^tasks-mom-job1-[0-9a-f]{40}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    const o = record(() => ok('x'));
    await complete(other, { prompt: 'same' }, o.fetchImpl, { idempotencyKey: 'tasks-mom-job1' });
    expect(o.calls[0]!.headers.get('idempotency-key')).toBeNull();
  });

  it('b5, b11: what the answer says about itself reaches the caller (the model that answered, the key’s concurrency)', async () => {
    const seen: unknown[] = [];
    const m = record(() =>
      ok('x', { model: 'qwen2.5:0.5b', warning: "Requested model 'llama3.1:latest' is unavailable; processing on 'qwen2.5:0.5b' instead." }, { 'x-mico-correlation-id': 'REQ-1', 'x-mico-concurrency-limit': '6', 'x-mico-model-warning': 'sub' }),
    );
    await complete(mico, { prompt: 'p' }, m.fetchImpl, { observe: (i) => seen.push(i) });
    expect(seen).toEqual([
      { ok: true, model: 'qwen2.5:0.5b', substituted: "Requested model 'llama3.1:latest' is unavailable; processing on 'qwen2.5:0.5b' instead.", correlationId: 'REQ-1', jobId: 'JOB-GW1-1', concurrencyLimit: 6 },
    ]);
  });

  it('b3: a 504 that left the job running is collected with the native key until the deadline', async () => {
    const m = record((url) =>
      url.endsWith('/chat/completions')
        ? new Response(JSON.stringify({ error: { message: 'The request did not complete within 300 seconds (job JOB-GW1-77, correlation id REQ-77).', type: 'timeout', code: null } }), { status: 504 })
        : new Response(JSON.stringify({ jobId: 'JOB-GW1-77', state: 'Completed', output: '{"summary":"done"}' }), { status: 200 }),
    );
    const out = await complete(mico, { prompt: 'p' }, m.fetchImpl, { collectUntil: Date.now() + 60_000, sleep: async () => {} });
    expect(out).toBe('{"summary":"done"}');
    expect(m.calls[1]!.url).toBe('https://ai.mico360.com:5310/api/v1/jobs/JOB-GW1-77');
    expect(m.calls[1]!.headers.get('x-mico-api-key')).toBe('mico_key');
  });

  it('b3: without a deadline a 504 is a refusal naming the job (b10)', async () => {
    const m = record(() => new Response(JSON.stringify({ error: { message: 'The request did not complete within 300 seconds (job JOB-GW1-78, correlation id REQ-78).' } }), { status: 504, headers: { 'x-mico-correlation-id': 'REQ-78' } }));
    const err = (await complete(mico, { prompt: 'p' }, m.fetchImpl).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err.providerStatus).toBe(504);
    expect(err.jobId).toBe('JOB-GW1-78');
    expect(err.correlationId).toBe('REQ-78');
    expect(m.calls).toHaveLength(1);
  });

  it('b9: MICO360 AI’s 401, 403 and 502 say who can fix them; other services keep the general words', async () => {
    for (const [status, words] of [
      [401, /did not accept the API key \(HTTP 401\)/],
      [403, /may not be used for this \(HTTP 403\).*Applications & keys/],
      [502, /model failed while answering \(HTTP 502\)/],
    ] as const) {
      const m = record(() => new Response(JSON.stringify({ error: { message: 'x' } }), { status }));
      expect(((await complete(mico, { prompt: 'p' }, m.fetchImpl).catch((e: unknown) => e)) as Error).message).toMatch(words);
      const o = record(() => new Response(JSON.stringify({ error: { message: 'x' } }), { status }));
      expect(((await complete(other, { prompt: 'p' }, o.fetchImpl).catch((e: unknown) => e)) as Error).message).toBe(`The AI provider rejected the request (HTTP ${status}).`);
    }
  });

  it('b15: with a listener, MICO360 AI answers on its native live stream (the schema as `format`)', async () => {
    const enc = new TextEncoder();
    const event = (name: string, data: unknown) => enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const m = record((url) =>
      url.endsWith('/chat/stream')
        ? new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(event('chunk', { sequence: 0, text: '{"priority":', jobId: 'JOB-L' }));
                c.enqueue(event('chunk', { sequence: 1, text: '"HIGH"}', jobId: 'JOB-L' }));
                c.enqueue(event('done', { reason: 'completed', chunks: 2, jobId: 'JOB-L', correlationId: 'REQ-L' }));
                c.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          )
        : ok('never'),
    );
    const seen: string[] = [];
    const out = await complete(mico, { system: 's', prompt: 'p', json: true, schema, user: 'u9' }, m.fetchImpl, { onText: (t) => seen.push(t), idempotencyKey: 'tasks-ai-j' });
    expect(out).toBe('{"priority":"HIGH"}');
    expect(seen).toEqual(['{"priority":', '{"priority":"HIGH"}']);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe('https://ai.mico360.com:5310/api/v1/chat/stream');
    expect(m.calls[0]!.body).toMatchObject({ prompt: 'p', system: 's', model: 'llama3.1:latest', user: 'u9', format: schema.schema });
    expect(m.calls[0]!.headers.get('idempotency-key')).toMatch(/^tasks-ai-j-[0-9a-f]{40}$/);
  });

  it('b15: a server without the live stream is asked on /v1 as before', async () => {
    const m = record((url) => (url.endsWith('/chat/stream') ? new Response(null, { status: 404 }) : ok('plain answer')));
    expect(await complete(mico, { prompt: 'p' }, m.fetchImpl, { onText: () => {} })).toBe('plain answer');
    expect(m.calls.map((c) => c.url)).toEqual(['https://ai.mico360.com:5310/api/v1/chat/stream', 'https://ai.mico360.com:5310/v1/chat/completions']);
  });

  it('b15: other providers ignore the listener (no stream)', async () => {
    const o = record(() => ok('x'));
    await complete(other, { prompt: 'p' }, o.fetchImpl, { onText: () => {} });
    expect(o.calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

describe('MICO360 AI (b) bundles: review fixes in complete()', () => {
  const mico: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_key', preset: 'mico360' }, modelKey: 'llama3.1:latest' };
  const ok = (content: string) => new Response(JSON.stringify({ id: 'JOB-1', model: 'llama3.1:latest', choices: [{ message: { content } }] }), { status: 200 });
  const sseOf = (text: string) => {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify({ sequence: 0, text, jobId: 'J' })}\n\n`));
          c.enqueue(enc.encode('event: done\ndata: {"reason":"completed","chunks":1,"jobId":"J"}\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };

  it('minor 3: Stop ends a job being collected at once (the wait between looks hears it)', async () => {
    const stop = new AbortController();
    let looks = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith('/chat/completions')) return new Response(JSON.stringify({ error: { message: 'The request did not complete within 300 seconds (job JOB-9, correlation id REQ-9).' } }), { status: 504 });
      looks += 1;
      setTimeout(() => stop.abort(), 20);
      return new Response(JSON.stringify({ jobId: 'JOB-9', state: 'Running' }), { status: 200 });
    }) as unknown as typeof fetch;
    const started = Date.now();
    const err = await complete(mico, { prompt: 'p' }, fetchImpl, { collectUntil: Date.now() + 60_000, signal: stop.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiCallStoppedError);
    expect(Date.now() - started).toBeLessThan(1500); // not the 2 s wait before the next look
    expect(looks).toBe(1);
  });

  it('minor 10: the caller is told before a job is collected (it frees the key’s slot)', async () => {
    const order: string[] = [];
    const fetchImpl = (async (url: string) => {
      order.push(String(url).endsWith('/chat/completions') ? 'ask' : 'look');
      return String(url).endsWith('/chat/completions')
        ? new Response(JSON.stringify({ error: { message: 'The request did not complete within 300 seconds (job JOB-8, correlation id REQ-8).' } }), { status: 504 })
        : new Response(JSON.stringify({ jobId: 'JOB-8', state: 'Completed', output: 'done' }), { status: 200 });
    }) as unknown as typeof fetch;
    await complete(mico, { prompt: 'p' }, fetchImpl, { collectUntil: Date.now() + 60_000, sleep: async () => {}, beforeCollect: () => void order.push('free') });
    expect(order).toEqual(['ask', 'free', 'look']);
  });

  it('minor 2: on the live stream a "try again in a second" (429) is waited out once, as on /v1', async () => {
    let n = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => (++n === 1 ? new Response(JSON.stringify({ error: 'Concurrency limit reached.' }), { status: 429, headers: { 'retry-after': '1' } }) : sseOf('fine'))) as unknown as typeof fetch;
    expect(await complete(mico, { prompt: 'p' }, fetchImpl, { onText: () => {}, sleep: async (ms) => void waits.push(ms) })).toBe('fine');
    expect(n).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it('minor 6: instructions over the native 8,000 characters go to /v1 (no stream), where they fit', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return ok('fits');
    }) as unknown as typeof fetch;
    expect(await complete(mico, { system: 'x'.repeat(8_001), prompt: 'p' }, fetchImpl, { onText: () => {} })).toBe('fits');
    expect(urls).toEqual(['https://ai.mico360.com:5310/v1/chat/completions']);
  });
});

describe('json_schema safety net (MICO360 AI): JSON mode when strict answer shapes are not taken', () => {
  const mico: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_key', preset: 'mico360' }, modelKey: 'llama3.1:latest' };
  const other: ChatModel = { provider: { kind: 'custom', apiBaseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', preset: 'groq' }, modelKey: 'llama-3.3' };
  const schema = { name: 'priority', schema: { type: 'object', properties: { priority: { type: 'string', enum: ['LOW', 'HIGH'] }, reason: { type: 'string' } }, required: ['priority', 'reason'] } };
  const ok = (content: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ id: 'JOB-S', model: 'llama3.1:latest', choices: [{ message: { content }, ...extra }] }), { status: 200 });
  const refuse = (status: number, message = 'response_format json_schema is not supported.') => new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), { status });
  const record = (answer: (body: Record<string, unknown>, n: number, url: string) => Response) => {
    const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body, key: new Headers(init?.headers).get('idempotency-key') });
      return answer(body, calls.length, String(url));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const strict = (b: Record<string, unknown>) => (b.response_format as { type?: string } | undefined)?.type === 'json_schema';
  const sse = (text: string) => {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify({ sequence: 0, text, jobId: 'JOB-T' })}\n\n`));
          c.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ reason: 'completed', chunks: 1, jobId: 'JOB-T', correlationId: 'REQ-T' })}\n\n`));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };

  for (const status of [400, 422]) {
    it(`a ${status} refusing json_schema is asked once more with today’s json_object, and the caller is told`, async () => {
      const seen: { ok: boolean; strictRefused?: unknown }[] = [];
      const m = record((b) => (strict(b) ? refuse(status) : ok('{"priority":"HIGH","reason":"r"}')));
      const out = await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl, { observe: (i) => seen.push(i), idempotencyKey: 'tasks-mom-j1' });
      expect(out).toBe('{"priority":"HIGH","reason":"r"}');
      expect(m.calls.map((c) => c.body.response_format)).toEqual([{ type: 'json_schema', json_schema: schema }, { type: 'json_object' }]);
      // The same messages, the same user; a different request, so its own Idempotency-Key.
      expect(m.calls[1]!.body.messages).toEqual(m.calls[0]!.body.messages);
      expect(m.calls[1]!.key).toMatch(/^tasks-mom-j1-[0-9a-f]{40}$/);
      expect(m.calls[1]!.key).not.toBe(m.calls[0]!.key);
      expect(seen.at(-1)).toMatchObject({ ok: true, strictRefused: { status, reason: 'response_format json_schema is not supported.' } });
    });
  }

  it('an answer that is not JSON for the schema is asked once more with json_object (not remembered: one answer’s slip)', async () => {
    const seen: { strictRefused?: unknown }[] = [];
    const m = record((b) => (strict(b) ? ok('{"priority":"SOMEDAY"}') : ok('{"priority":"LOW","reason":"r"}')));
    expect(await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl, { observe: (i) => seen.push(i) })).toBe('{"priority":"LOW","reason":"r"}');
    expect(m.calls.map((c) => (c.body.response_format as { type: string }).type)).toEqual(['json_schema', 'json_object']);
    expect(seen.some((i) => i.strictRefused)).toBe(false);
  });

  it('only once: a json_object answer that still does not fit goes to the feature’s own check, as today', async () => {
    const m = record(() => ok('not json at all'));
    expect(await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl)).toBe('not json at all');
    expect(m.calls).toHaveLength(2);
  });

  it('an answer cut at its length is not asked again (the same room would cut it again)', async () => {
    const m = record(() => ok('{"priority":"HI', { finish_reason: 'length' }));
    expect(await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl)).toBe('{"priority":"HI');
    expect(m.calls).toHaveLength(1);
  });

  it('a 400 that JSON mode gets too is not about the schema: that refusal is thrown and nothing is remembered', async () => {
    const seen: { strictRefused?: unknown }[] = [];
    const m = record(() => refuse(400, 'Idempotency-Key is not valid.'));
    const err = (await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl, { observe: (i) => seen.push(i) }).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err).toBeInstanceOf(ProviderRefusedError);
    expect(err.providerStatus).toBe(400);
    expect(m.calls).toHaveLength(2);
    expect(seen.some((i) => i.strictRefused)).toBe(false);
  });

  it('other refusals (busy, failed, too long) are not retried in JSON mode', async () => {
    for (const status of [413, 502, 503]) {
      const m = record(() => refuse(status, 'x'));
      await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl).catch(() => {});
      expect(m.calls, String(status)).toHaveLength(1);
    }
  });

  it('a request without a schema, and other providers, are never asked twice', async () => {
    const m = record(() => refuse(400));
    await complete(mico, { prompt: 'p', json: true }, m.fetchImpl).catch(() => {});
    expect(m.calls).toHaveLength(1);
    const o = record(() => refuse(400));
    await complete(other, { prompt: 'p', json: true, schema }, o.fetchImpl).catch(() => {});
    expect(o.calls).toHaveLength(1);
    const o2 = record(() => ok('not json'));
    expect(await complete(other, { prompt: 'p', json: true, schema }, o2.fetchImpl)).toBe('not json');
    expect(o2.calls).toHaveLength(1);
  });

  it('the live stream: a 400 refusing the schema as `format` is streamed again with format "json"', async () => {
    const seen: { strictRefused?: unknown }[] = [];
    const texts: string[] = [];
    const m = record((b, _n, url) =>
      url.endsWith('/chat/stream') && typeof b.format === 'object'
        ? new Response(JSON.stringify({ error: 'format must be "json", "text" or a JSON Schema object.' }), { status: 400 })
        : sse('{"priority":"LOW","reason":"r"}'),
    );
    const out = await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl, { onText: (t) => texts.push(t), observe: (i) => seen.push(i) });
    expect(out).toBe('{"priority":"LOW","reason":"r"}');
    expect(m.calls.map((c) => [c.url.replace('https://ai.mico360.com:5310', ''), c.body.format])).toEqual([
      ['/api/v1/chat/stream', schema.schema],
      ['/api/v1/chat/stream', 'json'],
    ]);
    expect(texts.at(-1)).toBe('{"priority":"LOW","reason":"r"}');
    expect(seen.at(-1)).toMatchObject({ ok: true, strictRefused: { status: 400, reason: 'format must be "json", "text" or a JSON Schema object.' } });
  });

  it('the live stream: an answer that does not fit is streamed again with format "json"', async () => {
    const m = record((b) => (typeof b.format === 'object' ? sse('{"priority":"MAYBE"}') : sse('{"priority":"HIGH","reason":"r"}')));
    expect(await complete(mico, { prompt: 'p', json: true, schema }, m.fetchImpl, { onText: () => {} })).toBe('{"priority":"HIGH","reason":"r"}');
    expect(m.calls.map((c) => c.body.format)).toEqual([schema.schema, 'json']);
  });
});
