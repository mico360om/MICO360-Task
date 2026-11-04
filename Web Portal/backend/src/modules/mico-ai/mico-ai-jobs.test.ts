import { describe, it, expect, vi } from 'vitest';
import { createMicoAiService, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, OMAR, SARA } from './mico-ai-data.fixture';
import type { ModelRequest } from './mico-ai-loop';
import { createMemoryAiJobStore } from '../ai-jobs/ai-job-store';
import { createAiJobRunner } from '../ai-jobs/ai-job-runner';
import { ProviderRefusedError } from '../ai/ai-completion';
import { AiTimeoutError } from '../ai/ai-network';

// 1.22 (§10): MICO AI answers keep running in the background as jobs — saved into the chat as if
// the page had stayed open, tried again after a time-out, a 429 or a 5xx, resumed by another server
// after a restart, joined (not asked twice) when the page sends the same message again, stopped by
// Stop — and the person who asked is told by the bell and a push when their page wasn't open.

type Reply = unknown | ((req: ModelRequest) => unknown | Promise<unknown>);
const overdueTool = { action: 'tool', name: 'search_tasks', args: { project: 'RIG', status: 'overdue' } };
const tableAnswer = { action: 'answer', text: '**3 tasks** in Rig Inspection Portal are overdue.', tables: [{ title: 'Overdue tasks', fromResult: 'r1', columns: ['key', 'title', 'assignees', 'due', 'overdueDays'] }] };
const hello = { action: 'answer', text: 'Hello.' };

