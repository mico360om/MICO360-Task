import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMicoAiRepository } from '../../src/modules/mico-ai/prisma-mico-ai-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. MICO AI's chats are private:
// every read and change is for the owner only, searching reads titles and messages, delete is for good.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMicoAiRepository(prisma);
const OMAR = 'mico-ai-test-omar';
const SARA = 'mico-ai-test-sara';

async function cleanup() {
  await prisma.micoAiChat.deleteMany({ where: { userId: { in: [OMAR, SARA] } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(cleanup);

describe('MICO AI chats in the database (integration)', () => {
  it('keeps each person’s chats to themselves, newest activity first', async () => {
    const a = await repo.createChat(OMAR, 'Rig notes');
    const b = await repo.createChat(OMAR, '');
    const s = await repo.createChat(SARA, 'Sara’s chat');
    await repo.addMessage(a.id, { role: 'user', text: 'first', content: null, status: 'DONE' });
    expect((await repo.listChats(OMAR, { limit: 50 })).map((m) => m.chat.id)).toEqual([a.id, b.id]);
    expect((await repo.listChats(SARA, { limit: 50 })).map((m) => m.chat.id)).toEqual([s.id]);
    expect(await repo.getChat(SARA, a.id)).toBeNull();
    expect(await repo.renameChat(SARA, a.id, 'taken')).toBeNull();
    expect(await repo.deleteChat(SARA, a.id)).toBe(false);
    expect((await repo.getChat(OMAR, a.id))!.title).toBe('Rig notes');
  });

  it('searches titles and message text (any case), only in the owner’s chats', async () => {
    const a = await repo.createChat(OMAR, 'Falcon CRM status');
    const b = await repo.createChat(OMAR, 'Untitled');
    await repo.addMessage(b.id, { role: 'assistant', text: 'The Pressure Test moved to rig 3.', content: { kind: 'answer' }, status: 'DONE' });
    const s = await repo.createChat(SARA, 'Pressure test');
    expect((await repo.listChats(OMAR, { query: 'falcon', limit: 50 })).map((m) => m.chat.id)).toEqual([a.id]);
    const hit = await repo.listChats(OMAR, { query: 'pressure test', limit: 50 });
    expect(hit.map((m) => m.chat.id)).toEqual([b.id]);
    expect(hit[0]!.snippet).toContain('Pressure Test moved to rig 3');
    expect((await repo.listChats(SARA, { query: 'rig 3', limit: 50 })).map((m) => m.chat.id)).toEqual([]);
    expect((await repo.listChats(SARA, { query: 'pressure', limit: 50 })).map((m) => m.chat.id)).toEqual([s.id]);
  });

  it('messages in order, answers as JSON (Arabic too), changed only while still pending', async () => {
    const chat = await repo.createChat(OMAR, '');
    const q = await repo.addMessage(chat.id, { role: 'user', text: 'ما هي المهام المتأخرة؟', content: null, status: 'DONE' });
    const a = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING', step: 'Thinking…' });
    expect((await repo.pageMessages(chat.id, { limit: 50 })).messages.map((m) => m.id)).toEqual([q.id, a.id]);
    expect(await repo.updateMessage(a.id, { step: 'Checking tasks…' }, 'PENDING')).toBe(true);
    expect((await repo.getMessage(chat.id, a.id))!.step).toBe('Checking tasks…');
    expect(await repo.updateMessage(a.id, { status: 'STOPPED', step: null }, 'PENDING')).toBe(true);
    // A late answer after Stop is not written.
    expect(await repo.updateMessage(a.id, { status: 'DONE', text: 'late', content: { kind: 'answer', text: 'late' } }, 'PENDING')).toBe(false);
    const stopped = (await repo.getMessage(chat.id, a.id))!;
    expect(stopped.status).toBe('STOPPED');
    expect(stopped.text).toBe('');
    const content = { kind: 'answer', text: 'لديك مهمتان متأخرتان', tables: [{ rows: [{ cells: ['RIG-14', 5] }] }] };
    const done = await repo.addMessage(chat.id, { role: 'assistant', text: 'لديك مهمتان متأخرتان', content, status: 'DONE' });
    expect((await repo.getMessage(chat.id, done.id))!.content).toEqual(content);
    expect((await repo.pageMessages(chat.id, { limit: 50 })).messages[0]!.text).toBe('ما هي المهام المتأخرة؟');
    expect(await repo.getMessage('another-chat', a.id)).toBeNull();
  });

  it('a running summary is kept on the chat', async () => {
    const chat = await repo.createChat(OMAR, '');
    await repo.setSummary(chat.id, 'They asked about Rig Inspection.', 10);
    expect(await repo.getChat(OMAR, chat.id)).toMatchObject({ summary: 'They asked about Rig Inspection.', summarizedCount: 10 });
  });

  it('delete is permanent: the chat and all its messages are gone', async () => {
    const chat = await repo.createChat(OMAR, 'Delete me');
    await repo.addMessage(chat.id, { role: 'user', text: 'one', content: null, status: 'DONE' });
    await repo.addMessage(chat.id, { role: 'assistant', text: 'two', content: { kind: 'answer' }, status: 'DONE' });
    expect(await repo.deleteChat(OMAR, chat.id)).toBe(true);
    expect(await prisma.micoAiChat.count({ where: { id: chat.id } })).toBe(0);
    expect(await prisma.micoAiMessage.count({ where: { chatId: chat.id } })).toBe(0);
  });
});

describe('MICO AI chats in the database: turns, pages and stored results (integration)', () => {
  it('one answer at a time: two questions at once start one turn, the other is busy', async () => {
    const chat = await repo.createChat(OMAR, '');
    const turn = { step: 'Thinking…', staleBefore: new Date(Date.now() - 60_000), interrupted: { error: 'interrupted' } };
    const both = await Promise.all([repo.startTurn(chat.id, { ...turn, question: 'one' }), repo.startTurn(chat.id, { ...turn, question: 'two' })]);
    expect(both.filter((r) => r === 'busy')).toHaveLength(1);
    expect(await prisma.micoAiMessage.count({ where: { chatId: chat.id } })).toBe(2);
    expect(await prisma.micoAiMessage.count({ where: { chatId: chat.id, status: 'PENDING' } })).toBe(1);
  });

  it('a pending answer older than the time limit doesn’t block a new turn: it becomes interrupted', async () => {
    const chat = await repo.createChat(OMAR, '');
    const old = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING', step: 'Checking…' });
    await prisma.micoAiMessage.update({ where: { id: old.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    const turn = await repo.startTurn(chat.id, { question: 'again', step: 'Thinking…', staleBefore: new Date(Date.now() - 60_000), interrupted: { error: 'This answer was interrupted. Try again.' } });
    expect(turn).not.toBe('busy');
    expect(await repo.getMessage(chat.id, old.id)).toMatchObject({ status: 'ERROR', content: { error: 'This answer was interrupted. Try again.' } });
  });

  it('marks answers cut off by a restart as interrupted, in one chat or everywhere', async () => {
    const chat = await repo.createChat(OMAR, '');
    const fresh = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING' });
    const old = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING' });
    await prisma.micoAiMessage.update({ where: { id: old.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    expect(await repo.interruptStale(new Date(Date.now() - 60_000), { error: 'x' }, chat.id)).toBe(1);
    expect((await repo.getMessage(chat.id, fresh.id))!.status).toBe('PENDING');
    expect((await repo.getMessage(chat.id, old.id))!.status).toBe('ERROR');
  });

  it('pages: the newest first page, older on request; results only where asked for', async () => {
    const chat = await repo.createChat(OMAR, '');
    for (let i = 0; i < 7; i++) await repo.addMessage(chat.id, { role: 'user', text: `m${i}`, content: null, status: 'DONE' });
    const answer = await repo.addMessage(chat.id, { role: 'assistant', text: 'a', content: { kind: 'answer', text: 'a' }, status: 'DONE' });
    await repo.updateMessage(answer.id, { results: [{ id: 'r1', rows: [] }] });
    const page = await repo.pageMessages(chat.id, { limit: 3 });
    expect(page.messages.map((m) => m.text)).toEqual(['m5', 'm6', 'a']);
    expect(page.hasMore).toBe(true);
    expect(page.messages[2]).not.toHaveProperty('results');
    const older = await repo.pageMessages(chat.id, { limit: 10, before: page.messages[0]!.id });
    expect(older.messages.map((m) => m.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(older.hasMore).toBe(false);
    const recent = await repo.recentMessages(chat.id, 2);
    expect(recent.map((m) => m.text)).toEqual(['m6', 'a']);
    expect(recent[1]!.results).toEqual([{ id: 'r1', rows: [] }]);
    expect((await repo.messageRange(chat.id, 2, 2)).map((m) => m.text)).toEqual(['m2', 'm3']);
    expect(await repo.countMessages(chat.id)).toBe(8);
    expect(await repo.questionBefore(chat.id, answer.id)).toBe('m6');
    expect(await repo.getMessage(chat.id, answer.id)).not.toHaveProperty('results');
  });

  it('deleting a person’s chats removes every one of them, and nobody else’s', async () => {
    await repo.createChat(OMAR, 'one');
    await repo.createChat(OMAR, 'two');
    const sara = await repo.createChat(SARA, 'mine');
    expect(await repo.deleteAllForUser(OMAR)).toBe(2);
    expect(await prisma.micoAiChat.count({ where: { userId: OMAR } })).toBe(0);
    expect(await repo.getChat(SARA, sara.id)).not.toBeNull();
  });
});
