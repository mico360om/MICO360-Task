import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  createPrismaChatAttachmentRepository,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import type { ChatMemberLookup } from '../../src/modules/chat/chat-repository';

// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
// Review batch 4b (13 Nov 2026), from the verification repros (verify35/repro/E chat-repro.ts, chat-repro-2.ts):
//   #17  two people starting a direct chat at the same moment got two conversations (20/20);
//   N10  a project chat opened by two people at once gave the second a 500;
//   #20  history paged by time alone skipped a message sent in the same millisecond as another;
//   #18  a message was saved before its file: a failed file left an empty message.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const tag = randomBytes(3).toString('hex');
const users: string[] = [];
const projects: string[] = [];

const members: ChatMemberLookup = {
  canAccessProject: async () => true,
  accessibleProjectIds: async () => projects,
  isActiveUser: async () => true,
  colleagues: async () => true,
};

function service(db: PrismaClient = prisma) {
  return createMessageService({
    conversations: createPrismaConversationRepository(db),
    participants: createPrismaParticipantRepository(db),
    messages: createPrismaMessageRepository(db),
    reactions: createPrismaReactionRepository(db),
    attachments: createPrismaChatAttachmentRepository(db),
    members,
  });
}

let n = 0;
async function person(name: string) {
  const u = await prisma.user.create({ data: { email: `${name}${n}-${tag}@sb4b.test`, username: `${name}${n++}${tag}`, passwordHash: 'x', firstName: name, lastName: 'Test' } });
  users.push(u.id);
  return u.id;
}

