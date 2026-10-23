import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDataExporter } from '../../src/modules/users/data-export';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. "Download my data" holds the
// person's own MICO AI chats (their questions and the answers' words), and nobody else's.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let me = '';
let other = '';

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { in: ['mai-export-me', 'mai-export-other'] } }, select: { id: true } });
  await prisma.micoAiChat.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  me = (await prisma.user.create({ data: { username: 'mai-export-me', email: 'mai-export-me@mico360.test', passwordHash: 'x', firstName: 'Me', lastName: 'Test' } })).id;
  other = (await prisma.user.create({ data: { username: 'mai-export-other', email: 'mai-export-other@mico360.test', passwordHash: 'x', firstName: 'Other', lastName: 'Test' } })).id;
  const chat = await prisma.micoAiChat.create({ data: { userId: me, title: 'Overdue tasks' } });
  await prisma.micoAiMessage.create({ data: { chatId: chat.id, role: 'user', text: 'Which tasks are overdue?', status: 'DONE', createdAt: new Date('2026-10-24T08:00:00Z') } });
  await prisma.micoAiMessage.create({ data: { chatId: chat.id, role: 'assistant', text: '3 tasks are overdue.', status: 'DONE', content: { kind: 'answer' }, createdAt: new Date('2026-10-24T08:00:01Z') } });
  await prisma.micoAiChat.create({ data: { userId: other, title: 'Not mine' } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Download my data: MICO AI chats (integration)', () => {
  it('includes the person’s own chats and their messages, and no one else’s', async () => {
    const data = await createPrismaDataExporter(prisma)(me);
    expect(data!.micoAiChats).toEqual([
      {
        title: 'Overdue tasks',
        createdAt: expect.any(Date),
        messages: [
          { role: 'user', text: 'Which tasks are overdue?', status: 'DONE', createdAt: new Date('2026-10-24T08:00:00Z') },
          { role: 'assistant', text: '3 tasks are overdue.', status: 'DONE', createdAt: new Date('2026-10-24T08:00:01Z') },
        ],
      },
    ]);
    expect(JSON.stringify(data)).not.toContain('Not mine');
  });
});
