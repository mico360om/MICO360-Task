import { describe, it, expect } from 'vitest';
import { createMicoAiService, NOT_READY, type MicoAiModel } from './mico-ai-service';
import { createMemoryMicoAiRepository } from './mico-ai-repository';
import { createMicoAiTools } from './mico-ai-tools';
import { createMemoryMicoAiData, company, NOW, OMAR, SARA, ADMIN } from './mico-ai-data.fixture';
import { ProviderRefusedError } from '../ai/ai-completion';
import type { ModelRequest } from './mico-ai-loop';

type Reply = unknown | ((req: ModelRequest) => unknown | Promise<unknown>);

/** A fake model answering with scripted replies; `gate` holds a reply until released. */
function fakeModel(replies: Reply[], ready = true) {
  const requests: ModelRequest[] = [];
  let i = 0;
  const model: MicoAiModel & { requests: ModelRequest[] } = {
    requests,
    async ready() {
      return ready;
    },
    async chat(req) {
      requests.push(req as ModelRequest);
      const r = replies[Math.min(i++, replies.length - 1)];
      const out = typeof r === 'function' ? await (r as (q: ModelRequest) => unknown)(req as ModelRequest) : r;
      if (out instanceof Error) throw out;
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  return model;
}

function setup(replies: Reply[], opts: { ready?: boolean; perDay?: number } = {}) {
  const repo = createMemoryMicoAiRepository(() => NOW);
  const audit: Array<Record<string, unknown>> = [];
  const model = fakeModel(replies, opts.ready ?? true);
  const tools = createMicoAiTools({ data: createMemoryMicoAiData(company()), timeZone: 'Asia/Muscat', now: () => NOW });
  const svc = createMicoAiService({
    repo,
    tools,
    model,
    audit: { record: async (e) => void audit.push(e as Record<string, unknown>) },
    limits: { perMinute: 50, perDay: opts.perDay ?? 100 },
    timeZone: 'Asia/Muscat',
    now: () => NOW,
    userName: async (id) => ({ 'u-omar': 'Omar Said', 'u-sara': 'Sara Ahmed', 'u-admin': 'Khurram Shahzad' })[id] ?? 'Someone',
  });
  return { repo, audit, model, svc };
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

  it('counts one question against the person’s daily limit, however many steps it takes', async () => {
    const { svc, repo } = setup([overdueTool, overdueTool, tableAnswer, tableAnswer], { perDay: 2 });
    await askAndWait(svc);
    await askAndWait(svc);
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
