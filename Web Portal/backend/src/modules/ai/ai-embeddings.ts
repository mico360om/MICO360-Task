import { ValidationError } from '../../lib/http-errors';
import { ProviderRefusedError, type ChatModel } from './ai-completion';
import { createSafeFetch, providerErrorDetail, providerFetch, readProviderJson } from './ai-network';

/**
 * 1.23 meaning ("semantic") search: turn texts into vectors with the provider's embedding model —
 * OpenAI and OpenAI-compatible services (`/embeddings`, MICO360 AI too) and Ollama (`/api/embed`).
 * Anthropic has no embeddings: no meaning search with it (the AI panel then works from keywords).
 */

/** OpenAI's text-embedding-3 models are asked for this many numbers (smaller to keep and compare). */
export const EMBEDDING_DIMENSIONS = 256;
export const EMBEDDING_TIMEOUT_MS = 30_000;

export async function embedTexts(model: ChatModel, texts: string[], fetchImpl?: typeof fetch, opts: { timeoutMs?: number; allowPrivateHosts?: boolean; signal?: AbortSignal } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
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
  if (!res.ok) throw new ProviderRefusedError(res.status, await providerErrorDetail(res));
  const json = (await readProviderJson(res)) as { data?: { index?: number; embedding?: unknown }[]; embeddings?: unknown[] } | null;
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
