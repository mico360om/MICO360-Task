import { describe, it, expect, vi } from 'vitest';
import { createAiFeatureService, AI_SEARCH_COLD_BUDGET_MS, AI_SEARCH_WARM_BUDGET_MS } from './ai-feature-service';
import { createMemoryAiConfigRepository } from './ai-config-repository';
import type { AiConfig, AiModel } from './ai-config';
import { AGENDA_SCHEMA, MEETING_SCHEMA, MINUTES_SCHEMA, PRIORITY_SCHEMA, TASK_SCHEMA } from './ai-schemas';

const KEY = 'mico_' + 'ef56'.repeat(12);
const model = (over: Partial<AiModel>): AiModel => ({
  id: 'm1',
  providerId: 'pr1',
  modelKey: 'llama3.1:latest',
  displayName: 'Llama 3.1',
  capabilities: ['chat'],
  parameters: {},
  concurrencyLimit: 4,
  enabled: true,
  available: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const micoConfig = (over: { platform?: AiConfig['providers'][number]['platform']; models?: AiModel[]; defaults?: AiConfig['defaults']; preset?: 'mico360' | 'custom'; base?: string } = {}): AiConfig => ({
  providers: [
    { id: 'pr1', name: 'MICO360 AI', kind: 'custom', preset: over.preset ?? 'mico360', apiBaseUrl: over.base ?? 'https://ai.mico360.com:5310/v1', apiKey: KEY, enabled: true, createdAt: '', updatedAt: '', ...(over.platform ? { platform: over.platform } : {}) },
  ],
  models: over.models ?? [model({}), model({ id: 'ocr', modelKey: 'glm-ocr:latest', displayName: 'GLM-OCR', capabilities: ['vision', 'ocr', 'document'] })],
  defaults: over.defaults ?? { chat: 'm1', ocr: 'ocr' },
});

type Call = { url: string; path: string; headers: Headers; body: Record<string, unknown> | null; raw: string };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const chatOk = (content: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => json(200, { id: 'JOB-1', model: 'llama3.1:latest', choices: [{ message: { content } }], ...extra }, headers);
function platform(answer: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const raw = init?.body === undefined ? '' : typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString('latin1');
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const c = { url: String(url), path: String(url).replace(/^https:\/\/[^/]+/, ''), headers: new Headers(init?.headers), body, raw };
    calls.push(c);
    return answer(c, calls.length);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const make = (cfg: AiConfig, answer: (c: Call, n: number) => Response | Promise<Response>, extra: Partial<Parameters<typeof createAiFeatureService>[0]> = {}) => {
  const p = platform(answer);
  const repo = createMemoryAiConfigRepository(cfg);
  const logger = { error: vi.fn(), warn: vi.fn() };
  const svc = createAiFeatureService({ repo, fetchImpl: p.fetchImpl, logger, ...extra });
  return { svc, repo, logger, ...p };
};
const requester = { userId: 'cuser42', roles: ['ADMIN'] };

describe('b1: answers held to their JSON Schema on MICO360 AI', () => {
  it('describe a task, describe a meeting, priority, agenda and minutes each send their own schema', async () => {
    const t = make(micoConfig(), () => chatOk('{"title":"T","priority":"HIGH","reason":"r","items":[{"title":"A","ownerId":null,"minutes":5}],"summary":"s"}'));
    await t.svc.parseTask({ text: 'call the bank', today: '2026-11-11' }, requester);
    await t.svc.parseMeeting({ text: 'pump review tomorrow', today: '2026-11-11' }, requester);
    await t.svc.suggestPriority({ title: 'X' }, requester);
    await t.svc.draftAgenda({ title: 'M', minutes: 30, people: [], tasks: [], leftovers: [] }, requester);
    await t.svc.draftMinutes('Meeting: X', requester);
    expect(t.calls.map((c) => (c.body!.response_format as { json_schema?: { name: string } }).json_schema?.name)).toEqual([TASK_SCHEMA.name, MEETING_SCHEMA.name, PRIORITY_SCHEMA.name, AGENDA_SCHEMA.name, MINUTES_SCHEMA.name]);
    expect(t.calls[0]!.body!.response_format).toEqual({ type: 'json_schema', json_schema: TASK_SCHEMA });
  });

  it('the checklist and the description keep asking for any JSON object; the summary for text', async () => {
    const t = make(micoConfig(), () => chatOk('{"steps":["A"],"description":"d"}'));
    await t.svc.breakdownTask({ title: 'X' }, requester);
    await t.svc.writeMeetingDescription({ title: 'X' }, requester);
    expect(t.calls.map((c) => c.body!.response_format)).toEqual([{ type: 'json_object' }, { type: 'json_object' }]);
  });

  it('today’s reading of the answer is still the second check (an answer outside the list is not used)', async () => {
    const t = make(micoConfig(), () => chatOk('{"priority":"SOMEDAY","reason":"x"}'));
    expect((await t.svc.suggestPriority({ title: 'X' }, requester)).priority).toBe('NORMAL');
  });
});

describe('b6: the Tasks user goes as `user`', () => {
  it('a feature asked by a person, and MICO AI’s calls', async () => {
    const t = make(micoConfig(), () => chatOk('{"priority":"LOW","reason":"r"}'));
    await t.svc.suggestPriority({ title: 'X' }, requester);
    await t.svc.chat({ system: 's', prompt: 'p' }, { userId: 'cuser7' });
    expect(t.calls.map((c) => c.body!.user)).toEqual(['cuser42', 'cuser7']);
  });
  it('AI search passes its viewer without counting a limit', async () => {
    const t = make(micoConfig(), () => chatOk('{}'), { limits: { perMinute: 1, perDay: 1 } });
    await t.svc.chat({ system: 's', prompt: 'p', user: 'cviewer' });
    await t.svc.chat({ system: 's', prompt: 'p', user: 'cviewer' });
    expect(t.calls.map((c) => c.body!.user)).toEqual(['cviewer', 'cviewer']);
  });
});

describe('b2, b3: background work on MICO360 AI', () => {
  it('the Final MOM job’s tries carry the same Idempotency-Key for the same request', async () => {
    const t = make(micoConfig(), () => chatOk('{"summary":"s"}'));
    await t.svc.draftMinutes('Meeting: X', requester, { background: true, jobId: 'job_abc' });
    await t.svc.draftMinutes('Meeting: X', requester, { background: true, jobId: 'job_abc' });
    const keys = t.calls.map((c) => c.headers.get('idempotency-key'));
    expect(keys[0]).toMatch(/^tasks-mom-job_abc-[0-9a-f]{40}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('MICO AI’s steps carry their job’s key', async () => {
    const t = make(micoConfig(), () => chatOk('{}'));
    await t.svc.chat({ system: 's', prompt: 'p', idempotencyKey: 'tasks-ai-job9' }, { userId: 'u' });
    expect(t.calls[0]!.headers.get('idempotency-key')).toMatch(/^tasks-ai-job9-/);
  });

  it('a person waiting at a page sends none', async () => {
    const t = make(micoConfig(), () => chatOk('{"summary":"s"}'));
    await t.svc.draftMinutes('Meeting: X', requester);
    expect(t.calls[0]!.headers.get('idempotency-key')).toBeNull();
  });

  it('the Final MOM job collects a job the platform kept after its 504', async () => {
    const t = make(
      micoConfig(),
      (c) =>
        c.path === '/v1/chat/completions'
          ? json(504, { error: { message: 'The request did not complete within 300 seconds (job JOB-GW1-9, correlation id REQ-9).', type: 'timeout', code: null } })
          : json(200, { jobId: 'JOB-GW1-9', state: 'Completed', output: '{"summary":"collected"}' }),
      { sleep: async () => {} },
    );
    expect(await t.svc.draftMinutes('Meeting: X', requester, { background: true, jobId: 'j1' })).toEqual({ summary: 'collected' });
    expect(t.calls[1]!.path).toBe('/api/v1/jobs/JOB-GW1-9');
  });
});

describe('b11: one concurrency limit for the whole MICO360 AI key', () => {
  it('two models share the key’s budget (here 1): the second call waits for the first', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const t = make(micoConfig({ platform: { concurrencyLimit: 1 } }), async (c) => {
      const what = (c.body?.model as string) ?? c.path;
      order.push(`start ${what}`);
      if (what === 'llama3.1:latest') await held;
      order.push(`end ${what}`);
      return chatOk('{"steps":["A"]}');
    });
    const first = t.svc.breakdownTask({ title: 'X' }, requester);
    await vi.waitFor(() => expect(order).toEqual(['start llama3.1:latest']));
    const second = t.svc.readPictures([{ data: Buffer.from('jpeg'), mimeType: 'image/jpeg' }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['start llama3.1:latest']); // the picture waits for the key's one slot
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start llama3.1:latest', 'end llama3.1:latest', 'start glm-ocr:latest', 'end glm-ocr:latest']);
  });

  it('the budget follows what the platform says (X-Mico-Concurrency-Limit)', async () => {
    let inFlight = 0;
    let most = 0;
    const t = make(micoConfig({ platform: { concurrencyLimit: 1 } }), async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return chatOk('{"steps":["A"]}', {}, { 'x-mico-concurrency-limit': '3' });
    });
    await t.svc.breakdownTask({ title: 'first' }, requester); // learns 3
    most = 0;
    await Promise.all([1, 2, 3].map((i) => t.svc.breakdownTask({ title: `t${i}` }, requester)));
    expect(most).toBe(3);
  });

  it('other providers keep only each model’s own limit', async () => {
    let inFlight = 0;
    let most = 0;
    const t = make(micoConfig({ preset: 'custom', base: 'https://ai.example.com/v1', platform: { concurrencyLimit: 1 } }), async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return chatOk('{"steps":["A"]}');
    });
    await Promise.all([1, 2].map((i) => t.svc.breakdownTask({ title: `t${i}` }, requester)));
    expect(most).toBe(2);
  });
});

describe('b5: stand-ins are logged on the provider', () => {
  it('another model answering is noted (asked, answered, how often), once per pair every 10 minutes', async () => {
    let clock = Date.parse('2026-11-11T08:00:00Z');
    const t = make(
      micoConfig(),
      () => chatOk('{"steps":["A"]}', { model: 'qwen2.5:0.5b', warning: "Requested model 'llama3.1:latest' is unavailable; processing on 'qwen2.5:0.5b' instead." }),
      { now: () => new Date(clock) },
    );
    await t.svc.breakdownTask({ title: 'X' }, requester);
    await t.svc.breakdownTask({ title: 'Y' }, requester);
    clock += 11 * 60_000;
    await t.svc.breakdownTask({ title: 'Z' }, requester);
    await vi.waitFor(async () => expect((await t.repo.load()).providers[0]!.platform?.substitutions?.[0]).toMatchObject({ asked: 'llama3.1:latest', answered: 'qwen2.5:0.5b', count: 2 }));
  });
});

describe('b10: MICO360 AI failures are logged with their ids', () => {
  it('a refusal reaches the log with the correlation and job ids (never the key)', async () => {
    const t = make(micoConfig(), () => json(503, { error: { message: "No connected node provides the 'Chat' capability." } }, { 'x-mico-correlation-id': 'REQ-55', 'retry-after': '30' }));
    await expect(t.svc.suggestPriority({ title: 'X' }, requester)).rejects.toThrow(/HTTP 503/);
    expect(t.logger.error).toHaveBeenCalledTimes(1);
    const [message, ctx] = t.logger.error.mock.calls[0]!;
    expect(message).toBe('MICO360 AI: suggest priority failed'); // one Error log row per feature
    expect(ctx).toMatchObject({ feature: 'suggest priority', err: expect.objectContaining({ correlationId: 'REQ-55' }) });
    expect(JSON.stringify(ctx)).not.toContain(KEY);
  });

  it('a busy moment or a used-up quota is not an error to log', async () => {
    const t = make(micoConfig(), () => json(429, { error: { message: 'Quota exceeded: tokens per day.' } }, { 'retry-after': '40000' }));
    await expect(t.svc.suggestPriority({ title: 'X' }, requester)).rejects.toThrow(/allowance/);
    expect(t.logger.error).not.toHaveBeenCalled();
  });

  it('AI search logs its own failures (not twice)', async () => {
    const t = make(micoConfig(), () => json(502, { error: { message: 'boom' } }));
    await expect(t.svc.chat({ system: 's', prompt: 'p', quiet: true })).rejects.toThrow(/HTTP 502/);
    expect(t.logger.error).not.toHaveBeenCalled();
  });
});

describe('b13: the first AI search of the day', () => {
  it('a cold MICO360 AI chat model gets a light warm-up (not counted against anyone) and the long budget', async () => {
    const t = make(micoConfig(), () => chatOk('OK'));
    expect(await t.svc.searchBudgetMs()).toBe(AI_SEARCH_COLD_BUDGET_MS);
    t.svc.warmUp();
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.calls[0]!.body).toMatchObject({ model: 'llama3.1:latest', max_tokens: 1 });
    expect(t.calls[0]!.body).not.toHaveProperty('user');
    t.svc.warmUp(); // already warm: nothing more
    await new Promise((r) => setTimeout(r, 20));
    expect(t.calls).toHaveLength(1);
    expect(await t.svc.searchBudgetMs()).toBe(AI_SEARCH_WARM_BUDGET_MS);
  });

  it('after 25 minutes without an answer it is cold again', async () => {
    let clock = Date.parse('2026-11-11T08:00:00Z');
    const t = make(micoConfig(), () => chatOk('{"steps":["A"]}'), { now: () => new Date(clock) });
    await t.svc.breakdownTask({ title: 'X' }, requester);
    expect(await t.svc.searchBudgetMs()).toBe(AI_SEARCH_WARM_BUDGET_MS);
    clock += 26 * 60_000;
    expect(await t.svc.searchBudgetMs()).toBe(AI_SEARCH_COLD_BUDGET_MS);
  });

  it('other providers: no warm-up, the usual budget', async () => {
    const t = make(micoConfig({ preset: 'custom', base: 'https://ai.example.com/v1' }), () => chatOk('OK'));
    t.svc.warmUp();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.calls).toHaveLength(0);
    expect(await t.svc.searchBudgetMs()).toBe(AI_SEARCH_WARM_BUDGET_MS);
  });
});

describe('b15: MICO AI’s live text', () => {
  it('a call with a listener goes to the native live stream', async () => {
    const enc = new TextEncoder();
    const t = make(micoConfig(), () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('event: chunk\ndata: {"sequence":0,"text":"Hello","jobId":"J"}\n\n'));
            c.enqueue(enc.encode('event: done\ndata: {"reason":"completed","chunks":1,"jobId":"J"}\n\n'));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const seen: string[] = [];
    expect(await t.svc.chat({ system: 's', prompt: 'p', onText: (x) => seen.push(x) }, { userId: 'u' })).toBe('Hello');
    expect(t.calls[0]!.path).toBe('/api/v1/chat/stream');
    expect(seen).toEqual(['Hello']);
  });
});

describe('b4, b8: reading scans and pictures', () => {
  const pdf = { data: Buffer.from('%PDF-1.4 scan'), mimeType: 'application/pdf', filename: 'scan.pdf' };
  const pictures = async () => [
    { data: Buffer.from('p1'), mimeType: 'image/jpeg' },
    { data: Buffer.from('p2'), mimeType: 'image/jpeg' },
  ];

  it('MICO360 AI reads the whole document with POST /api/v1/ocr (language, key, the native header)', async () => {
    const t = make(micoConfig(), () => json(200, { jobId: 'JOB-O', text: 'Page one\nPage two', pages: 2 }));
    expect(await t.svc.readDocument(pdf, { language: 'ar-SA', key: 'tasks-ocr-f1', pictures })).toEqual({ text: 'Page one\nPage two', pages: 2, whole: true });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.path).toBe('/api/v1/ocr');
    expect(t.calls[0]!.headers.get('x-mico-api-key')).toBe(KEY);
    expect(t.calls[0]!.headers.get('idempotency-key')).toMatch(/^tasks-ocr-f1-[0-9a-f]{40}$/);
    expect(t.calls[0]!.raw).toContain('ar-SA');
  });

  for (const status of [403, 404, 503]) {
    it(`a ${status} falls back to the picture reader — GLM-OCR’s way: one picture a request, “Text Recognition:”, no instructions — with a note for the admin`, async () => {
      const t = make(micoConfig(), (c) => (c.path === '/api/v1/ocr' ? json(status, { error: `refused ${status}` }) : chatOk(c.body!.messages ? `text of ${(c.body!.messages as Array<{ content: Array<{ image_url?: { url: string } }> }>)[0]!.content[1]!.image_url!.url.slice(-4)}` : 'x')));
      const out = await t.svc.readDocument(pdf, { language: null, pictures });
      expect(out.text).toBe(`text of ${Buffer.from('p1').toString('base64').slice(-4)}\n\ntext of ${Buffer.from('p2').toString('base64').slice(-4)}`);
      const chats = t.calls.filter((c) => c.path === '/v1/chat/completions');
      expect(chats).toHaveLength(2);
      for (const c of chats) {
        const messages = c.body!.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe('user');
        expect(messages[0]!.content.filter((x) => x.type === 'image_url')).toHaveLength(1);
        expect(messages[0]!.content.find((x) => x.type === 'text')!.text).toBe('Text Recognition:');
      }
      await vi.waitFor(async () => expect((await t.repo.load()).providers[0]!.platform?.ocrFallback).toMatchObject({ status, reason: `refused ${status}` }));
    });
  }

  it('after a refusal, whole-document reading is paused a while (no upload each time), then tried again and the note cleared', async () => {
    let clock = Date.parse('2026-11-11T08:00:00Z');
    let refuse = true;
    const t = make(micoConfig(), (c) => (c.path === '/api/v1/ocr' ? (refuse ? json(403, { error: 'no Ocr' }) : json(200, { text: 'whole', pages: 1 })) : chatOk('picture text')), { now: () => new Date(clock) });
    await t.svc.readDocument(pdf, { pictures });
    await t.svc.readDocument(pdf, { pictures });
    expect(t.calls.filter((c) => c.path === '/api/v1/ocr')).toHaveLength(1);
    refuse = false;
    clock += 61 * 60_000;
    expect((await t.svc.readDocument(pdf, { pictures })).text).toBe('whole');
    await vi.waitFor(async () => expect((await t.repo.load()).providers[0]!.platform?.ocrFallback ?? null).toBeNull());
  });

  it('a language the node has no OCR pack for is tried again at once without one', async () => {
    const t = make(micoConfig(), (_c, n) => (n === 1 ? json(502, { error: "Windows has no OCR language matching 'ar-SA' installed on this machine." }) : json(200, { text: 'read anyway', pages: 1 })));
    expect((await t.svc.readDocument(pdf, { language: 'ar-SA', pictures })).text).toBe('read anyway');
    expect(t.calls[0]!.raw).toContain('ar-SA');
    expect(t.calls[1]!.raw).not.toContain('name="language"');
  });

  it('a picture type the platform does not read (WebP) goes to the picture reader directly', async () => {
    const t = make(micoConfig(), () => chatOk('webp text'));
    await t.svc.readDocument({ data: Buffer.from('RIFF....WEBP'), mimeType: 'image/webp', filename: 'a.webp' }, { pictures: async () => [{ data: Buffer.from('w'), mimeType: 'image/webp' }] });
    expect(t.calls.map((c) => c.path)).toEqual(['/v1/chat/completions']);
  });

  it('other providers read pictures as before (one request, the instructions)', async () => {
    const t = make(micoConfig({ preset: 'custom', base: 'https://ai.example.com/v1' }), () => chatOk('as before'));
    expect((await t.svc.readDocument(pdf, { pictures })).text).toBe('as before');
    expect(t.calls).toHaveLength(1);
    expect((t.calls[0]!.body!.messages as Array<{ role: string }>)[0]!.role).toBe('system');
  });
});