const directCount = (a: string, b: string) =>
  prisma.conversation.count({ where: { kind: 'DIRECT', AND: [{ participants: { some: { userId: a } } }, { participants: { some: { userId: b } } }] } });

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  const convs = await prisma.conversationParticipant.findMany({ where: { userId: { in: users } }, select: { conversationId: true } });
  await prisma.conversation.deleteMany({ where: { OR: [{ id: { in: convs.map((c) => c.conversationId) } }, { projectId: { in: projects } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe('#17 one direct conversation per pair of people', () => {
  it('two people starting a chat with each other at the same moment get one conversation (20 of 20)', async () => {
    const svc = service();
    let duplicated = 0;
    for (let i = 0; i < 20; i++) {
      const a = await person('ana');
      const b = await person('ben');
      const [x, y] = await Promise.all([svc.getOrCreateDirectConversation(a, b), svc.getOrCreateDirectConversation(b, a)]);
      if ((await directCount(a, b)) !== 1 || x.id !== y.id) duplicated += 1;
    }
    expect(duplicated).toBe(0);
  });

  it('a double click (the same person twice at once) gets one conversation too', async () => {
    const svc = service();
    let duplicated = 0;
    for (let i = 0; i < 20; i++) {
      const a = await person('cat');
      const b = await person('dan');
      const [x, y] = await Promise.all([svc.getOrCreateDirectConversation(a, b), svc.getOrCreateDirectConversation(a, b)]);
      if ((await directCount(a, b)) !== 1 || x.id !== y.id) duplicated += 1;
    }
    expect(duplicated).toBe(0);
  });

  it('a new conversation is made with both people in it', async () => {
    const a = await person('eve');
    const b = await person('fay');
    const c = await service().getOrCreateDirectConversation(a, b);
    const people = await prisma.conversationParticipant.findMany({ where: { conversationId: c.id }, orderBy: { userId: 'asc' } });
    expect(people.map((p) => p.userId).sort()).toEqual([a, b].sort());
    expect((await service().getOrCreateDirectConversation(b, a)).id).toBe(c.id);
  });
});

describe('N10 a project chat opened by two people at once', () => {
  it('works for both, and there is one channel', async () => {
    const svc = service();
    for (let i = 0; i < 10; i++) {
      const projectId = `p${tag}${i}`;
      projects.push(projectId);
      const a = await person('gil');
      const b = await person('hal');
      const results = await Promise.allSettled([svc.getOrCreateProjectConversation(projectId, a), svc.getOrCreateProjectConversation(projectId, b), svc.getOrCreateProjectConversation(projectId, a)]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
      expect(ids.size).toBe(1);
      expect(await prisma.conversation.count({ where: { projectId } })).toBe(1);
      expect(await prisma.conversationParticipant.count({ where: { conversation: { projectId } } })).toBe(2);
    }
  });
});

describe('the same person reading a chat in several tabs at once (MariaDB 1020)', () => {
  it('marking it read from 6 tabs at once never fails, and the read marker is kept', async () => {
    const a = await person('oli');
    const b = await person('pam');
    const conv = await service().getOrCreateDirectConversation(a, b);
    await service().postMessage(conv.id, b, { body: 'Contoso site visit at 9' });
    for (let i = 0; i < 5; i++) {
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => service().markRead(conv.id, a)));
      expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason).slice(0, 200))).toEqual([]);
    }
    const row = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: a } } });
    expect(row?.lastReadAt).toBeTruthy();
    // A first read from several tabs of a channel the person has no row in yet.
    const projectId = `p${tag}read`;
    projects.push(projectId);
    const channel = await service().getOrCreateProjectConversation(projectId, b);
    const firsts = await Promise.allSettled(Array.from({ length: 6 }, () => service().markRead(channel.id, a)));
    expect(firsts.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await prisma.conversationParticipant.count({ where: { conversationId: channel.id, userId: a } })).toBe(1);
  });

  // Batch 4b review (round 3, optional): a slow tab's older marker landing after a newer one never moves it back
  // (the unread count would show messages already read) — the way "delivered" already only moves forward.
  it('an older read marker arriving late never moves it back', async () => {
    const a = await person('qin');
    const b = await person('ray');
    const conv = await service().getOrCreateDirectConversation(a, b);
    const repo = createPrismaParticipantRepository(prisma);
    const t0 = Date.now() - 60_000;
    const newer = new Date(t0 + 5_000);
    await repo.setLastRead(conv.id, a, newer);
    await repo.setLastRead(conv.id, a, new Date(t0 + 1_000));
    const row = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: a } } });
    expect(row?.lastReadAt?.toISOString()).toBe(newer.toISOString());
    const later = new Date(t0 + 9_000);
    await repo.setLastRead(conv.id, a, later);
    expect((await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: a } } }))?.lastReadAt?.toISOString()).toBe(later.toISOString());
  });

  // Battery (13 Nov): a marker in the future — a server clock that ran ahead, or a local-time NOW() written into a
  // UTC column — would otherwise hold every new message as read until that time comes. The next read corrects it.
  it('a read marker in the future is corrected by the next read (forward-only never freezes the unread count)', async () => {
    const a = await person('sol');
    const b = await person('tia');
    const conv = await service().getOrCreateDirectConversation(a, b);
    const repo = createPrismaParticipantRepository(prisma);
    await repo.setLastRead(conv.id, a, new Date());
    await prisma.conversationParticipant.updateMany({ where: { conversationId: conv.id, userId: a }, data: { lastReadAt: new Date(Date.now() + 4 * 3_600_000) } });
    await service().postMessage(conv.id, b, { body: 'Fabrikam delivery at noon' });
    const now = new Date();
    await repo.setLastRead(conv.id, a, now);
    const row = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: conv.id, userId: a } } });
    expect(row?.lastReadAt?.toISOString()).toBe(now.toISOString());
    // …and a newer message after it counts as unread again.
    await new Promise((r) => setTimeout(r, 5));
    await service().postMessage(conv.id, b, { body: 'Northwind crane booked' });
    const mine = (await service().listConversations(a)).find((s) => s.conversation.id === conv.id);
    expect(mine?.unread).toBe(1);
  });
});

