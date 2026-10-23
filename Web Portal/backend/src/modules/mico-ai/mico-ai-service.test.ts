import { describe, it, expect } from 'vitest';
import { createMicoAiService, NOT_READY, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, OMAR, SARA, ADMIN } from './mico-ai-data.fixture';
import { ProviderRefusedError } from '../ai/ai-completion';
import type { ModelRequest } from './mico-ai-loop';
import { createAiUsageLimiter } from '../ai/ai-limits';
import { vi } from 'vitest';

type Reply = unknown | ((req: ModelRequest) => unknown | Promise<unknown>);

/** A fake model answering with scripted replies, counting each call against a per-person limit like the AI features service. */
function fakeModel(replies: Reply[], ready = true, perDay = 100) {
  const requests: ModelRequest[] = [];
  const callers: string[] = [];
  const limiter = createAiUsageLimiter({ perMinute: 1000, perDay }, 'Asia/Muscat', () => NOW);
  let i = 0;
  const model: MicoAiModel & { requests: ModelRequest[]; callers: string[] } = {
    requests,
    callers,
    async ready() {
      return ready;
    },
    checkLimit(userId) {
      limiter.check(userId);
    },
    async chat(req, userId) {
      limiter.take(userId);
      callers.push(userId);
      requests.push(req as ModelRequest);
      const r = replies[Math.min(i++, replies.length - 1)];
      const out = typeof r === 'function' ? await (r as (q: ModelRequest) => unknown)(req as ModelRequest) : r;
      if (out instanceof Error) throw out;
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  return model;
}

function setup(replies: Reply[], opts: { ready?: boolean; perDay?: number; data?: ReturnType<typeof company>; answerTimeoutMs?: number; failAudit?: boolean } = {}) {
  const repo = createMemoryMicoAiRepository(() => NOW);
  const audit: Array<Record<string, unknown>> = [];
  const logged: unknown[] = [];
  const model = fakeModel(replies, opts.ready ?? true, opts.perDay ?? 100);
  const tools = createMicoAiTools({ data: createMemoryMicoAiData(opts.data ?? company()), timeZone: 'Asia/Muscat', now: () => NOW });
  const svc = createMicoAiService({
    repo,
    tools,
    model,
    audit: {
      record: async (e) => {
        if (opts.failAudit) throw new Error('audit table locked');
        audit.push(e as Record<string, unknown>);
      },
    },
    logger: { error: (msg: string, meta?: unknown) => void logged.push({ msg, meta }) },
    answerTimeoutMs: opts.answerTimeoutMs,
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    userName: async (id) => ({ 'u-omar': 'Omar Said', 'u-sara': 'Sara Ahmed', 'u-admin': 'Khurram Shahzad' })[id] ?? 'Someone',
  });
  return { repo, audit, model, svc, logged };
}

const overdueTool = { action: 'tool', name: 'search_tasks', args: { project: 'RIG', status: 'overdue' } };
const tableAnswer = { action: 'answer', text: '**3 tasks** in Rig Inspection Portal are overdue.', tables: [{ title: 'Overdue tasks', fromResult: 'r1', columns: ['key', 'title', 'assignees', 'due', 'overdueDays'] }] };

async function askAndWait(svc: ReturnType<typeof setup>['svc'], viewer = OMAR, text = 'Which tasks are overdue in Rig Inspection?', chatId?: string) {
  const chat = chatId ?? (await svc.createChat(viewer, {})).id;
  const { question, answer } = await svc.ask(viewer, chat, text);
  await svc.whenDone(answer.id);
  return { chat, question, answer: await svc.getMessage(viewer, chat, answer.id) };
}

describe('MICO AI service: asking', () => {
  it('answers in the background: a pending answer first, then the answer with its table and sources', async () => {
    const { svc } = setup([overdueTool, tableAnswer]);
    const chat = await svc.createChat(OMAR, {});
    const { question, answer } = await svc.ask(OMAR, chat.id, 'Which tasks are overdue in Rig Inspection?');
    expect(question).toMatchObject({ role: 'user', text: 'Which tasks are overdue in Rig Inspection?', status: 'done' });
    expect(answer).toMatchObject({ role: 'assistant', status: 'pending', step: 'Thinking…' });
    await svc.whenDone(answer.id);
    const done = await svc.getMessage(OMAR, chat.id, answer.id);
    expect(done.status).toBe('done');
    expect(done.text).toBe('**3 tasks** in Rig Inspection Portal are overdue.');
    expect(done.answer!.tables[0]!.rows.map((r) => r.cells)).toEqual([
      ['RIG-14', 'Pressure test report', 'Omar Said', '2026-10-19', 5],
      ['RIG-9', 'Valve inventory update', 'Sara Ahmed', '2026-10-20', 4],
      ['RIG-21', 'Safety checklist v2', 'Omar Said', '2026-10-21', 3],
    ]);
    expect(done.answer!.sources.map((s) => s.label)).toEqual(['RIG-14', 'RIG-9', 'RIG-21']);
    expect(done).not.toHaveProperty('results');
    expect(JSON.stringify(done)).not.toContain('"results"');
  });

  it('shows what it is doing while it works', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { svc } = setup([overdueTool, async () => (await held, tableAnswer)]);
    const chat = await svc.createChat(OMAR, {});
    const { answer } = await svc.ask(OMAR, chat.id, 'overdue?');
    await new Promise((r) => setTimeout(r, 10));
    expect((await svc.getMessage(OMAR, chat.id, answer.id)).step).toBe('Checking tasks in RIG…');
    release();
    await svc.whenDone(answer.id);
    expect((await svc.getMessage(OMAR, chat.id, answer.id)).step).toBeNull();
  });

  it('names the chat from its first question (short and plain), and keeps a name the person gave it', async () => {
    const { svc } = setup([{ action: 'answer', text: 'Hello.' }]);
    const { chat } = await askAndWait(svc, OMAR, '   Which tasks are overdue in Rig Inspection, and who has them? I need this for the weekly review meeting tomorrow   ');
    const title = (await svc.getChat(OMAR, chat)).chat.title;
    expect(title).toBe('Which tasks are overdue in Rig Inspection, and who has them?…');
    expect(title.length).toBeLessThanOrEqual(61);
    const named = await svc.createChat(OMAR, { title: 'My chat' });
    await askAndWait(svc, OMAR, 'Another question', named.id);
    expect((await svc.getChat(OMAR, named.id)).chat.title).toBe('My chat');
    const arabic = await askAndWait(svc, OMAR, 'ما هي المهام المتأخرة؟');
    expect((await svc.getChat(OMAR, arabic.chat)).chat.title).toBe('ما هي المهام المتأخرة؟');
  });

  it('when AI isn’t set up it says so, and stores nothing', async () => {
    const { svc, repo } = setup([], { ready: false });
    expect(await svc.status()).toEqual({ ready: false, message: NOT_READY });
    expect(NOT_READY).toBe('MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.');
    const chat = await svc.createChat(OMAR, {});
    await expect(svc.ask(OMAR, chat.id, 'hello')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', message: NOT_READY });
    expect(repo.messages).toEqual([]);
  });

  it('every AI call counts against the person’s shared AI limit; at the limit nothing is stored', async () => {
    const { svc, repo, model } = setup([overdueTool, tableAnswer, overdueTool, tableAnswer], { perDay: 3 });
    await askAndWait(svc); // 2 calls
    const second = await askAndWait(svc); // the 3rd call is allowed, the 4th is over the limit
    expect(second.answer).toMatchObject({ status: 'error', error: 'You’ve reached today’s AI request limit. It resets tomorrow.' });
    expect(model.callers).toEqual(['u-omar', 'u-omar', 'u-omar']);
    const chat = await svc.createChat(OMAR, {});
    await expect(svc.ask(OMAR, chat.id, 'third')).rejects.toMatchObject({ status: 429, message: 'You’ve reached today’s AI request limit. It resets tomorrow.' });
    expect(repo.messages.filter((m) => m.chatId === chat.id)).toEqual([]);
    // Another person still can.
    await expect(askAndWait(svc, SARA)).resolves.toBeTruthy();
  });

  it('one answer at a time in a chat', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { svc } = setup([async () => (await held, { action: 'answer', text: 'Done.' })]);
    const chat = await svc.createChat(OMAR, {});
    const first = await svc.ask(OMAR, chat.id, 'one');
    await expect(svc.ask(OMAR, chat.id, 'two')).rejects.toMatchObject({ status: 409, message: 'MICO AI is still answering in this chat. Wait for it, or stop it.' });
    release();
    await svc.whenDone(first.answer.id);
    await expect(svc.ask(OMAR, chat.id, 'two')).resolves.toBeTruthy();
  });

  it('Stop ends the answer at once: the model’s call is aborted and nothing it says later is kept', async () => {
    let signal: AbortSignal | undefined;
    const { svc } = setup([
      (req: ModelRequest) =>
        new Promise((_resolve, reject) => {
          signal = req.signal;
          req.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ]);
    const chat = await svc.createChat(OMAR, {});
    const { answer } = await svc.ask(OMAR, chat.id, 'overdue?');
    await new Promise((r) => setTimeout(r, 5));
    const stopped = await svc.stop(OMAR, chat.id, answer.id);
    expect(stopped.status).toBe('stopped');
    expect(signal?.aborted).toBe(true);
    await svc.whenDone(answer.id);
    expect((await svc.getMessage(OMAR, chat.id, answer.id)).status).toBe('stopped');
  });

  it('every failure is plain English', async () => {
    const cases: Array<[unknown, string]> = [
      [new ProviderRefusedError(429, 'quota'), 'The AI service is busy right now (HTTP 429). Try again in a moment.'],
      [new Error('ECONNRESET at socket 12'), 'Something went wrong while answering. Try again.'],
      ['not json at all', 'MICO AI’s reply couldn’t be read. Try again, or ask in a different way.'],
    ];
    for (const [reply, message] of cases) {
      const { svc } = setup([reply, reply]);
      const { answer } = await askAndWait(svc);
      expect(answer.status).toBe('error');
      expect(answer.error).toBe(message);
      expect(JSON.stringify(answer)).not.toContain('ECONNRESET');
      expect(JSON.stringify(answer)).not.toContain('quota');
    }
  });

  it('an answer left pending by a restart reads as interrupted', async () => {
    const { svc, repo } = setup([]);
    const chat = await svc.createChat(OMAR, {});
    const m = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING', step: 'Checking tasks…' });
    m.updatedAt = new Date(NOW.getTime() - 60 * 60_000);
    expect(await svc.getMessage(OMAR, chat.id, m.id)).toMatchObject({ status: 'error', error: 'This answer was interrupted. Try again.' });
  });
});

describe('MICO AI service: context', () => {
  it('a follow-up sees the earlier turns and can reuse their results and sources', async () => {
    const { svc, model } = setup([overdueTool, tableAnswer, { action: 'answer', text: 'Omar has 2 of them.', sources: ['task:t14', 'task:t21'] }]);
    const { chat } = await askAndWait(svc);
    const { answer } = await askAndWait(svc, OMAR, 'Which of those are Omar’s?', chat);
    const prompt = model.requests.at(-1)!.prompt;
    expect(prompt).toContain('Which tasks are overdue in Rig Inspection?');
    expect(prompt).toContain('3 tasks');
    expect(prompt).toMatch(/r1 = search_tasks/);
    expect(answer.answer!.sources.map((s) => s.label)).toEqual(['RIG-14', 'RIG-21']);
  });

  it('keeps a short running summary for long chats and sends it with the recent turns', async () => {
    const replies: Reply[] = [];
    const { svc, model, repo } = setup([
      (req: ModelRequest) => (/running summary/i.test(req.system) ? { summary: 'They asked about Rig Inspection, many times.' } : { action: 'answer', text: 'Noted.' }),
    ]);
    void replies;
    const chat = (await svc.createChat(OMAR, {})).id;
    for (let i = 0; i < 16; i++) await askAndWait(svc, OMAR, `Question ${i}`, chat);
    const stored = repo.chats.find((c) => c.id === chat)!;
    expect(stored.summary).toBe('They asked about Rig Inspection, many times.');
    expect(stored.summarizedCount).toBeGreaterThan(0);
    const last = model.requests.filter((r) => !/running summary/i.test(r.system)).at(-1)!.prompt;
    expect(last).toContain('They asked about Rig Inspection, many times.');
    expect(last).not.toContain('"Question 0"');
    expect(last).toContain('Question 14');
  });
});

describe('MICO AI service: chats are private', () => {
  it('create, rename, list newest first, search titles and messages, delete for good', async () => {
    const { svc, repo } = setup([{ action: 'answer', text: 'The pressure test moved to rig 3.' }]);
    const a = await svc.createChat(OMAR, { title: 'Rig notes' });
    const b = await askAndWait(svc, OMAR, 'What happened to the pressure test?');
    expect((await svc.listChats(OMAR, {})).map((c) => c.id)).toEqual([b.chat, a.id]);
    expect((await svc.renameChat(OMAR, a.id, '  Rig inspection notes ')).title).toBe('Rig inspection notes');
    expect((await svc.listChats(OMAR, { query: 'inspection notes' })).map((c) => c.id)).toEqual([a.id]);
    const byText = await svc.listChats(OMAR, { query: 'rig 3' });
    expect(byText.map((c) => c.id)).toEqual([b.chat]);
    expect(byText[0]!.match).toContain('rig 3');
    await svc.deleteChat(OMAR, b.chat);
    expect(repo.messages.filter((m) => m.chatId === b.chat)).toEqual([]);
    await expect(svc.getChat(OMAR, b.chat)).rejects.toMatchObject({ status: 404 });
  });

  it('nobody else can open, rename, delete, ask in, stop or download from someone’s chat — admins included', async () => {
    const { svc } = setup([overdueTool, tableAnswer]);
    const { chat, answer } = await askAndWait(svc);
    for (const other of [SARA, ADMIN]) {
      await expect(svc.getChat(other, chat)).rejects.toMatchObject({ status: 404 });
      await expect(svc.renameChat(other, chat, 'mine now')).rejects.toMatchObject({ status: 404 });
      await expect(svc.deleteChat(other, chat)).rejects.toMatchObject({ status: 404 });
      await expect(svc.ask(other, chat, 'hi')).rejects.toMatchObject({ status: 404 });
      await expect(svc.getMessage(other, chat, answer.id)).rejects.toMatchObject({ status: 404 });
      await expect(svc.stop(other, chat, answer.id)).rejects.toMatchObject({ status: 404 });
      await expect(svc.table(other, chat, answer.id, 1)).rejects.toMatchObject({ status: 404 });
      expect(await svc.listChats(other, {})).toEqual([]);
      expect(await svc.listChats(other, { query: 'overdue' })).toEqual([]);
    }
    expect((await svc.getChat(OMAR, chat)).messages).toHaveLength(2);
  });

  it('the audit log records only that MICO AI was used — no question, no answer', async () => {
    const { svc, audit } = setup([overdueTool, tableAnswer]);
    await askAndWait(svc, OMAR, 'Which tasks are overdue in Rig Inspection?');
    expect(audit).toEqual([{ userId: 'u-omar', ip: null, module: 'mico-ai', action: 'mico-ai.ask', entityId: null }]);
    expect(JSON.stringify(audit)).not.toMatch(/overdue|Rig|RIG/);
  });

  it('a download is the stored table, exactly as shown', async () => {
    const { svc } = setup([overdueTool, tableAnswer]);
    const { chat, answer } = await askAndWait(svc);
    const t = await svc.table(OMAR, chat, answer.id, 1);
    expect(t.table.rows.map((r) => r.cells)).toEqual(answer.answer!.tables[0]!.rows.map((r) => r.cells));
    expect(t.question).toBe('Which tasks are overdue in Rig Inspection?');
    expect(t.text).toBe('**3 tasks** in Rig Inspection Portal are overdue.');
    await expect(svc.table(OMAR, chat, answer.id, 2)).rejects.toMatchObject({ status: 404 });
  });
});

describe('MICO AI service: review fixes', () => {
  it('a failing write while recording a failure never crashes the server: it is logged', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { svc, repo, logged } = setup([new Error('model down')]);
      const chat = await svc.createChat(OMAR, {});
      const real = repo.updateMessage.bind(repo);
      repo.updateMessage = async (id, patch, onlyIf) => {
        if (patch.status === 'ERROR') throw new Error('database gone');
        return real(id, patch, onlyIf);
      };
      const { answer } = await svc.ask(OMAR, chat.id, 'overdue?');
      await expect(svc.whenDone(answer.id)).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expect(logged.some((l) => String((l as { meta?: { err?: Error } }).meta?.err?.message).includes('database gone'))).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('one answer at a time, even when two questions arrive at once', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { svc } = setup([async () => (await held, { action: 'answer', text: 'Done.' })]);
    const chat = await svc.createChat(OMAR, {});
    const both = await Promise.allSettled([svc.ask(OMAR, chat.id, 'one'), svc.ask(OMAR, chat.id, 'two')]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((both.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    release();
  });

  it('if the audit log can’t be written, the answer still comes', async () => {
    const { svc, logged } = setup([{ action: 'answer', text: 'Hello.' }], { failAudit: true });
    const { answer } = await askAndWait(svc);
    expect(answer.status).toBe('done');
    expect(JSON.stringify(logged)).toContain('audit');
  });

  it('an answer that takes longer than the time limit ends with a plain message', async () => {
    const { svc } = setup([(req: ModelRequest) => new Promise((_r, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))))], { answerTimeoutMs: 30 });
    const { answer } = await askAndWait(svc);
    expect(answer).toMatchObject({ status: 'error', error: 'MICO AI took too long to answer, so it stopped. Try a narrower question, for example one project or one week.' });
  });

  it('answers cut off by a restart are marked interrupted on start and when the chat is read, and don’t block it', async () => {
    const { svc, repo } = setup([{ action: 'answer', text: 'Fresh.' }]);
    const chat = await svc.createChat(OMAR, {});
    const old = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING', step: 'Checking tasks…' });
    old.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    expect(await svc.interruptStale()).toBe(1);
    expect(repo.messages.find((m) => m.id === old.id)!.status).toBe('ERROR');
    const again = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING', step: 'Checking tasks…' });
    again.updatedAt = new Date(NOW.getTime() - 10 * 60_000);
    const opened = await svc.getChat(OMAR, chat.id);
    expect(opened.messages.find((m) => m.id === again.id)).toMatchObject({ status: 'error', error: 'This answer was interrupted. Try again.' });
    expect(repo.messages.find((m) => m.id === again.id)!.status).toBe('ERROR');
    await expect(askAndWait(svc, OMAR, 'again', chat.id)).resolves.toBeTruthy();
  });

  it('results from earlier questions are re-checked: a task the person can no longer see never reaches the AI again', async () => {
    const data = company();
    const { svc, model } = setup([{ action: 'tool', name: 'search_tasks', args: {} }, { action: 'answer', text: 'Here.', tables: [{ fromResult: 'r1' }] }, { action: 'answer', text: 'Again.', sources: ['task:t14'] }], { data });
    const first = await askAndWait(svc, SARA, 'my tasks?');
    expect(first.answer.answer!.tables[0]!.rows.length).toBeGreaterThan(0);
    data.members = data.members.filter((m) => !(m.userId === 'u-sara' && m.projectId === 'p-rig'));
    const second = await askAndWait(svc, SARA, 'and now?', first.chat);
    expect(model.requests.at(-1)!.prompt).not.toContain('task:t14');
    expect(second.answer.answer!.sources).toEqual([]);
  });

  it('a long chat opens on its latest messages, with older ones a page at a time', async () => {
    const { svc, repo } = setup([]);
    const chat = await svc.createChat(OMAR, {});
    for (let i = 0; i < 70; i++) await repo.addMessage(chat.id, { role: 'user', text: `m${i}`, content: null, status: 'DONE' });
    const first = await svc.getChat(OMAR, chat.id);
    expect(first.messages.map((m) => m.text)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 20}`));
    expect(first.hasMore).toBe(true);
    const older = await svc.olderMessages(OMAR, chat.id, first.messages[0]!.id);
    expect(older.messages.map((m) => m.text)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    expect(older.hasMore).toBe(false);
    await expect(svc.olderMessages(SARA, chat.id, first.messages[0]!.id)).rejects.toMatchObject({ status: 404 });
  });

  it('stored results are kept apart from the answer: reading the chat doesn’t load them', async () => {
    const { svc, repo } = setup([overdueTool, tableAnswer]);
    const { chat, answer } = await askAndWait(svc);
    const stored = repo.messages.find((m) => m.id === answer.id)!;
    expect(stored.results).toHaveLength(1);
    expect(JSON.stringify(stored.content)).not.toContain('"results"');
    const spy = vi.spyOn(repo, 'recentMessages');
    await svc.getChat(OMAR, chat);
    await svc.getMessage(OMAR, chat, answer.id);
    await svc.table(OMAR, chat, answer.id, 1);
    expect(spy).not.toHaveBeenCalled();
  });
});
