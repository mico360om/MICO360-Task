import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  createPrismaChatAttachmentRepository,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createMessageService, directKeyOf } from '../../src/modules/chat/message-service';
import { portabilityProblems } from '../../src/lib/sql-portability';

// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
// Review fix #17 (batch 4b): the backfill gives each existing two-person direct conversation its pair's key —
// and, where a pair already has several (made at the same moment before the key), keys ONE of them (the most
// messages, then the oldest) and leaves the others exactly as they are. Nothing is deleted or merged.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const FILE = resolve(__dirname, '../../prisma/migrations/20261116010100_conversation_direct_key_backfill/migration.sql');
const statements = () =>
  readFileSync(FILE, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
const backfill = async () => {
  for (const s of statements()) await prisma.$executeRawUnsafe(s);
};

const tag = randomBytes(3).toString('hex');
const users: string[] = [];
const convs: string[] = [];
const DAY = 86_400_000;
const t0 = Date.parse('2026-06-01T08:00:00.000Z');

async function person(name: string) {
  const u = await prisma.user.create({ data: { email: `${name}-${tag}@sb4b.test`, username: `${name}${tag}`, passwordHash: 'x', firstName: name, lastName: 'Test' } });
  users.push(u.id);
  return u.id;
}
/** A direct conversation made the old way (no key), with these people and this many messages. */
async function oldChat(people: string[], messages: number, day: number, kind: 'DIRECT' | 'PROJECT' = 'DIRECT') {
  const c = await prisma.conversation.create({ data: { kind, createdAt: new Date(t0 + day * DAY), ...(kind === 'PROJECT' ? { projectId: `p-${tag}-${day}` } : {}) } });
  convs.push(c.id);
  if (people.length) await prisma.conversationParticipant.createMany({ data: people.map((userId) => ({ conversationId: c.id, userId })) });
  for (let i = 0; i < messages; i++) {
    await prisma.chatMessage.create({ data: { conversationId: c.id, userId: people[i % people.length]!, body: `${day}/${i}`, createdAt: new Date(t0 + day * DAY + i * 1000) } });
  }
  return c.id;
}
const keyOf = async (id: string) => (await prisma.conversation.findUnique({ where: { id }, select: { directKey: true } }))?.directKey ?? null;
const snapshot = async () =>
  (await prisma.chatMessage.findMany({ where: { conversationId: { in: convs } }, orderBy: { id: 'asc' }, select: { id: true, conversationId: true, body: true, createdAt: true } })).map((m) => JSON.stringify(m));

let ana = '', ben = '', cat = '', dan = '', eve = '', fay = '', gil = '', hal = '', ida = '';
const c: Record<string, string> = {};

beforeAll(async () => {
  await prisma.$connect();
  for (const name of ['ana', 'ben', 'cat', 'dan', 'eve', 'fay', 'gil', 'hal', 'ida']) await person(name);
  [ana, ben, cat, dan, eve, fay, gil, hal, ida] = users as [string, string, string, string, string, string, string, string, string];
  // Ana + Ben: three conversations — the busiest two have 5 messages each; the older of those is kept.
  c.abOld = await oldChat([ana, ben], 1, 1);
  c.abBusy = await oldChat([ben, ana], 5, 2);
  c.abBusyNewer = await oldChat([ana, ben], 5, 3);
  // Cat + Dan: two, no messages in either: the older.
  c.cdNewer = await oldChat([cat, dan], 0, 5);
  c.cdOlder = await oldChat([dan, cat], 0, 4);
  // Eve + Fay: one.
  c.ef = await oldChat([eve, fay], 2, 6);
  // Odd ones, left alone: one person, three people, a project channel.
  c.lonely = await oldChat([gil], 1, 7);
  c.three = await oldChat([gil, hal, ida], 1, 8);
  c.channel = await oldChat([gil, hal], 1, 9, 'PROJECT');
  // Gil + Hal already have a keyed one (made by the new code) and an older one without: it stays without.
  c.ghOld = await oldChat([gil, hal], 9, 10);
  const keyed = await prisma.conversation.create({ data: { kind: 'DIRECT', directKey: directKeyOf(gil, hal), createdAt: new Date(t0 + 11 * DAY), participants: { create: [{ userId: gil }, { userId: hal }] } } });
  c.ghKeyed = keyed.id;
  convs.push(keyed.id);
}, 60_000);

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { id: { in: convs } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe('the direct-key backfill on data with duplicate conversations', () => {
  it('is portable SQL (MySQL 8 and MariaDB)', () => {
    expect(statements().length).toBeGreaterThan(0);
    for (const s of statements()) expect(portabilityProblems(s)).toEqual([]);
  });

  it('keys one conversation per pair — the most messages, then the oldest — and leaves the others exactly as they were', async () => {
    const before = await snapshot();
    const countBefore = await prisma.conversation.count({ where: { id: { in: convs } } });
    const peopleBefore = await prisma.conversationParticipant.count({ where: { conversationId: { in: convs } } });
    await backfill();
    expect(await keyOf(c.abBusy!)).toBe(directKeyOf(ana, ben));
    expect(await keyOf(c.abOld!)).toBeNull();
    expect(await keyOf(c.abBusyNewer!)).toBeNull();
    expect(await keyOf(c.cdOlder!)).toBe(directKeyOf(cat, dan));
    expect(await keyOf(c.cdNewer!)).toBeNull();
    expect(await keyOf(c.ef!)).toBe(directKeyOf(eve, fay));
    expect(await keyOf(c.lonely!)).toBeNull();
    expect(await keyOf(c.three!)).toBeNull();
    expect(await keyOf(c.channel!)).toBeNull();
    expect(await keyOf(c.ghKeyed!)).toBe(directKeyOf(gil, hal));
    expect(await keyOf(c.ghOld!)).toBeNull();
    // Nothing deleted, moved or changed.
    expect(await snapshot()).toEqual(before);
    expect(await prisma.conversation.count({ where: { id: { in: convs } } })).toBe(countBefore);
    expect(await prisma.conversationParticipant.count({ where: { conversationId: { in: convs } } })).toBe(peopleBefore);
  });

  it('is safe to run again: nothing changes', async () => {
    const keys = await prisma.conversation.findMany({ where: { id: { in: convs } }, orderBy: { id: 'asc' }, select: { id: true, directKey: true } });
    const before = await snapshot();
    await backfill();
    expect(await prisma.conversation.findMany({ where: { id: { in: convs } }, orderBy: { id: 'asc' }, select: { id: true, directKey: true } })).toEqual(keys);
    expect(await snapshot()).toEqual(before);
  });

  it('afterwards “Message” opens the keyed conversation; every old one stays in both people’s chat lists', async () => {
    const svc = createMessageService({
      conversations: createPrismaConversationRepository(prisma),
      participants: createPrismaParticipantRepository(prisma),
      messages: createPrismaMessageRepository(prisma),
      reactions: createPrismaReactionRepository(prisma),
      attachments: createPrismaChatAttachmentRepository(prisma),
      members: { canAccessProject: async () => false, accessibleProjectIds: async () => [], isActiveUser: async () => true, colleagues: async () => true },
    });
    expect((await svc.getOrCreateDirectConversation(ana, ben)).id).toBe(c.abBusy);
    expect((await svc.getOrCreateDirectConversation(ben, ana)).id).toBe(c.abBusy);
    expect((await svc.getOrCreateDirectConversation(dan, cat)).id).toBe(c.cdOlder);
    expect((await svc.getOrCreateDirectConversation(hal, gil)).id).toBe(c.ghKeyed);
    const anaList = (await svc.listConversations(ana)).map((s) => s.conversation.id).sort();
    expect(anaList).toEqual([c.abOld!, c.abBusy!, c.abBusyNewer!].sort());
    // No new conversation was made for any pair.
    expect(await prisma.conversation.count({ where: { participants: { some: { userId: { in: [ana, ben, cat, dan] } } } } })).toBe(5);
  });
});