describe('#20 history pages by time and message, so a message in the same millisecond is never skipped', () => {
  async function tiedConversation(total: number, tieAt: (i: number) => number) {
    const a = await person('ida');
    const b = await person('jon');
    const conv = await service().getOrCreateDirectConversation(a, b);
    const t0 = Date.parse('2026-11-01T10:00:00.000Z');
    for (let i = 0; i < total; i++) {
      await prisma.chatMessage.create({ data: { conversationId: conv.id, userId: i % 2 ? a : b, body: `m${i}`, createdAt: new Date(t0 + tieAt(i) * 1000) } });
    }
    return { conv: conv.id, reader: a };
  }

  it('paging with the new cursor (time + message) sees every message, also when a tie sits on a page boundary', async () => {
    // 52 messages: the 2nd and 3rd oldest share a moment, so the boundary of the first page of 50 falls between them.
    const { conv, reader } = await tiedConversation(52, (i) => (i <= 1 ? i : i - 1));
    const svc = service();
    const seen = new Set<string>();
    let cursor: { before?: Date; beforeId?: string } = {};
    for (let pages = 0; pages < 10; pages++) {
      const page = await svc.listMessages(conv, reader, { ...cursor, limit: 50 });
      for (const m of page.messages) seen.add(m.id);
      if (page.messages.length < 50) break;
      cursor = { before: new Date(page.messages[0]!.createdAt), beforeId: page.messages[0]!.id };
    }
    expect(seen.size).toBe(52);
  });

  it('many ties (two senders at once, again and again): every message, each once, in order', async () => {
    const { conv, reader } = await tiedConversation(201, (i) => Math.floor(i / 2));
    const svc = service();
    const order: string[] = [];
    let cursor: { before?: Date; beforeId?: string } = {};
    for (let pages = 0; pages < 20; pages++) {
      const page = await svc.listMessages(conv, reader, { ...cursor, limit: 50 });
      order.unshift(...page.messages.map((m) => m.id));
      if (page.messages.length < 50) break;
      cursor = { before: new Date(page.messages[0]!.createdAt), beforeId: page.messages[0]!.id };
    }
    expect(new Set(order).size).toBe(201);
    expect(order).toHaveLength(201);
    const all = await prisma.chatMessage.findMany({ where: { conversationId: conv }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    expect(order).toEqual(all.map((m) => m.id));
  });

  it('the old cursor (time only — Android and the extension send it) still answers as before: the messages strictly older', async () => {
    const { conv, reader } = await tiedConversation(52, (i) => (i <= 1 ? i : i - 1));
    const svc = service();
    const first = await svc.listMessages(conv, reader, { limit: 50 });
    const older = await svc.listMessages(conv, reader, { before: new Date(first.messages[0]!.createdAt), limit: 50 });
    expect(older.messages.every((m) => new Date(m.createdAt) < new Date(first.messages[0]!.createdAt))).toBe(true);
    expect(older.messages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('#18 a message with a file is saved together with its file, or not at all', () => {
  it('when the file record can’t be saved, no message is left behind; a retry with the same client id saves both', async () => {
    const a = await person('kim');
    const b = await person('lee');
    const conv = await service().getOrCreateDirectConversation(a, b);
    let fail = true;
    // The database refuses the file's row (as a strict server refused a 200-character name before names were cleaned).
    const failing = prisma.$extends({
      query: {
        chatAttachment: {
          async create({ args, query }) {
            if (fail) throw new Error('Simulated: the file row could not be saved');
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const file = { fileName: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${tag}-a.pdf` };
    await expect(service(failing).postMessage(conv.id, a, { body: '', attachment: file, clientId: `c-${tag}` })).rejects.toThrow();
    expect(await prisma.chatMessage.count({ where: { conversationId: conv.id } })).toBe(0);
    fail = false;
    const retry = await service(failing).postMessage(conv.id, a, { body: '', attachment: file, clientId: `c-${tag}` });
    expect(retry.created).toBe(true);
    expect(retry.message.attachments.map((x) => x.fileName)).toEqual(['plan.pdf']);
    const again = await service().postMessage(conv.id, a, { body: '', attachment: { ...file, storageKey: `${tag}-b.pdf` }, clientId: `c-${tag}` });
    expect(again.created).toBe(false);
    expect(again.message.id).toBe(retry.message.id);
    expect(again.message.attachments.map((x) => x.storageKey)).toEqual([`${tag}-a.pdf`]);
    expect(await prisma.chatAttachment.count({ where: { message: { conversationId: conv.id } } })).toBe(1);
    // Review I1: the upload route keeps a stored file a saved record uses.
    expect(await service().fileInUse(`${tag}-a.pdf`)).toBe(true);
    expect(await service().fileInUse(`${tag}-b.pdf`)).toBe(false);
  });

  it('two copies of the same upload racing make one message with one file', async () => {
    const a = await person('max');
    const b = await person('ned');
    const conv = await service().getOrCreateDirectConversation(a, b);
    const svc = service();
    const results = await Promise.all(
      [1, 2, 3].map((i) => svc.postMessage(conv.id, a, { body: 'see file', attachment: { fileName: 'x.png', mimeType: 'image/png', sizeBytes: 1, storageKey: `${tag}-r${i}.png` }, clientId: `race-${tag}` })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    expect(results.every((r) => r.message.attachments.length === 1)).toBe(true);
    expect(await prisma.chatMessage.count({ where: { conversationId: conv.id } })).toBe(1);
    expect(await prisma.chatAttachment.count({ where: { message: { conversationId: conv.id } } })).toBe(1);
  });
});
