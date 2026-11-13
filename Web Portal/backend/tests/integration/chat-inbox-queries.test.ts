import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  createPrismaChatMemberLookup,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import type { ChatMemberLookup, MessageRepository, ParticipantRepository } from '../../src/modules/chat/chat-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Review finding #35 (13 Nov 2026): one GET /conversations made ~5 queries per conversation (60
// conversations → 304). It is now a handful whatever the number — with exactly the same answer:
// participants, unread counts, last messages, settings, read-only notes and order (the website, the
// app and the extension read it).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let queries = 0;
const counted = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
counted.$on('query' as never, () => { queries += 1; });

const tag = randomBytes(3).toString('hex');
const users: string[] = [];
const conversations: string[] = [];
let company = '';
let me = '';
let few = '';
const projectsOf = new Map<string, string[]>();
const DAY = 86_400_000;

/** The real Prisma ports, with the projects the person may open given (the channels here have no project rows). */
function service(db: PrismaClient, opts: { batched: boolean }) {
  const participants = createPrismaParticipantRepository(db);
  const messages = createPrismaMessageRepository(db);
  const real = createPrismaChatMemberLookup(db);
  // The per-conversation reads only (as before #35): the batch reads left out.
  const plainParticipants: ParticipantRepository = { ...participants, listByConversations: undefined };
  const plainMessages: MessageRepository = { ...messages, latestMany: undefined, countAfterMany: undefined };
  const members: ChatMemberLookup = {
    ...real,
    ...(opts.batched ? {} : { colleaguesAmong: undefined }),
    accessibleProjectIds: async (userId) => projectsOf.get(userId) ?? [],
    teamSince: async (userId) => new Map((projectsOf.get(userId) ?? []).map((p, i) => [p, new Date(Date.now() - (30 + (i % 3) * 20) * DAY)])),
  };
  return createMessageService({
    conversations: createPrismaConversationRepository(db),
    participants: opts.batched ? participants : plainParticipants,
    messages: opts.batched ? messages : plainMessages,
    reactions: createPrismaReactionRepository(db),
    members,
  });
}

async function person(name: string, colleague: boolean) {
  const u = await prisma.user.create({ data: { email: `${name}-${tag}@sb3.test`, username: `${name}${tag}`, passwordHash: 'x', firstName: name.startsWith('nameless') ? ' ' : name, lastName: 'Test' } });
  users.push(u.id);
  if (colleague) await prisma.companyMember.create({ data: { companyId: company, userId: u.id } });
  return u.id;
}

