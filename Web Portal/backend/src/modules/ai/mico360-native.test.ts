import { describe, it, expect } from 'vitest';
import {
  collectJob,
  idempotencyKey,
  keyStatus,
  micoMeta,
  nativeOcr,
  platformFleet,
  platformRoot,
  platformVersion,
  readRefusal,
} from './mico360-native';
import { ProviderRefusedError } from './ai-errors';
import { AiCallStoppedError, AiTimeoutError } from './ai-network';

const provider = { kind: 'custom' as const, preset: 'mico360' as const, apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_' + 'ab12'.repeat(12) };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
type Call = { url: string; init?: RequestInit };
const recorder = (answer: (call: Call, n: number) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return answer(call, calls.length);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const headerOf = (call: Call, name: string) => new Headers(call.init?.headers).get(name);

describe('platformRoot — the native API sits beside /v1 (guide §1)', () => {
  it('drops /v1 or /openai/v1 from the provider address', () => {
    expect(platformRoot('https://ai.mico360.com:5310/v1')).toBe('https://ai.mico360.com:5310');
    expect(platformRoot('https://ai.mico360.com:5310/v1/')).toBe('https://ai.mico360.com:5310');
    expect(platformRoot('https://ai.mico360.com:5310/openai/v1')).toBe('https://ai.mico360.com:5310');
    expect(platformRoot('https://ai.mico360.com:5310')).toBe('https://ai.mico360.com:5310');
    expect(platformRoot('https://proxy.example.com/ai/v1')).toBe('https://proxy.example.com/ai');
  });
});

describe('micoMeta — what every MICO360 AI answer says about itself (guide §5, §8)', () => {
  it('reads the correlation id, the model warning and the key’s concurrency', () => {
    const res = new Response('{}', {
      headers: { 'x-mico-correlation-id': 'REQ-6F2A91C0B4D3', 'x-mico-model-warning': "Requested model 'a' is unavailable; processing on 'b' instead.", 'x-mico-concurrency-limit': '6', 'x-mico-concurrency-inflight': '2' },
    });
    expect(micoMeta(res)).toEqual({ correlationId: 'REQ-6F2A91C0B4D3', modelWarning: "Requested model 'a' is unavailable; processing on 'b' instead.", warning: null, concurrencyLimit: 6, inFlight: 2 });
  });
  it('keeps only well-formed ids and sane numbers', () => {
    const res = new Response('{}', { headers: { 'x-mico-correlation-id': 'REQ <script>', 'x-mico-concurrency-limit': '9999' } });
    const meta = micoMeta(res);
    expect(meta.correlationId).toBeNull();
    expect(meta.concurrencyLimit).toBeNull();
  });
});

describe('readRefusal — the reason, and the job a 504 left running', () => {
  it('native: { error, jobId, correlationId }', async () => {
    const r = await readRefusal(json(504, { error: 'The request did not complete in time.', jobId: 'JOB-GW1-20261111-1', correlationId: 'REQ-1' }));
    expect(r).toEqual({ detail: 'The request did not complete in time.', jobId: 'JOB-GW1-20261111-1', correlationId: 'REQ-1' });
  });
  it('OpenAI surface: the job id is in the message', async () => {
    const r = await readRefusal(
      json(504, { error: { message: 'The request did not complete within 300 seconds (job JOB-GW1-20261111-797697, correlation id REQ-ABC).', type: 'timeout', code: null } }, { 'x-mico-correlation-id': 'REQ-ABC' }),
    );
    expect(r.jobId).toBe('JOB-GW1-20261111-797697');
    expect(r.correlationId).toBe('REQ-ABC');
  });
  it('an empty body (a native 400/415) is no reason, not a failure', async () => {
    expect(await readRefusal(new Response(null, { status: 400 }))).toEqual({ detail: null, jobId: null, correlationId: null });
  });
});

describe('idempotencyKey (guide §11: up to 128 of letters, digits and - _ : .)', () => {
  it('is the scope and a hash of what is sent: the same request again has the same key', () => {
    const a = idempotencyKey('tasks-mom-job_1', 'POST /v1/chat/completions', 'body');
    expect(a).toBe(idempotencyKey('tasks-mom-job_1', 'POST /v1/chat/completions', 'body'));
    expect(a).not.toBe(idempotencyKey('tasks-mom-job_1', 'POST /v1/chat/completions', 'other body'));
    expect(a).not.toBe(idempotencyKey('tasks-mom-job_2', 'POST /v1/chat/completions', 'body'));
    expect(a).toMatch(/^[A-Za-z0-9_:.-]{1,128}$/);
  });
  it('drops characters the platform refuses and stays within 128', () => {
    const k = idempotencyKey('a b/c?'.repeat(40), 'x', 'y');
    expect(k).toMatch(/^[A-Za-z0-9_:.-]{1,128}$/);
  });
});

describe('collectJob — GET /api/v1/jobs/{jobId} with the native key header (guide §5)', () => {
  it('polls with backoff until the job is Completed and returns its output', async () => {
    const { calls, fetchImpl } = recorder((_c, n) =>
      n < 3 ? json(200, { jobId: 'JOB-1', state: n === 1 ? 'Queued' : 'Running', output: null }) : json(200, { jobId: 'JOB-1', state: 'Completed', output: 'Paris.', model: 'qwen2.5:0.5b', metadata: { warning: 'moved' } }),
    );
    const waits: number[] = [];
    const out = await collectJob(provider, 'JOB-1', { fetchImpl, deadline: Date.now() + 60_000, sleep: async (ms) => void waits.push(ms) });
    expect(out).toEqual({ output: 'Paris.', model: 'qwen2.5:0.5b', warning: 'moved' });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('https://ai.mico360.com:5310/api/v1/jobs/JOB-1');
    expect(headerOf(calls[0]!, 'x-mico-api-key')).toBe(provider.apiKey);
    expect(headerOf(calls[0]!, 'authorization')).toBeNull();
    expect(waits.length).toBe(2);
    expect(waits[1]!).toBeGreaterThanOrEqual(waits[0]!);
  });
  it('a job that failed is a refusal carrying the job’s error and id', async () => {
    const { fetchImpl } = recorder(() => json(200, { jobId: 'JOB-2', state: 'Failed', error: 'Model would not load.' }, { 'x-mico-correlation-id': 'REQ-9' }));
    const err = (await collectJob(provider, 'JOB-2', { fetchImpl, deadline: Date.now() + 10_000, sleep: async () => {} }).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err).toBeInstanceOf(ProviderRefusedError);
    expect(err.providerStatus).toBe(502);
    expect(err.detail).toBe('Model would not load.');
    expect(err.jobId).toBe('JOB-2');
  });
  it('past its deadline it is a time-out (tried again later), naming the job', async () => {
    let t = 0;
    const { fetchImpl } = recorder(() => json(200, { jobId: 'JOB-3', state: 'Running' }));
    const err = (await collectJob(provider, 'JOB-3', { fetchImpl, deadline: 5_000, now: () => t, sleep: async (ms) => void (t += ms) }).catch((e: unknown) => e)) as AiTimeoutError;
    expect(err).toBeInstanceOf(AiTimeoutError);
    expect(err.jobId).toBe('JOB-3');
  });
  it('a job the platform no longer has (cancelled before it started) is a time-out', async () => {
    const { fetchImpl } = recorder(() => json(404, { error: 'No job with that id exists for this API key.' }));
    await expect(collectJob(provider, 'JOB-4', { fetchImpl, deadline: Date.now() + 10_000, sleep: async () => {} })).rejects.toBeInstanceOf(AiTimeoutError);
  });
  it('stops at once when the caller stops', async () => {
    const stop = new AbortController();
    const { fetchImpl } = recorder(() => json(200, { jobId: 'JOB-5', state: 'Running' }));
    const err = await collectJob(provider, 'JOB-5', { fetchImpl, deadline: Date.now() + 60_000, signal: stop.signal, sleep: async () => stop.abort() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiCallStoppedError);
  });
});

describe('platform facts (b7, b11, b12)', () => {
  it('the Connect version, from the keyless GET /api/status', async () => {
    const { calls, fetchImpl } = recorder(() => json(200, { product: 'MICO360 Connect Relay', version: '2.6.28', commit: '0383615', status: 'online' }));
    expect(await platformVersion(provider, { fetchImpl })).toEqual({ version: '2.6.28', commit: '0383615' });
    expect(calls[0]!.url).toBe('https://ai.mico360.com:5310/api/status');
    expect(headerOf(calls[0]!, 'x-mico-api-key')).toBeNull(); // never sent where it isn't needed
  });
  it('the fleet’s capabilities, from GET /api/v1/models', async () => {
    const { calls, fetchImpl } = recorder(() => json(200, { models: ['nomic-embed-text', 'qwen2.5:0.5b'], capabilities: ['Chat', 'Embedding'] }));
    expect(await platformFleet(provider, { fetchImpl })).toEqual({ models: ['nomic-embed-text', 'qwen2.5:0.5b'], capabilities: ['Chat', 'Embedding'] });
    expect(calls[0]!.url).toBe('https://ai.mico360.com:5310/api/v1/models');
    expect(headerOf(calls[0]!, 'x-mico-api-key')).toBe(provider.apiKey);
  });
  it('the key’s concurrency, from GET /api/v1/status', async () => {
    const { fetchImpl } = recorder(() => json(200, { application: 'Tasks', status: 'online', concurrency: { limit: 6, inFlight: 1, available: 5 }, priority: 2, nodesOnline: 4 }));
    expect(await keyStatus(provider, { fetchImpl })).toEqual({ limit: 6, inFlight: 1 });
  });
  it('anything unreadable is null, never an error', async () => {
    const { fetchImpl } = recorder(() => new Response('<html>', { status: 200 }));
    expect(await platformVersion(provider, { fetchImpl })).toBeNull();
    expect(await platformFleet(provider, { fetchImpl })).toBeNull();
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await keyStatus(provider, { fetchImpl: down })).toBeNull();
  });
});

describe('nativeOcr — POST /api/v1/ocr, multipart (guide §5)', () => {
  const pdf = { data: Buffer.from('%PDF-1.7 scanned'), mimeType: 'application/pdf', filename: 'Site report "B".pdf' };
  it('sends the whole file, the language and the wait, with the native key header and an Idempotency-Key', async () => {
    const { calls, fetchImpl } = recorder(() =>
      json(200, { jobId: 'JOB-O1', correlationId: 'REQ-O1', text: 'Line one\nسطر', pages: 12, pageRotations: [0, 90], rotatedPages: 1, orientationNote: null }),
    );
    const out = await nativeOcr(provider, pdf, { fetchImpl, language: 'ar-SA', timeoutSeconds: 600, idempotencyKey: 'tasks-ocr-f1-abc' });
    expect(out).toMatchObject({ text: 'Line one\nسطر', pages: 12, rotatedPages: 1, jobId: 'JOB-O1' });
    const call = calls[0]!;
    expect(call.url).toBe('https://ai.mico360.com:5310/api/v1/ocr');
    expect(headerOf(call, 'x-mico-api-key')).toBe(provider.apiKey);
    expect(headerOf(call, 'idempotency-key')).toBe('tasks-ocr-f1-abc');
    const type = headerOf(call, 'content-type')!;
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
    const body = Buffer.from(call.init!.body as Uint8Array).toString('latin1');
    expect(body).toContain('name="file"; filename="Site report B.pdf"');
    expect(body).toContain('Content-Type: application/pdf');
    expect(body).toContain('%PDF-1.7 scanned');
    expect(body).toMatch(/name="language"\r\n\r\nar-SA\r\n/);
    expect(body).toMatch(/name="timeoutSeconds"\r\n\r\n600\r\n/);
  });
  it('no language: the field is left out (the node reads with its own languages)', async () => {
    const { calls, fetchImpl } = recorder(() => json(200, { jobId: 'J', text: 'x', pages: 1 }));
    await nativeOcr(provider, pdf, { fetchImpl, language: null, timeoutSeconds: 300 });
    expect(Buffer.from(calls[0]!.init!.body as Uint8Array).toString('latin1')).not.toContain('name="language"');
  });
  it('a refusal is a ProviderRefusedError with the platform’s reason and ids', async () => {
    const { fetchImpl } = recorder(() => json(403, { error: "This API key may not use the 'Ocr' capability.", correlationId: 'REQ-X' }));
    const err = (await nativeOcr(provider, pdf, { fetchImpl, timeoutSeconds: 300 }).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err).toBeInstanceOf(ProviderRefusedError);
    expect(err.providerStatus).toBe(403);
    expect(err.detail).toMatch(/Ocr/);
    expect(err.correlationId).toBe('REQ-X');
  });
  it('a 504 with a job id is collected within the deadline', async () => {
    const { calls, fetchImpl } = recorder((c) =>
      c.url.endsWith('/ocr') ? json(504, { error: 'Timed out.', jobId: 'JOB-O2' }) : json(200, { jobId: 'JOB-O2', state: 'Completed', output: 'All the pages' }),
    );
    const out = await nativeOcr(provider, pdf, { fetchImpl, timeoutSeconds: 300, collectUntil: Date.now() + 60_000, sleep: async () => {} });
    expect(out.text).toBe('All the pages');
    expect(calls.map((c) => c.url.replace('https://ai.mico360.com:5310', ''))).toEqual(['/api/v1/ocr', '/api/v1/jobs/JOB-O2']);
  });
});