function setup(replies: Reply[], opts: { retryDelaysMs?: number[]; concurrency?: number; answerTimeoutMs?: number } = {}) {
  const store = createMemoryAiJobStore();
  const repo = createMemoryMicoAiRepository(() => NOW, { hasActiveJob: (id) => [...store.rows.values()].some((j) => j.subjectId === id && j.activeKey) });
  const runner = createAiJobRunner({ store, owner: 'srv-1', retryDelaysMs: opts.retryDelaysMs ?? [15, 15, 15], concurrency: opts.concurrency });
  const told: Array<{ userId: string; type: string; title: string; body: string; entityType: string; entityId: string }> = [];
  let i = 0;
  const requests: ModelRequest[] = [];
  const model: MicoAiModel = {
    async ready() {
      return true;
    },
    startQuestion() {},
    async chat(req) {
      requests.push(req as ModelRequest);
      const r = replies[Math.min(i++, replies.length - 1)];
      const out = typeof r === 'function' ? await (r as (q: ModelRequest) => unknown)(req as ModelRequest) : r;
      if (out instanceof Error) throw out;
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  const svc = createMicoAiService({
    repo,
    tools: createMicoAiTools({ data: createMemoryMicoAiData(company()), timeZone: 'Asia/Muscat', now: () => NOW }),
    model,
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    answerTimeoutMs: opts.answerTimeoutMs,
    jobs: {
      enqueue: (j) => runner.enqueue(j),
      cancel: (kind, id) => runner.cancel(kind, id),
      watch: (kind, id) => runner.watch(kind, id),
      activeSubjects: (ids) => store.activeSubjects('mico-ai', ids),
    },
    notify: async (n) => void told.push(n),
  });
  runner.register('mico-ai', svc.jobHandler);
  return { store, repo, runner, svc, told, requests };
}

describe('MICO AI answers as background jobs (1.22)', () => {
  it('finishes with the page closed: saved into the chat as if it had stayed open, and the requester is told', async () => {
    const s = setup([overdueTool, tableAnswer]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'Which tasks are overdue in Rig Inspection?', { clientId: 'q-1' });
    expect(answer).toMatchObject({ status: 'pending', step: 'Thinking…' });
    expect(await s.store.active('mico-ai', answer.id)).toMatchObject({ requestedById: 'u-omar', input: { chatId: chat.id, question: 'Which tasks are overdue in Rig Inspection?' } });
    await s.runner.idle();
    const done = await s.svc.getMessage(OMAR, chat.id, answer.id);
    expect(done).toMatchObject({ status: 'done', text: '**3 tasks** in Rig Inspection Portal are overdue.' });
    expect(done.answer!.tables[0]!.rows).toHaveLength(3);
    expect(done.answer!.sources.map((x) => x.label)).toEqual(['RIG-14', 'RIG-9', 'RIG-21']);
    expect(s.told).toEqual([
      { userId: 'u-omar', type: 'MICO_AI_ANSWER', title: 'MICO AI answered “Which tasks are overdue in Rig Inspection?”', body: 'Open MICO AI to read the answer.', entityType: 'mico-ai-chat', entityId: chat.id },
    ]);
  });

  it('the page following the answer is not told by the bell (it shows it)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup([async () => (await held, hello)]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('pending'); // the page's poll
    release();
    await s.runner.idle();
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('done');
    expect(s.told).toEqual([]);
  });

  it('the page sending the same message again joins its turn: one question, one answer, one run', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup([async () => (await held, hello)]);
    const chat = await s.svc.createChat(OMAR, {});
    const [a, b] = await Promise.all([s.svc.ask(OMAR, chat.id, 'hi', { clientId: 'q-7' }), s.svc.ask(OMAR, chat.id, 'hi', { clientId: 'q-7' })]);
    const c = await s.svc.ask(OMAR, chat.id, 'hi', { clientId: 'q-7' });
    expect(new Set([a, b, c].map((t) => t.answer.id)).size).toBe(1);
    expect(new Set([a, b, c].map((t) => t.question.id)).size).toBe(1);
    release();
    await s.runner.idle();
    expect(s.requests).toHaveLength(1);
    expect(s.repo.messages.filter((m) => m.chatId === chat.id)).toHaveLength(2);
    // Sent again after it was answered: still the same turn, now answered.
    const late = await s.svc.ask(OMAR, chat.id, 'hi', { clientId: 'q-7' });
    expect(late.answer).toMatchObject({ id: a.answer.id, status: 'done', text: 'Hello.' });
    // Another person's chat never matches it.
    await expect(s.svc.ask(SARA, chat.id, 'hi', { clientId: 'q-7' })).rejects.toMatchObject({ status: 404 });
  });

  it('a time-out or a 429 waits and tries again — the answer says so — then answers', async () => {
    const s = setup([new AiTimeoutError(), new ProviderRefusedError(429, 'slow down'), hello], { retryDelaysMs: [60, 60, 60] });
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    await vi.waitFor(() => expect(s.repo.messages.find((m) => m.id === answer.id)!.step).toMatch(/try again in/), { timeout: 2000, interval: 2 });
    expect(s.repo.messages.find((m) => m.id === answer.id)!.step).toBe('The AI service didn’t answer, so MICO AI will try again in a moment (try 2 of 4).');
    await vi.waitFor(async () => expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('done'), { timeout: 3000 });
    await s.runner.idle();
    expect(s.requests).toHaveLength(3);
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).text).toBe('Hello.');
  });

  it('after the last try the answer shows the error and the requester is told', async () => {
    const s = setup([new ProviderRefusedError(503, null)]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'Which tasks are overdue?');
    await vi.waitFor(() => expect(s.repo.messages.find((m) => m.id === answer.id)!.status).toBe('ERROR'), { timeout: 3000 });
    await s.runner.idle();
    expect(s.requests).toHaveLength(4);
    const message = 'The AI service has no model available right now (HTTP 503). Try again in a minute, or ask an admin to check AI Management.';
    expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'error', error: message });
    expect(s.told).toEqual([{ userId: 'u-omar', type: 'MICO_AI_FAILED', title: 'MICO AI couldn’t answer “Which tasks are overdue?”', body: message, entityType: 'mico-ai-chat', entityId: chat.id }]);
  });

  it('a reply that can’t be read, or an answer that takes too long, is said at once (no retry)', async () => {
    const s = setup(['not json at all']);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    await s.runner.idle();
    expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'error', error: 'MICO AI’s reply couldn’t be read. Try again, or ask in a different way.' });
    const slow = setup([(req: ModelRequest) => new Promise((_r, reject) => req.signal!.addEventListener('abort', () => reject(new Error('aborted'))))], { answerTimeoutMs: 30 });
    const c2 = await slow.svc.createChat(OMAR, {});
    const { answer: a2 } = await slow.svc.ask(OMAR, c2.id, 'everything ever');
    await slow.runner.idle();
    expect(await slow.svc.getMessage(OMAR, c2.id, a2.id)).toMatchObject({ status: 'error', error: 'MICO AI took too long to answer, so it stopped. Try a narrower question, for example one project or one week.' });
    expect(slow.requests).toHaveLength(1);
  });

  it('Stop cancels the job: the AI call is aborted, nothing it says later is kept, nobody is told', async () => {
    let signal: AbortSignal | undefined;
    const s = setup([(req: ModelRequest) => new Promise((_r, reject) => ((signal = req.signal), req.signal!.addEventListener('abort', () => reject(new Error('aborted')))))]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect((await s.svc.stop(OMAR, chat.id, answer.id)).status).toBe('stopped');
    expect(signal!.aborted).toBe(true);
    await s.runner.idle();
    expect((await s.store.latest('mico-ai', answer.id))!.status).toBe('CANCELLED');
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('stopped');
    expect(s.told).toEqual([]);
    // The chat is free again.
    await expect(s.svc.ask(OMAR, chat.id, 'again')).resolves.toBeTruthy();
  });

  it('an answer waiting for its next try is never “interrupted”, and keeps the chat busy', async () => {
    const s = setup([new AiTimeoutError(), hello], { retryDelaysMs: [60_000, 60_000, 60_000] });
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    await vi.waitFor(async () => expect((await s.store.active('mico-ai', answer.id))?.status).toBe('QUEUED'), { timeout: 2000 });
    // Untouched for ten minutes (a long wait), as a restart would leave an answer without a job.
    s.repo.messages.find((m) => m.id === answer.id)!.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    expect(await s.svc.interruptStale()).toBe(0);
    expect((await s.svc.getChat(OMAR, chat.id)).messages.find((m) => m.id === answer.id)).toMatchObject({ status: 'pending' });
    await expect(s.svc.ask(OMAR, chat.id, 'another')).rejects.toMatchObject({ status: 409 });
    s.runner.stop();
  });

  it('a server that stopped before answering: another server takes the job and answers', async () => {
    const s = setup([hello], { concurrency: 0 }); // this server takes no jobs (it "stopped")
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'hi');
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('pending');
    const other = createAiJobRunner({ store: s.store, owner: 'srv-2' });
    other.register('mico-ai', s.svc.jobHandler);
    await other.sweep();
    await other.idle();
    expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'done', text: 'Hello.' });
  });
});
