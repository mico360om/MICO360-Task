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
    expect((await repo.listMessages(chat.id)).map((m) => m.id)).toEqual([q.id, a.id]);
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
    expect((await repo.listMessages(chat.id))[0]!.text).toBe('ما هي المهام المتأخرة؟');
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
