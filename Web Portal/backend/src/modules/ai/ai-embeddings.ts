import { ValidationError } from '../../lib/http-errors';
import { providerRefusal, type ChatModel } from './ai-completion';
import { createSafeFetch, isMico360Provider, providerFetch, readProviderJson } from './ai-network';
import { cutChars, wellFormed } from './ai-text';

/**
 * 1.23 meaning ("semantic") search: turn texts into vectors with the provider's embedding model —
 * OpenAI and OpenAI-compatible services (`/embeddings`, MICO360 AI too) and Ollama (`/api/embed`).
 * Anthropic has no embeddings: no meaning search with it (the AI panel then works from keywords).
 */

/** OpenAI's text-embedding-3 models are asked for this many numbers (smaller to keep and compare). */
export const EMBEDDING_DIMENSIONS = 256;
export const EMBEDDING_TIMEOUT_MS = 30_000;

/**
 * What one embeddings request may carry. MICO360 AI's guide (§5, §11): at most 64 texts, 8,000
 * characters each and 32,000 together — a request over any of them is refused (400). The total is
 * kept under 30,000, for room. Every provider is held to them: a smaller request is never refused.
 */
export const EMBED_MAX_TEXTS = 64;
export const EMBED_MAX_TEXT_CHARS = 8_000;
export const EMBED_MAX_TOTAL_CHARS = 30_000;
/** Sent instead of a blank text: the platform refuses "input contained no text". */
const BLANK_TEXT = '(no text)';

type EmbedOptions = { timeoutMs?: number; allowPrivateHosts?: boolean; signal?: AbortSignal };

/**
 * MICO360 AI answered with another embedding model than the one named (its guide, §6: a substitute is
 * reported only by X-Mico-Model-Warning and the answer's `model`). Vectors of different models don't
 * compare, so they are not kept.
 */
export class EmbeddingModelChangedError extends ValidationError {
  constructor(public readonly answeredBy: string) {
    super(`MICO360 AI answered with another embedding model (${answeredBy.slice(0, 100)}); its vectors were not kept. Meaning search tries again later.`);
  }
}

/** "nomic-embed-text" and "nomic-embed-text:latest" are the same model (the platform may list either). */
const sameModel = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/:latest$/, '') === b.trim().toLowerCase().replace(/:latest$/, '');

/**
 * The texts as sent, in order, packed into requests within the limits. Each is well formed (half a
 * character — from a cut elsewhere — would make a strict JSON reader refuse the whole request).
 */
export function embeddingBatches(texts: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let chars = 0;
  for (const raw of texts) {
    const text = raw.trim() ? wellFormed(cutChars(raw, EMBED_MAX_TEXT_CHARS)) : BLANK_TEXT;
    if (batch.length && (batch.length >= EMBED_MAX_TEXTS || chars + text.length > EMBED_MAX_TOTAL_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(text);
    chars += text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Vectors for texts, one per text in order — as many requests as the limits need. */
export async function embedTexts(model: ChatModel, texts: string[], fetchImpl?: typeof fetch, opts: EmbedOptions = {}): Promise<number[][]> {
  const vectors: number[][] = [];
  for (const batch of embeddingBatches(texts)) vectors.push(...(await embedBatch(model, batch, fetchImpl, opts)));
  return vectors;
}

async function embedBatch(model: ChatModel, texts: string[], fetchImpl: typeof fetch | undefined, opts: EmbedOptions): Promise<number[][]> {
  const base = model.provider.apiBaseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  let url: string;
  let body: Record<string, unknown>;
  switch (model.provider.kind) {
    case 'ollama':
      url = `${base}/api/embed`;
      body = { model: model.modelKey, input: texts };
      break;
    case 'openai':
    case 'custom':
      url = `${base}/embeddings`;
      if (model.provider.apiKey) headers['Authorization'] = `Bearer ${model.provider.apiKey}`;
      body = { model: model.modelKey, input: texts, ...(model.provider.kind === 'openai' && /text-embedding-3/i.test(model.modelKey) ? { dimensions: EMBEDDING_DIMENSIONS } : {}) };
      break;
    default:
      throw new ValidationError('This AI provider has no embedding models.');
  }
  const res = await providerFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, {
    fetchImpl: fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
    timeoutMs: opts.timeoutMs ?? EMBEDDING_TIMEOUT_MS,
    allowPrivateHosts: opts.allowPrivateHosts,
    signal: opts.signal,
  });
  if (!res.ok) throw await providerRefusal(res, model.provider);
  const json = (await readProviderJson(res)) as { model?: unknown; data?: { index?: number; embedding?: unknown }[]; embeddings?: unknown[] } | null;
  if (isMico360Provider(model.provider)) {
    // Another embedding model answered (the named one was unavailable): its vectors can't be compared
    // with the ones kept, so none are kept — the search sweep tries again later.
    const answered = typeof json?.model === 'string' ? json.model : null;
    if (res.headers.get('x-mico-model-warning') || (answered && !sameModel(answered, model.modelKey))) {
      throw new EmbeddingModelChangedError(answered ?? 'unknown');
    }
  }
  let vectors: unknown[];
  if (model.provider.kind === 'ollama') vectors = Array.isArray(json?.embeddings) ? json.embeddings : [];
  else {
    const data = Array.isArray(json?.data) ? [...json.data] : [];
    data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    vectors = data.map((d) => d.embedding);
  }
  const ok = vectors.length === texts.length && vectors.every((v) => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number' && Number.isFinite(n)));
  if (!ok) throw new ValidationError('The AI provider returned unreadable embeddings.');
  return vectors as number[][];
}

/** A vector as stored: float32, little-endian. */
export function toVector(values: readonly number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
}

export function fromVector(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < buf.length; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

/** Cosine similarity (0 when either vector is all zeros or they differ in length). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
