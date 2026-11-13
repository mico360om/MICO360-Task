import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { cosine, EmbeddingModelChangedError, fromVector, toVector } from '../ai/ai-embeddings';
import { ProviderRefusedError } from '../ai/ai-completion';
import { cutChars } from '../ai/ai-text';
import type { SearchKind } from './search-types';

/**
 * 1.23 meaning ("semantic") search — only when an embedding model is set up in AI Management. A sweep
 * gives each indexed item a vector of its title and the start of its text (a meeting: only what an
 * invitee may see of it, so a hidden decision never makes a meeting "near" a question); a question's
 * vector is compared with them and the nearest are handed back as candidates — which the search then
 * keeps only when the person may see them (search-engine `only`), like every other result.
 */

/**
 * 1.23.6: the kinds given meaning vectors besides tasks — the 1.23 kinds. Checklist items, contacts,
 * clients and client accounts are short names found by their words (no vectors made, none compared).
 */
export const MEANING_KINDS = ['project', 'meeting', 'note', 'minutes', 'file', 'inspection'] as const;

/** The text a vector is made from: the title and this much of the rest. */
const TEXT_CHARS = 1500;
/** Items embedded per sweep run. */
const BATCH = 100;
/** Texts handed to one embed() (stored together); embedTexts splits them further to the provider's limits. */
const PER_CALL = 25;
/** Vectors of gone items are removed this often (by the sweep). */
const PRUNE_EVERY_MS = 30 * 60_000;
/** The sweep rests this long after another embedding model answered or the quota was used up. */
const PAUSE_MS = 15 * 60_000;
/** A question is compared with at most this many items (the most recently embedded). */
export const MAX_COMPARED = 30_000;

export interface SemanticDeps {
  prisma: PrismaClient;
  ai: {
    embeddingModel(): Promise<{ id: string; modelKey: string } | null>;
    /** `background`: the sweep (MICO360 AI is given the 120 s its guide asks for); a question is not. */
    embed(texts: string[], opts?: { signal?: AbortSignal; background?: boolean }): Promise<{ model: string; vectors: number[][] }>;
  };
  logger?: { error(message: string, meta?: Record<string, unknown>): void };
  now?: () => Date;
}

const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16);
// The body is cut whole characters only (never inside an emoji's pair: review I2).
const textOf = (head: Buffer | null, body: Buffer | null) => `${(head ?? Buffer.alloc(0)).toString('utf8').trim()}\n${cutChars((body ?? Buffer.alloc(0)).toString('utf8'), TEXT_CHARS)}`.trim();

