import { describe, it, expect } from 'vitest';
import { NativeStreamUnavailable, streamChat } from './mico360-stream';
import { ProviderRefusedError } from './ai-errors';
import { AiCallStoppedError, AiTimeoutError } from './ai-network';

const provider = { preset: 'mico360' as const, apiBaseUrl: 'https://ai.mico360.com:5310/v1', apiKey: 'mico_' + 'cd34'.repeat(12) };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const sse = (events: Array<[string, unknown]>, opts: { split?: boolean; signal?: AbortSignal; hang?: boolean } = {}) => {
  const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Delivered in small pieces (an event may arrive split across reads, even inside a character).
      const bytes = enc.encode(text);
      const step = opts.split ? 7 : bytes.length;
      for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
      if (opts.hang) {
        opts.signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-mico-correlation-id': 'REQ-S1' } });
};
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
const base = { timeoutMs: 60_000, collectUntil: Date.now() + 60_000, sleep: async () => {} };
const chunk = (sequence: number, text: string) => ['chunk', { sequence, text, jobId: 'JOB-S' }] as [string, unknown];
const done = (reason: string, chunks: number, extra: Record<string, unknown> = {}) => ['done', { reason, chunks, jobId: 'JOB-S', correlationId: 'REQ-S1', ...extra }] as [string, unknown];

describe('streamChat — POST /api/v1/chat/stream (guide §5, b15)', () => {
  it('sends the /chat body with the native key header and reads the text as it is written', async () => {
    const { calls, fetchImpl } = recorder(() => sse([chunk(0, 'Pa'), chunk(1, 'ris'), chunk(2, '. مرحبا'), done('completed', 3)], { split: true }));
    const seen: string[] = [];
    const out = await streamChat(
      provider,
      { prompt: 'Capital of France?', system: 'One word.', model: 'qwen2.5:0.5b', user: 'user-1', format: { type: 'object' }, timeoutSeconds: 120 },
      { ...base, fetchImpl, idempotencyKey: 'tasks-ai-job1-x', onText: (t) => seen.push(t) },
    );
    expect(out).toMatchObject({ text: 'Paris. مرحبا', jobId: 'JOB-S', correlationId: 'REQ-S1', reason: 'completed', collected: false });
    expect(seen).toEqual(['Pa', 'Paris', 'Paris. مرحبا']);
    const call = calls[0]!;
    expect(call.url).toBe('https://ai.mico360.com:5310/api/v1/chat/stream');
    const h = new Headers(call.init!.headers);
    expect(h.get('x-mico-api-key')).toBe(provider.apiKey);
    expect(h.get('authorization')).toBeNull();
    expect(h.get('idempotency-key')).toBe('tasks-ai-job1-x');
    expect(h.get('accept')).toBe('text/event-stream');
    expect(JSON.parse(String(call.init!.body))).toEqual({ prompt: 'Capital of France?', system: 'One word.', model: 'qwen2.5:0.5b', user: 'user-1', format: { type: 'object' }, timeoutSeconds: 120 });
  });

  it('a missing sequence number is a lost chunk: the whole answer is collected from the job', async () => {
    const { calls, fetchImpl } = recorder((c) =>
      c.url.endsWith('/stream') ? sse([chunk(0, 'Hel'), chunk(2, 'world'), done('completed', 3)]) : json(200, { jobId: 'JOB-S', state: 'Completed', output: 'Hello world' }),
    );
    const seen: string[] = [];
    const out = await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl, onText: (t) => seen.push(t) });
    expect(out.text).toBe('Hello world');
    expect(out.collected).toBe(true);
    expect(seen).toEqual(['Hel']); // nothing after the gap is shown as if it followed
    expect(calls[1]!.url).toBe('https://ai.mico360.com:5310/api/v1/jobs/JOB-S');
  });

  for (const reason of ['timed_out', 'client_too_slow', 'switched_to_artifact']) {
    it(`done "${reason}": the job runs on, so it is collected`, async () => {
      const { fetchImpl } = recorder((c) => (c.url.endsWith('/stream') ? sse([chunk(0, 'part'), done(reason, 1)]) : json(200, { jobId: 'JOB-S', state: 'Completed', output: 'the whole answer' })));
      const out = await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl });
      expect(out).toMatchObject({ text: 'the whole answer', collected: true, reason });
    });
  }

  it('done "failed": the job’s own error, as a 502 refusal with its ids', async () => {
    const { fetchImpl } = recorder((c) => (c.url.endsWith('/stream') ? sse([done('failed', 0)]) : json(200, { jobId: 'JOB-S', state: 'Failed', error: 'The model ran out of memory.' })));
    const err = (await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl }).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err).toBeInstanceOf(ProviderRefusedError);
    expect(err.providerStatus).toBe(502);
    expect(err.detail).toBe('The model ran out of memory.');
    expect(err.jobId).toBe('JOB-S');
  });

  it('a stream cut before "done" is collected from its job', async () => {
    const { fetchImpl } = recorder((c) => (c.url.endsWith('/stream') ? sse([chunk(0, 'Half')]) : json(200, { jobId: 'JOB-S', state: 'Completed', output: 'Half and the rest' })));
    expect((await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl })).text).toBe('Half and the rest');
  });

  it('a repeat of a request still being answered (409) collects that job', async () => {
    const { fetchImpl } = recorder((c) =>
      c.url.endsWith('/stream') ? json(409, { error: 'An identical request is still being answered.', jobId: 'JOB-FIRST' }, { 'retry-after': '2' }) : json(200, { jobId: 'JOB-FIRST', state: 'Completed', output: 'first answer' }),
    );
    expect((await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl })).text).toBe('first answer');
  });

  it('a server without the native stream (404, 405) says so, so the caller uses /v1', async () => {
    for (const status of [404, 405]) {
      const { fetchImpl } = recorder(() => new Response(null, { status }));
      await expect(streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl })).rejects.toBeInstanceOf(NativeStreamUnavailable);
    }
  });

  it('other refusals before the stream are ordinary MICO360 AI refusals', async () => {
    const { fetchImpl } = recorder(() => json(403, { error: "This API key may not use the 'Chat' capability." }, { 'x-mico-correlation-id': 'REQ-F' }));
    const err = (await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl }).catch((e: unknown) => e)) as ProviderRefusedError;
    expect(err.providerStatus).toBe(403);
    expect(err.message).toMatch(/may not be used for this \(HTTP 403\)/);
    expect(err.correlationId).toBe('REQ-F');
  });

  it('Stop ends it at once (the platform finishes the job on its own)', async () => {
    const stop = new AbortController();
    const { calls, fetchImpl } = recorder(() => sse([chunk(0, 'Some')], { hang: true, signal: stop.signal }));
    const seen: string[] = [];
    const run = streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl, signal: stop.signal, onText: (t) => { seen.push(t); stop.abort(); } });
    await expect(run).rejects.toBeInstanceOf(AiCallStoppedError);
    expect(calls).toHaveLength(1); // no collecting after a stop
  });

  it('our own time running out mid-stream collects the job until the deadline, then is a time-out', async () => {
    const ours = new AbortController();
    let t = 0;
    const { fetchImpl } = recorder((c) => (c.url.endsWith('/stream') ? sse([chunk(0, 'x')], { hang: true, signal: ours.signal }) : json(200, { jobId: 'JOB-S', state: 'Running' })));
    // The fake fetch hangs until aborted; abort it as our timeout would.
    setTimeout(() => ours.abort(), 10);
    const err = await streamChat(provider, { prompt: 'p', timeoutSeconds: 120 }, { ...base, fetchImpl, timeoutSignal: ours.signal, collectUntil: 3_000, now: () => t, sleep: async (ms: number) => void (t += ms) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiTimeoutError);
    expect((err as AiTimeoutError).jobId).toBe('JOB-S');
  });
});
