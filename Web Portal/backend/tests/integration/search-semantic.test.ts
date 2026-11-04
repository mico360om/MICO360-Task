import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSemanticSearch } from '../../src/modules/search/search-semantic';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 meaning search: vectors made by a sweep (only with an embedding model), nearest items for a
// question, unchanged text never embedded again (review M3), vectors of gone items removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const taskIndex = createTaskSearchIndex({ prisma });
const tag = Math.random().toString(36).slice(2, 8);
const WORDS = ['pump', 'valve', 'crane'];
/** A stand-in embedding model: one number per known word, so "pump" questions are near pump tasks. */
const vector = (text: string) => WORDS.map((w) => (text.toLowerCase().includes(w) ? 1 : 0.01));
let embedded: string[] = [];
let model: { id: string; modelKey: string } | null = { id: `emb-${tag}`, modelKey: 'stand-in' };
const ai = {
  embeddingModel: async () => model,
  embed: async (texts: string[]) => {
    embedded.push(...texts);
    return { model: model!.id, vectors: texts.map(vector) };
  },
};
const semantic = createSemanticSearch({ prisma, ai });

let user = '';
let projectId = '';
const t: Record<string, string> = {};

beforeAll(async () => {
  await prisma.$connect();
  user = (await prisma.user.create({ data: { email: `sem-${tag}@x.test`, username: `sem_${tag}`, passwordHash: 'x', firstName: 'Sem', lastName: 'Antic' } })).id;
  projectId = (await prisma.project.create({ data: { code: `SM${tag.toUpperCase()}`, name: 'Meaning', createdById: user } })).id;
  const col = await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } });
  let n = 0;
  for (const [k, title] of [['pump', `Fix the pump ${tag}`], ['valve', `Grease the valve ${tag}`], ['crane', `Inspect the crane ${tag}`]] as const) {
    n += 1;
    t[k] = (await prisma.task.create({ data: { key: `SM${tag.toUpperCase()}-${n}`, title, projectId, columnId: col.id, createdById: user } })).id;
  }
  await taskIndex.refresh(Object.values(t));
});

afterAll(async () => {
  await prisma.searchEmbedding.deleteMany({ where: { model: `emb-${tag}` } });
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: user } });
  await prisma.$disconnect();
});

describe('meaning search (database)', () => {
  it('nothing without an embedding model', async () => {
    model = null;
    expect(await semantic.ready()).toBe(false);
    expect(await semantic.embedPending(500)).toBe(0);
    model = { id: `emb-${tag}`, modelKey: 'stand-in' };
  });

  it('makes vectors in the sweep and finds the nearest items for a question', async () => {
    for (let i = 0; i < 20 && (await prisma.searchEmbedding.count({ where: { model: `emb-${tag}`, recordId: { in: Object.values(t) } } })) < 3; i++) await semantic.embedPending(500);
    expect(await prisma.searchEmbedding.count({ where: { model: `emb-${tag}`, recordId: { in: Object.values(t) } } })).toBe(3);
    const near = await semantic.nearest('my pump makes noise', { limit: 2 });
    expect(near[0]).toMatchObject({ kind: 'task', id: t.pump });
  });

  it('review M3: an item indexed again with the same text is not embedded again; one whose text changed is', async () => {
    await taskIndex.refresh([t.valve!]);
    embedded = [];
    for (let i = 0; i < 20; i++) await semantic.embedPending(500);
    expect(embedded.some((x) => x.includes(`grease the valve ${tag}`))).toBe(false);
    await prisma.task.update({ where: { id: t.valve! }, data: { title: `Grease the pump valve ${tag}` } });
    await taskIndex.refresh([t.valve!]);
    for (let i = 0; i < 20 && !embedded.some((x) => x.includes(`grease the pump valve ${tag}`)); i++) await semantic.embedPending(500);
    expect(embedded.some((x) => x.includes(`grease the pump valve ${tag}`))).toBe(true);
  });

  it('review M3: a gone item’s vector is removed', async () => {
    await prisma.task.update({ where: { id: t.crane! }, data: { deletedAt: new Date() } });
    await taskIndex.refresh([t.crane!]);
    await semantic.prune();
    expect(await prisma.searchEmbedding.count({ where: { kind: 'task', recordId: t.crane! } })).toBe(0);
  });
});
