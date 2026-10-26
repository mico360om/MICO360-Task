import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMicoAiRepository } from '../../src/modules/mico-ai/prisma-mico-ai-repository';
import type { CreateTaskItem } from '../../src/modules/mico-ai/mico-ai-actions-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. A card of proposed changes is
// stored with its answer; Confirm and Undo move it from one state to the next in one statement, so a
// double click (or two tabs) can never carry it out twice.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMicoAiRepository(prisma);
const OMAR = 'mico-ai-proposal-test-omar';

const item: CreateTaskItem = {
  id: 'c1',
  type: 'create_task',
  needs: [],
  problem: null,
  locked: false,
  warning: null,
  fields: { title: 'فحص الصمامات — valve check', projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'HIGH', description: '' },
  labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
};

async function cleanup() {
  await prisma.micoAiChat.deleteMany({ where: { userId: OMAR } });
}
async function answer() {
  const chat = await repo.createChat(OMAR, 'Changes');
  const m = await repo.addMessage(chat.id, { role: 'assistant', text: 'Here are the tasks.', content: { kind: 'proposal' }, status: 'DONE' });
  return { chat, m };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(cleanup);

describe('MICO AI proposals in the database (integration)', () => {
  it('a card is stored with its answer (Arabic and all) and read back by its message', async () => {
    const { m } = await answer();
    const p = await repo.createProposal({ messageId: m.id, userId: OMAR, items: [item], note: 'Only the first 50 changes are here.' });
    expect(p).toMatchObject({ messageId: m.id, userId: OMAR, status: 'PROPOSED', note: 'Only the first 50 changes are here.', sendInvites: true, results: null, undo: null, confirmedAt: null });
    expect((await repo.getProposal(m.id))!.items).toEqual([item]);
    expect((await repo.proposalsFor([m.id, 'nope'])).map((x) => x.id)).toEqual([p.id]);
    expect(await repo.getProposal('nope')).toBeNull();
    // One card per answer.
    await expect(repo.createProposal({ messageId: m.id, userId: OMAR, items: [item], note: null })).rejects.toThrow();
  });

  it('only one of several confirms at the same moment moves the card on', async () => {
    const { m } = await answer();
    const p = await repo.createProposal({ messageId: m.id, userId: OMAR, items: [item], note: null });
    const tries = await Promise.all(Array.from({ length: 6 }, () => repo.moveProposal(p.id, ['PROPOSED'], 'CONFIRMING', { sendInvites: false })));
    expect(tries.filter(Boolean)).toHaveLength(1);
    expect(await repo.getProposal(m.id)).toMatchObject({ status: 'CONFIRMING', sendInvites: false });
    expect(await repo.moveProposal(p.id, ['PROPOSED'], 'CANCELLED')).toBe(false);
  });

  it('results are written as each change is made, then the card is done with its Undo window', async () => {
    const { m } = await answer();
    const p = await repo.createProposal({ messageId: m.id, userId: OMAR, items: [item], note: null });
    await repo.moveProposal(p.id, ['PROPOSED'], 'CONFIRMING', { items: [{ ...item, fields: { ...item.fields, title: 'Edited' } }] });
    const results = { c1: { status: 'done' as const, message: null, link: { label: 'RIG-31', url: '?task=t31' }, undo: { kind: 'task-created' as const, taskId: 't31', projectId: 'p-rig', touch: { version: 1, activity: 2, tags: 0, watchers: 0, links: 0, assigneeIds: ['u-sara'] } } } };
    expect(await repo.updateProposal(p.id, { results }, 'CONFIRMING')).toBe(true);
    const at = new Date('2026-10-24T08:00:00.000Z');
    const until = new Date('2026-10-24T08:15:00.000Z');
    expect(await repo.moveProposal(p.id, ['CONFIRMING'], 'DONE', { confirmedAt: at, undoUntil: until })).toBe(true);
    const done = (await repo.getProposal(m.id))!;
    expect(done).toMatchObject({ status: 'DONE', results, confirmedAt: at, undoUntil: until });
    expect((done.items[0] as CreateTaskItem).fields.title).toBe('Edited');
    // Not while it is in another state.
    expect(await repo.updateProposal(p.id, { results: {} }, 'CONFIRMING')).toBe(false);
    expect(await repo.moveProposal(p.id, ['DONE'], 'UNDOING')).toBe(true);
    expect(await repo.moveProposal(p.id, ['UNDOING'], 'UNDONE', { undo: { c1: { status: 'undone', message: null } }, undoneAt: until })).toBe(true);
    expect((await repo.getProposal(m.id))!.undo).toEqual({ c1: { status: 'undone', message: null } });
  });

  it('deleting the chat deletes its cards', async () => {
    const { chat, m } = await answer();
    await repo.createProposal({ messageId: m.id, userId: OMAR, items: [item], note: null });
    await repo.deleteChat(OMAR, chat.id);
    expect(await prisma.micoAiProposal.count({ where: { messageId: m.id } })).toBe(0);
  });
});
