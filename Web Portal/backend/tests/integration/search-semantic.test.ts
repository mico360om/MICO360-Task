import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSemanticSearch } from '../../src/modules/search/search-semantic';
import { EmbeddingModelChangedError } from '../../src/modules/ai/ai-embeddings';
import { ProviderRefusedError } from '../../src/modules/ai/ai-completion';
import { portabilityProblems } from '../../src/lib/sql-portability';

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
/** How each embed call was asked: the sweep is background work (MICO360 AI waits 120 s), a question is not. */
const asked: Array<{ background?: boolean; question: boolean }> = [];
let model: { id: string; modelKey: string } | null = { id: `emb-${tag}`, modelKey: 'stand-in' };
const ai = {
  embeddingModel: async () => model,
  embed: async (texts: string[], opts?: { signal?: AbortSignal; background?: boolean }) => {
    asked.push({ background: opts?.background, question: texts.some((x) => x.includes('makes noise')) });
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
    expect(asked.filter((a) => !a.question).every((a) => a.background === true)).toBe(true);
    expect(asked.filter((a) => a.question)).toEqual([{ background: undefined, question: true }]);
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

  // Review minor 9: while MICO360 AI answers with another embedding model, or its quota is used up, the
  // sweep pauses 15 minutes instead of trying (and logging an error) every minute — and logs it once.
  it('pauses after another model answered or a used-up quota, and logs it once', async () => {
    let at = new Date('2026-11-11T08:00:00Z').getTime();
    let calls = 0;
    let refuse: Error | null = new EmbeddingModelChangedError('bge-m3:latest');
    const errors: string[] = [];
    const paused = createSemanticSearch({
      prisma,
      now: () => new Date(at),
      logger: { error: (m: string) => void errors.push(m) },
      ai: {
        embeddingModel: async () => ({ id: `emb2-${tag}`, modelKey: 'stand-in' }),
        embed: async (texts: string[]) => {
          calls += 1;
          if (refuse) throw refuse;
          return { model: `emb2-${tag}`, vectors: texts.map(vector) };
        },
      },
    });
    expect(await paused.embedPending(5)).toBe(0);
    expect(calls).toBe(1);
    expect(await paused.embedPending(5)).toBe(0); // a minute later: paused, nothing sent
    at += 60_000;
    expect(await paused.embedPending(5)).toBe(0);
    expect(calls).toBe(1);
    at += 15 * 60_000;
    refuse = new ProviderRefusedError(429, 'Quota exceeded: tokens per day.', true, 40000);
    expect(await paused.embedPending(5)).toBe(0); // tried again after 15 minutes: still refused
    expect(calls).toBe(2);
    expect(errors.filter((e) => /paused/.test(e))).toHaveLength(1); // one episode, one log
    at += 15 * 60_000;
    refuse = null;
    expect(await paused.embedPending(5)).toBeGreaterThan(0); // the episode is over
    await prisma.searchEmbedding.deleteMany({ where: { model: `emb2-${tag}` } });
  });
});

// 1.23.27 — the DB suite's first run on MariaDB 11.8.9 (the live server): VECTOR is a keyword there (11.7+), so the
// sweep's bare `vector` column was error 1064 and no item ever got a vector.
describe('the meaning-search SQL is portable to MariaDB', () => {
  it('every statement the sweep, the clean-up and a question send holds nothing MariaDB refuses', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    const m = `emb3-${tag}`;
    try {
      const own = createSemanticSearch({ prisma: client, ai: { embeddingModel: async () => ({ id: m, modelKey: 'stand-in' }), embed: async (texts: string[]) => ({ model: m, vectors: texts.map(vector) }) } });
      // This file's tasks still in the index (an earlier test removes one).
      const mine = (await prisma.taskSearchIndex.findMany({ where: { taskId: { in: Object.values(t) } }, select: { taskId: true } })).length;
      expect(mine).toBeGreaterThan(0);
      for (let i = 0; i < 20 && (await prisma.searchEmbedding.count({ where: { model: m, recordId: { in: Object.values(t) } } })) < mine; i++) await own.embedPending(500);
      expect(await prisma.searchEmbedding.count({ where: { model: m, recordId: { in: Object.values(t) } } })).toBe(mine);
      await own.nearest('my pump makes noise', { limit: 3 });
      await own.prune();
    } finally {
      await prisma.searchEmbedding.deleteMany({ where: { model: m } });
      await client.$disconnect();
    }
    expect(sent.some((q) => /INSERT INTO search_embeddings/.test(q))).toBe(true);
    expect(sent.flatMap((q) => portabilityProblems(q).map((p) => `${p} — ${q.slice(0, 120)}`))).toEqual([]);
  });
});
