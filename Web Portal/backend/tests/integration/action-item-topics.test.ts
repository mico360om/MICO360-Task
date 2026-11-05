import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createActionItemService } from '../../src/modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import { createPrismaAgendaRepository } from '../../src/modules/meetings/prisma-agenda-repository';

// 1.23.0 Table view: an action item's agenda topic, stored and checked against the real database —
// the service wired as server.ts wires it (the topic must be on the item's own meeting's agenda).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const topics = createPrismaAgendaRepository(prisma);
const service = createActionItemService({
  actionItems: createPrismaActionItemRepository(prisma),
  topicMeetingOf: async (agendaItemId) => (await topics.findById(agendaItemId))?.meetingId ?? null,
});

let ids: Record<string, string> = {};

async function cleanup() {
  const meetings = await prisma.meeting.findMany({ where: { title: { startsWith: 'topic-test' } }, select: { id: true } });
  const mids = meetings.map((m) => m.id);
  await prisma.actionItem.deleteMany({ where: { meetingId: { in: mids } } });
  await prisma.agendaItem.deleteMany({ where: { meetingId: { in: mids } } });
  await prisma.meeting.deleteMany({ where: { id: { in: mids } } });
  await prisma.user.deleteMany({ where: { email: 'topic-owner@mico360.test' } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: 'topic-owner@mico360.test', username: 'topic-owner', passwordHash: 'x', firstName: 'Topic', lastName: 'Owner' } });
  const meeting = (title: string) => prisma.meeting.create({ data: { title, organizerId: owner.id, createdById: owner.id, startAt: new Date('2026-11-05T06:00:00Z') } });
  const m1 = await meeting('topic-test one');
  const m2 = await meeting('topic-test two');
  const topic = (meetingId: string, title: string, position: number) => prisma.agendaItem.create({ data: { meetingId, title, position } });
  ids = {
    owner: owner.id,
    m1: m1.id,
    a1: (await topic(m1.id, 'Site progress', 0)).id,
    a2: (await topic(m1.id, 'Safety', 1)).id,
    b1: (await topic(m2.id, 'Elsewhere', 0)).id,
  };
});

describe('Action item topics (integration)', () => {
  it('stores a topic of the same meeting when added, changed or taken off', async () => {
    const item = await service.addItem(ids.m1!, ids.owner!, { description: 'Order rebar', agendaItemId: ids.a1! });
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).agendaItemId).toBe(ids.a1);
    await service.updateItem(item.id, { agendaItemId: ids.a2! });
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).agendaItemId).toBe(ids.a2);
    await service.updateItem(item.id, { agendaItemId: null });
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).agendaItemId).toBeNull();
  });

  it('refuses a topic of another meeting, or one that doesn’t exist, and keeps what was there', async () => {
    const item = await service.addItem(ids.m1!, ids.owner!, { description: 'Order rebar', agendaItemId: ids.a1! });
    await expect(service.updateItem(item.id, { agendaItemId: ids.b1! })).rejects.toThrow(/not on this meeting’s agenda/);
    await expect(service.updateItem(item.id, { agendaItemId: 'no-such-topic' })).rejects.toThrow(/not on this meeting’s agenda/);
    await expect(service.addItem(ids.m1!, ids.owner!, { description: 'x', agendaItemId: ids.b1! })).rejects.toThrow(/not on this meeting’s agenda/);
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).agendaItemId).toBe(ids.a1);
  });

  it('a topic taken off the agenda leaves its items with none (the schema’s SetNull)', async () => {
    const item = await service.addItem(ids.m1!, ids.owner!, { description: 'Order rebar', agendaItemId: ids.a1! });
    await prisma.agendaItem.delete({ where: { id: ids.a1! } });
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).agendaItemId).toBeNull();
  });
});