export function createSemanticSearch({ prisma, ai, logger, now = () => new Date() }: SemanticDeps) {
  /** Is meaning search on (an embedding model set up)? */
  async function ready(): Promise<boolean> {
    return (await ai.embeddingModel().catch(() => null)) !== null;
  }

  // Review minor 9: another embedding model answering (MICO360 AI) or a used-up quota lasts a while; the
  // sweep pauses PAUSE_MS instead of trying — and logging an error — every minute, and says so once.
  let pausedUntil = 0;
  let pauseLogged = false;

  /** The sweep: items without a vector of the current model, or indexed since theirs was made. Returns how many. */
  async function embedPending(limit = BATCH): Promise<number> {
    if (now().getTime() < pausedUntil) return 0;
    const model = await ai.embeddingModel().catch(() => null);
    if (!model) return 0;
    if (now().getTime() - prunedAt > PRUNE_EVERY_MS) await prune().catch((err: unknown) => logger?.error('search: removing old meaning vectors failed', { err }));
    const tasks = await prisma.$queryRaw<{ id: string; head: Buffer; body: Buffer; hash: string | null; model: string | null }[]>`SELECT si.taskId AS id, si.head AS head, si.doc AS body, e.textHash AS hash, e.model AS model
      FROM task_search_index si LEFT JOIN search_embeddings e ON e.kind = 'task' AND e.recordId = si.taskId
      WHERE e.recordId IS NULL OR e.model <> ${model.id} OR e.embeddedAt < si.indexedAt LIMIT ${limit}`;
    const others = tasks.length >= limit ? [] : await prisma.$queryRaw<{ kind: string; id: string; head: Buffer; body: Buffer | null; hash: string | null; model: string | null }[]>`SELECT si.kind AS kind, si.recordId AS id, si.head AS head,
        (CASE WHEN si.kind = 'meeting' THEN si.limited ELSE si.doc END) AS body, e.textHash AS hash, e.model AS model
      FROM search_index si LEFT JOIN search_embeddings e ON e.kind = si.kind AND e.recordId = si.recordId
      WHERE si.kind IN (${Prisma.join([...MEANING_KINDS])}) AND (e.recordId IS NULL OR e.model <> ${model.id} OR e.embeddedAt < si.indexedAt) LIMIT ${limit - tasks.length}`;
    const found = [...tasks.map((t) => ({ kind: 'task', id: t.id, text: textOf(t.head, t.body), hash: t.hash, model: t.model })), ...others.map((o) => ({ kind: o.kind, id: o.id, text: textOf(o.head, o.body), hash: o.hash, model: o.model }))];
    // Indexed again with the same text (review M3): the vector it has still holds — only its time moves on.
    const same = found.filter((f) => f.model === model.id && f.hash === hash(f.text));
    for (const f of same) await prisma.searchEmbedding.updateMany({ where: { kind: f.kind, recordId: f.id }, data: { embeddedAt: now() } });
    const items = found.filter((f) => !same.includes(f));
    let done = 0;
    for (let i = 0; i < items.length; i += PER_CALL) {
      const chunk = items.slice(i, i + PER_CALL);
      try {
        const { model: used, vectors } = await ai.embed(chunk.map((c) => c.text), { background: true });
        const at = now();
        // `vector` quoted: a keyword in MariaDB 11.7 and later (the live server; unquoted it was error 1064).
        await prisma.$executeRaw`INSERT INTO search_embeddings (kind, recordId, model, dims, \`vector\`, textHash, embeddedAt) VALUES ${Prisma.join(
          chunk.map((c, k) => Prisma.sql`(${c.kind}, ${c.id}, ${used}, ${vectors[k]!.length}, ${toVector(vectors[k]!)}, ${hash(c.text)}, ${at})`),
        )} ON DUPLICATE KEY UPDATE model = VALUES(model), dims = VALUES(dims), \`vector\` = VALUES(\`vector\`), textHash = VALUES(textHash), embeddedAt = VALUES(embeddedAt)`;
        done += chunk.length;
        pauseLogged = false;
      } catch (err) {
        if (err instanceof EmbeddingModelChangedError || (err instanceof ProviderRefusedError && err.quota)) {
          pausedUntil = now().getTime() + PAUSE_MS;
          if (!pauseLogged) logger?.error('search: meaning vectors paused for 15 minutes', { err });
          pauseLogged = true;
        } else logger?.error('search: making meaning vectors failed', { err });
        break;
      }
    }
    return done;
  }

  /** Remove the vectors of items no longer in either index (deleted, gone). */
  let prunedAt = 0;
  async function prune(): Promise<void> {
    prunedAt = now().getTime();
    await prisma.$executeRaw`DELETE FROM search_embeddings WHERE kind = 'task' AND recordId NOT IN (SELECT taskId FROM task_search_index)`;
    await prisma.$executeRaw`DELETE e FROM search_embeddings e LEFT JOIN search_index si ON si.kind = e.kind AND si.recordId = e.recordId WHERE e.kind <> 'task' AND si.recordId IS NULL`;
  }

  /** The items nearest in meaning to a question (any person's: the search keeps only what they may see). */
  async function nearest(question: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<{ kind: SearchKind; id: string; score: number }[]> {
    const model = await ai.embeddingModel();
    if (!model) return [];
    const { vectors } = await ai.embed([question], { signal: opts.signal });
    const q = vectors[0]!;
    const limit = opts.limit ?? 40;
    const best: { kind: SearchKind; id: string; score: number }[] = [];
    const PAGE = 2000;
    for (let offset = 0; offset < MAX_COMPARED; offset += PAGE) {
      if (opts.signal?.aborted) break;
      const rows = await prisma.$queryRaw<{ kind: string; id: string; vector: Buffer }[]>`SELECT kind, recordId AS id, \`vector\` FROM search_embeddings WHERE model = ${model.id} AND dims = ${q.length}
        ORDER BY embeddedAt DESC, recordId LIMIT ${PAGE} OFFSET ${offset}`;
      for (const r of rows) {
        const score = cosine(q, fromVector(r.vector));
        if (best.length < limit || score > best[best.length - 1]!.score) {
          best.push({ kind: r.kind as SearchKind, id: r.id, score });
          best.sort((a, b) => b.score - a.score);
          if (best.length > limit) best.pop();
        }
      }
      if (rows.length < PAGE) break;
    }
    return best;
  }

  return { ready, embedPending, nearest, prune };
}

export type SemanticSearch = ReturnType<typeof createSemanticSearch>;
