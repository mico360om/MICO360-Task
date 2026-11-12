import { describe, it, expect, vi } from 'vitest';
import { AiTimeoutError } from '../ai/ai-network';
import { createMicoAiService, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, OMAR } from './mico-ai-data.fixture';
import type { ModelRequest } from './mico-ai-loop';
import { createMemoryAiJobStore } from '../ai-jobs/ai-job-store';
import { createAiJobRunner } from '../ai-jobs/ai-job-runner';
import { MICO_AI_ACTION_SCHEMA } from '../ai/ai-schemas';

// (b) bundles, b15: on MICO360 AI the answer's words appear on the page as the model writes them. The
// answer is written in the background (any server), so the words so far are kept on the pending answer
// (a few times a second at most) and the page's poll shows them; the finished answer replaces them.

type Reply = (req: ModelRequest) => unknown | Promise<unknown>;
function setup(replies: Reply[], retryDelaysMs: number[] = [15, 15, 15]) {
  const store = createMemoryAiJobStore();
  const repo = createMemoryMicoAiRepository(() => NOW, { hasActiveJob: (id) => [...store.rows.values()].some((j) => j.subjectId === id && j.activeKey) });
  const runner = createAiJobRunner({ store, owner: 'srv-1', retryDelaysMs });
  const requests: Array<{ req: ModelRequest & { idempotencyKey?: string }; userId: string }> = [];
  let i = 0;
  const model: MicoAiModel = {
    ready: async () => true,
    startQuestion() {},
    async chat(req, userId) {
      requests.push({ req: req as ModelRequest, userId });
      const out = await replies[Math.min(i++, replies.length - 1)]!(req as ModelRequest);
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  const svc = createMicoAiService({
    repo,
    tools: createMicoAiTools({ data: createMemoryMicoAiData(company()), timeZone: 'Asia/Muscat', now: () => NOW }),
    model,
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    draftEveryMs: 0,
    jobs: {
      enqueue: (j) => runner.enqueue(j),
      cancel: (kind, id) => runner.cancel(kind, id),
      watch: (kind, id) => runner.watch(kind, id),
      activeSubjects: (ids) => store.activeSubjects('mico-ai', ids),
    },
  });
  runner.register('mico-ai', svc.jobHandler);
  return { store, repo, runner, svc, requests };
}

describe('MICO AI: the answer’s words as they are written (b15)', () => {
  it('the pending answer shows the words so far; the finished answer replaces them', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const full = '{"action":"answer","text":"Hello Omar, nothing is overdue."}';
    const s = setup([
      async (req) => {
        req.onText?.(full.slice(0, 32));
        await held;
        req.onText?.(full);
        return full;
      },
    ]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'Anything overdue?', { clientId: 'q-live' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'pending', draft: 'Hello' });
    release();
    await s.runner.idle();
    const done = await s.svc.getMessage(OMAR, chat.id, answer.id);
    expect(done).toMatchObject({ status: 'done', text: 'Hello Omar, nothing is overdue.' });
    expect(done).not.toHaveProperty('draft');
  });

  it('each step is held to the action schema and carries its job’s Idempotency-Key scope and the person', async () => {
    const s = setup([() => ({ action: 'answer', text: 'Hi.' })]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'Hi', { clientId: 'q-key' });
    await s.runner.idle();
    const job = await s.store.latest('mico-ai', answer.id);
    expect(s.requests[0]!.req.schema).toBe(MICO_AI_ACTION_SCHEMA);
    expect(s.requests[0]!.req.idempotencyKey).toBe(`tasks-ai-${job!.id}`);
    expect(s.requests[0]!.userId).toBe(OMAR.userId);
  });

  it('a tool step shows no words (the progress line does), and a new call starts empty', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup([
      (req) => {
        req.onText?.('{"action":"answer","text":"There are 5');
        return { action: 'answer', text: 'There are 5 overdue.' }; // figures with no data: sent back once
      },
      async (req) => {
        req.onText?.('{"action":"tool","name":"search_tasks"');
        await held;
        return { action: 'tool', name: 'search_tasks', args: { project: 'RIG', status: 'overdue' } };
      },
      () => ({ action: 'answer', text: 'Done.' }),
    ]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'How many are overdue?', { clientId: 'q-tool' });
    await new Promise((r) => setTimeout(r, 20));
    const pending = await s.svc.getMessage(OMAR, chat.id, answer.id);
    expect(pending.status).toBe('pending');
    expect(pending.draft ?? null).toBeNull();
    release();
    await s.runner.idle();
    expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'done', text: 'Done.' });
  });
});

// Review I1: a try that fails after some words were shown leaves no "Writing…" behind while it waits.
describe('MICO AI: a try that waits shows its progress line, not old words', () => {
  it('the words are cleared when the try waits for its next go', async () => {
    const s = setup([
      async (req) => {
        req.onText?.('{"action":"answer","text":"Half an ans');
        throw new AiTimeoutError();
      },
      () => ({ action: 'answer', text: 'The whole answer.' }),
    ], [400, 400, 400]);
    const chat = await s.svc.createChat(OMAR, {});
    const { answer } = await s.svc.ask(OMAR, chat.id, 'Anything?', { clientId: 'q-wait' });
    await vi.waitFor(async () => expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).step).toMatch(/try again/));
    expect((await s.svc.getMessage(OMAR, chat.id, answer.id)).draft ?? null).toBeNull();
    // The next try starts after its wait (a timer), then writes the answer.
    await vi.waitFor(async () => expect(await s.svc.getMessage(OMAR, chat.id, answer.id)).toMatchObject({ status: 'done', text: 'The whole answer.' }), { timeout: 3000 });
  });
});