/** A person with `channels` project channels and `direct` direct chats (half with colleagues), in every state the list shows. */
async function inbox(owner: string, channels: number, direct: number) {
  const t0 = Date.now() - 10 * DAY;
  const at = (i: number) => new Date(t0 + i * 60_000);
  let n = 0;
  const projects: string[] = [];
  for (let i = 0; i < channels; i++) {
    const projectId = `p${tag}-${owner.slice(-4)}-${i}`;
    projects.push(projectId);
    const c = await prisma.conversation.create({ data: { kind: 'PROJECT', projectId } });
    conversations.push(c.id);
    if (i % 4 === 3) continue; // a channel nobody wrote in yet
    const other = users[i % users.length]!;
    await prisma.chatMessage.createMany({ data: [{ conversationId: c.id, userId: other, body: `channel ${i} hello`, createdAt: at(n++) }, { conversationId: c.id, userId: owner, body: `channel ${i} reply`, createdAt: at(n++) }, { conversationId: c.id, userId: other, body: `channel ${i} latest`, createdAt: at(n++) }] });
    // Read up to the first message in some; settings in others; nobody's row in the rest.
    if (i % 3 === 0) await prisma.conversationParticipant.create({ data: { conversationId: c.id, userId: owner, lastReadAt: at(n - 3), favorite: i % 2 === 0, mutedAt: i % 5 === 0 ? new Date() : null } });
    if (i % 3 === 1) await prisma.conversationParticipant.create({ data: { conversationId: c.id, userId: other, lastReadAt: at(n) } });
  }
  projectsOf.set(owner, projects);
  for (let i = 0; i < direct; i++) {
    const other = await person(`${i % 7 === 6 ? 'nameless' : 'dm'}${i}x${owner.slice(-3)}`, i % 2 === 0);
    const c = await prisma.conversation.create({ data: { kind: 'DIRECT' } });
    conversations.push(c.id);
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: c.id, userId: owner, lastReadAt: i % 3 === 0 ? null : at(n), archivedAt: i % 4 === 0 ? new Date() : null, lastDeliveredAt: i % 5 === 0 ? new Date() : null },
        { conversationId: c.id, userId: other, lastReadAt: i % 2 ? at(n) : null },
      ],
    });
    let last = await prisma.chatMessage.create({ data: { conversationId: c.id, userId: other, body: `hello ${i}`, createdAt: at(n++) } });
    if (i % 3 === 1) last = await prisma.chatMessage.create({ data: { conversationId: c.id, userId: owner, body: `answer ${i}`, createdAt: at(n++) } });
    // A deleted last message (its text blanked) in some; the last two in the same millisecond in others.
    if (i % 5 === 2) last = await prisma.chatMessage.create({ data: { conversationId: c.id, userId: other, body: '', deletedAt: new Date(), createdAt: at(n++) } });
    if (i % 9 === 4) await prisma.chatMessage.create({ data: { conversationId: c.id, userId: i % 2 ? owner : other, body: `same moment ${i}`, createdAt: last.createdAt } });
  }
}

beforeAll(async () => {
  await prisma.$connect();
  company = (await prisma.company.create({ data: { name: `Northwind Trading ${tag}`, code: `N${tag}`.slice(0, 10) } })).id;
  me = await person('me', true);
  few = await person('few', true);
  await inbox(me, 20, 40); // 60 conversations
  await inbox(few, 4, 6); // 10 conversations
}, 120_000);

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  await prisma.companyMember.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.company.deleteMany({ where: { id: company } });
  await prisma.$disconnect();
  await counted.$disconnect();
});

describe('the conversation list (GET /conversations) reads in a few queries (#35)', () => {
  it('60 conversations take about as many queries as 10 — a handful, not five per conversation', async () => {
    const svc = service(counted, { batched: true });
    await svc.listConversations(few); // connect
    queries = 0;
    const small = await svc.listConversations(few);
    const forFew = queries;
    queries = 0;
    const big = await svc.listConversations(me);
    const forMe = queries;
    console.log(`[#35] GET /conversations: 10 conversations ${forFew} queries, 60 conversations ${forMe} queries`);
    expect(small).toHaveLength(10);
    expect(big).toHaveLength(60);
    expect(forMe).toBeLessThanOrEqual(15);
    expect(forMe).toBeLessThanOrEqual(forFew + 2);
  });

  it('answers exactly as the one-conversation-at-a-time reads did (unread, last message, people, settings, read-only, order)', async () => {
    for (const owner of [me, few]) {
      const batched = await service(prisma, { batched: true }).listConversations(owner);
      const plain = await service(prisma, { batched: false }).listConversations(owner);
      expect(batched).toEqual(plain);
      // The states above are all there.
      expect(batched.some((s) => s.unread > 0) && batched.some((s) => s.unread === 0)).toBe(true);
      expect(batched.some((s) => s.readOnly !== null) && batched.some((s) => s.conversation.kind === 'DIRECT' && s.readOnly === null)).toBe(true);
      expect(batched.some((s) => s.lastMessage === null)).toBe(true);
    }
    expect((await service(prisma, { batched: true }).listConversations(me)).some((s) => s.lastMessage?.deletedAt && s.lastMessage.body === '')).toBe(true);
  });
});
