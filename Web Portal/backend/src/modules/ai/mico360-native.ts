import { createHash, randomBytes } from 'node:crypto';
import { ProviderRefusedError, providerRefusal } from './ai-errors';
import { AiCallStoppedError, AiTimeoutError, createSafeFetch, micoId, providerFetch, readProviderJson, readRefusal } from './ai-network';

export { readRefusal };

/**
 * MICO360 AI's native API (its guide, §1 and §5, Connect 2.6.28): the routes beside the OpenAI-compatible
 * /v1 that Tasks uses for the (b) bundles — reading whole documents (POST /api/v1/ocr), collecting a job a
 * 504 left running (GET /api/v1/jobs/{jobId}), the fleet's capabilities (GET /api/v1/models), the key's
 * concurrency (GET /api/v1/status), the server's version (GET /api/status, no key) and live text
 * (POST /api/v1/chat/stream, mico360-stream.ts). The native routes take the key ONLY as
 * `X-Mico-Api-Key` (a Bearer header is a 401 there); /api/status takes none, and none is sent to it.
 */

export interface NativeProvider {
  apiBaseUrl: string;
  apiKey: string;
  preset?: string | null;
}

export interface NativeOptions {
  fetchImpl?: typeof fetch;
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The platform's root for a provider address: `https://ai.mico360.com:5310/v1` → `https://ai.mico360.com:5310`. */
export function platformRoot(apiBaseUrl: string): string {
  const u = new URL(apiBaseUrl);
  const path = u.pathname.replace(/\/+$/, '').replace(/\/(?:openai\/)?v1$/i, '');
  return `${u.origin}${path}`;
}

/** A native route of the provider's platform. */
export const nativeUrl = (provider: Pick<NativeProvider, 'apiBaseUrl'>, route: string): string => `${platformRoot(provider.apiBaseUrl)}/api/v1${route}`;
const keyHeader = (provider: NativeProvider): Record<string, string> => (provider.apiKey ? { 'X-Mico-Api-Key': provider.apiKey } : {});
/** Refusals of the native routes are read as MICO360 AI's (its words for 401, 403 and 502). */
const asMico = (provider: NativeProvider) => ({ preset: 'mico360', apiBaseUrl: provider.apiBaseUrl });

function call(url: string, init: RequestInit, opts: NativeOptions): Promise<Response> {
  return providerFetch(url, init, {
    fetchImpl: opts.fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
    timeoutMs: opts.timeoutMs ?? 15_000,
    allowPrivateHosts: opts.allowPrivateHosts,
    signal: opts.signal,
  });
}

/** What every MICO360 AI answer says about itself in its headers (guide §5, §6, §8). */
export interface MicoMeta {
  correlationId: string | null;
  /** Another model answered (X-Mico-Model-Warning). */
  modelWarning: string | null;
  /** Part of the request was not honoured (X-Mico-Warning: a language that is not a tag, JSON not enforced…). */
  warning: string | null;
  /** The key's concurrency (X-Mico-Concurrency-Limit, 1–64) and how many ran when it answered. */
  concurrencyLimit: number | null;
  inFlight: number | null;
}

const headerText = (res: Response, name: string): string | null => {
  // eslint-disable-next-line no-control-regex
  const v = res.headers.get(name)?.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return v ? v.slice(0, 300) : null;
};
const wholeNumber = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && /^\s*\d{1,4}\s*$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function micoMeta(res: Response): MicoMeta {
  return {
    correlationId: micoId(res.headers.get('x-mico-correlation-id'), 64),
    modelWarning: headerText(res, 'x-mico-model-warning'),
    warning: headerText(res, 'x-mico-warning'),
    concurrencyLimit: wholeNumber(res.headers.get('x-mico-concurrency-limit'), 1, 64),
    inFlight: wholeNumber(res.headers.get('x-mico-concurrency-inflight'), 0, 1000),
  };
}

/**
 * b2: an `Idempotency-Key` (guide §11: up to 128 of letters, digits and - _ : .): the caller's scope (a
 * background job's id) and a hash of what is sent. A retry of the same request has the same key, so the
 * platform answers it from the first try's job instead of running it twice; a different request (or
 * another job) is new work.
 */
export function idempotencyKey(scope: string, ...parts: string[]): string {
  const clean = scope.replace(/[^A-Za-z0-9_:.-]+/g, '').slice(0, 80) || 'tasks';
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\u0000');
  return `${clean}-${hash.digest('hex').slice(0, 40)}`;
}

/** The waits between looks at a job, then every 10 s. */
const COLLECT_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 10_000];

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

export interface CollectOptions extends Omit<NativeOptions, 'timeoutMs'> {
  /** Give up (a time-out, tried again later) at this time (ms since 1970). */
  deadline: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface CollectedJob {
  output: string;
  model: string | null;
  warning: string | null;
}

/**
 * b3: the answer of a job the platform kept running after a 504 (or a stream that ended early), from
 * GET /api/v1/jobs/{jobId} (guide §5: poll every few seconds until the state is final). Completed: its
 * output. Failed or Cancelled: a 502 refusal with the job's error; TimedOut, a job it no longer has (a
 * job cancelled before it started), or the deadline passed: a time-out (both are tried again later).
 */
export async function collectJob(provider: NativeProvider, jobId: string, opts: CollectOptions): Promise<CollectedJob> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? pause;
  for (let i = 0; ; i++) {
    if (opts.signal?.aborted) throw new AiCallStoppedError();
    const remaining = opts.deadline - now();
    if (remaining <= 0) throw new AiTimeoutError(jobId);
    let res: Response | null = null;
    try {
      res = await call(nativeUrl(provider, `/jobs/${encodeURIComponent(jobId)}`), { headers: { accept: 'application/json', ...keyHeader(provider) } }, { ...opts, timeoutMs: Math.min(15_000, Math.max(1_000, remaining)) });
    } catch (err) {
      if (err instanceof AiCallStoppedError) throw err;
      res = null; // a blip or a slow answer: look again while there is time
    }
    if (res) {
      const meta = micoMeta(res);
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        throw new AiTimeoutError(jobId, meta.correlationId);
      }
      if (res.status === 401 || res.status === 403) throw await providerRefusal(res, asMico(provider));
      if (res.ok) {
        const j = (await readProviderJson(res).catch(() => null)) as { state?: unknown; output?: unknown; error?: unknown; model?: unknown; metadata?: { warning?: unknown } | null } | null;
        const state = typeof j?.state === 'string' ? j.state : '';
        if (state === 'Completed') {
          return {
            output: typeof j?.output === 'string' ? j.output : '',
            model: typeof j?.model === 'string' ? j.model.slice(0, 200) : null,
            warning: typeof j?.metadata?.warning === 'string' ? j.metadata.warning.slice(0, 300) : null,
          };
        }
        if (state === 'TimedOut') throw new AiTimeoutError(jobId, meta.correlationId);
        if (state === 'Failed' || state === 'Cancelled') {
          const reason = typeof j?.error === 'string' && j.error.trim() ? j.error.trim().slice(0, 300) : `The job was ${state.toLowerCase()}.`;
          throw new ProviderRefusedError(502, reason, false, null, true, meta.correlationId, jobId);
        }
      } else await res.body?.cancel().catch(() => {});
    }
    const wait = Math.min(COLLECT_DELAYS_MS[Math.min(i, COLLECT_DELAYS_MS.length - 1)]!, opts.deadline - now());
    if (wait <= 0) throw new AiTimeoutError(jobId);
    await sleep(wait, opts.signal);
  }
}

// ── Platform facts (AI Management's provider card) ──────────────────────────────

/** b12: the server's version (and commit) from the keyless GET /api/status; null when it can't be read. */
export async function platformVersion(provider: Pick<NativeProvider, 'apiBaseUrl'>, opts: NativeOptions = {}): Promise<{ version: string; commit: string | null } | null> {
  try {
    const res = await call(`${platformRoot(provider.apiBaseUrl)}/api/status`, { headers: { accept: 'application/json' } }, opts);
    if (!res.ok) return null;
    const j = (await readProviderJson(res)) as { version?: unknown; commit?: unknown } | null;
    const version = typeof j?.version === 'string' && /^\d{1,4}(\.\d{1,6}){1,3}$/.test(j.version) ? j.version : null;
    if (!version) return null;
    const commit = typeof j?.commit === 'string' && /^[0-9a-f]{4,40}$/i.test(j.commit) ? j.commit : null;
    return { version, commit };
  } catch {
    return null;
  }
}

/** b7: what the fleet offers (GET /api/v1/models): its models and every connected node's capabilities. */
export async function platformFleet(provider: NativeProvider, opts: NativeOptions = {}): Promise<{ models: string[]; capabilities: string[] } | null> {
  try {
    const res = await call(nativeUrl(provider, '/models'), { headers: { accept: 'application/json', ...keyHeader(provider) } }, opts);
    if (!res.ok) return null;
    const j = (await readProviderJson(res)) as { models?: unknown; capabilities?: unknown } | null;
    if (!j || !Array.isArray(j.capabilities)) return null;
    const capabilities = [...new Set(j.capabilities.filter((c): c is string => typeof c === 'string' && /^[A-Za-z]{1,40}$/.test(c)))].slice(0, 20);
    // eslint-disable-next-line no-control-regex
    const models = (Array.isArray(j.models) ? j.models : []).filter((m): m is string => typeof m === 'string' && m.length <= 200 && !/[\u0000-\u001f\u007f]/.test(m)).slice(0, 500);
    return { models, capabilities };
  } catch {
    return null;
  }
}

/** b11: the key's concurrency budget (GET /api/v1/status): how many requests it may have in flight. */
export async function keyStatus(provider: NativeProvider, opts: NativeOptions = {}): Promise<{ limit: number; inFlight: number } | null> {
  try {
    const res = await call(nativeUrl(provider, '/status'), { headers: { accept: 'application/json', ...keyHeader(provider) } }, opts);
    if (!res.ok) return null;
    const j = (await readProviderJson(res)) as { concurrency?: { limit?: unknown; inFlight?: unknown } } | null;
    const limit = wholeNumber(j?.concurrency?.limit, 1, 64);
    if (limit === null) return null;
    return { limit, inFlight: wholeNumber(j?.concurrency?.inFlight, 0, 1000) ?? 0 };
  } catch {
    return null;
  }
}

// ── Reading a whole document (b4) ────────────────────────────────────────────────

/** What POST /api/v1/ocr takes (guide §5, §11): these types, up to 64 MB. */
export const NATIVE_OCR_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/bmp', 'image/tiff', 'image/gif']);
export const NATIVE_OCR_MAX_BYTES = 64 * 1024 * 1024;

export interface OcrDocument {
  data: Buffer;
  mimeType: string;
  filename: string;
}

export interface OcrOptions extends Omit<NativeOptions, 'timeoutMs'> {
  /** A language tag such as en-US or ar-SA; null: the node reads with its own languages. */
  language?: string | null;
  /** The platform's own wait, 1–900 s (default 300). */
  timeoutSeconds: number;
  idempotencyKey?: string;
  /** After a 504, the job is collected until then (ms since 1970); absent: not collected. */
  collectUntil?: number;
  sleep?: CollectOptions['sleep'];
}

export interface OcrResult {
  text: string;
  pages: number | null;
  rotatedPages: number | null;
  orientationNote: string | null;
  jobId: string | null;
  correlationId: string | null;
  /** X-Mico-Warning: part of the request was not honoured (a language that is not a tag). */
  warning: string | null;
}

/** A file name a multipart header can carry: printable ASCII, no quotes or backslashes (the type is read from the content). */
function partName(name: string, mimeType: string): string {
  const ascii = name.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]+/g, '').trim().slice(0, 120);
  if (ascii.replace(/[_.\s]/g, '')) return ascii;
  return `document.${mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] ?? 'bin')}`;
}

function multipart(boundary: string, parts: Array<{ name: string; value: string } | { name: string; filename: string; type: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if ('data' in p) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type}\r\n\r\n`, 'latin1'), p.data, Buffer.from('\r\n'));
    } else chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`, 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/**
 * b4: read a whole document — every page of a PDF (black-and-white scanner PDFs too), turned upright
 * first — with POST /api/v1/ocr. A refusal is a ProviderRefusedError with the platform's reason and ids;
 * a 504 with a job id is collected until `collectUntil`.
 */
export async function nativeOcr(provider: NativeProvider, doc: OcrDocument, opts: OcrOptions): Promise<OcrResult> {
  const boundary = `----mico360tasks${randomBytes(12).toString('hex')}`;
  const timeoutSeconds = Math.max(1, Math.min(900, Math.round(opts.timeoutSeconds)));
  const body = multipart(boundary, [
    { name: 'file', filename: partName(doc.filename, doc.mimeType), type: doc.mimeType, data: doc.data },
    ...(opts.language ? [{ name: 'language', value: opts.language }] : []),
    { name: 'timeoutSeconds', value: String(timeoutSeconds) },
  ]);
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': `multipart/form-data; boundary=${boundary}`, ...keyHeader(provider) };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  // Our own wait is a little longer than the platform's, so its 504 (with the job id) comes first.
  const res = await call(nativeUrl(provider, '/ocr'), { method: 'POST', headers, body }, { ...opts, timeoutMs: (timeoutSeconds + 15) * 1000 });
  const meta = micoMeta(res);
  if (!res.ok) {
    const refusal = await providerRefusal(res, asMico(provider));
    if (res.status === 504 && refusal.jobId && opts.collectUntil && opts.collectUntil > Date.now()) {
      const job = await collectJob(provider, refusal.jobId, { ...opts, deadline: opts.collectUntil });
      return { text: job.output, pages: null, rotatedPages: null, orientationNote: null, jobId: refusal.jobId, correlationId: refusal.correlationId, warning: meta.warning };
    }
    throw refusal;
  }
  const j = (await readProviderJson(res)) as { text?: unknown; pages?: unknown; rotatedPages?: unknown; orientationNote?: unknown; jobId?: unknown; correlationId?: unknown } | null;
  return {
    text: typeof j?.text === 'string' ? j.text : '',
    pages: wholeNumber(j?.pages, 0, 100_000),
    rotatedPages: wholeNumber(j?.rotatedPages, 0, 100_000),
    orientationNote: typeof j?.orientationNote === 'string' ? j.orientationNote.slice(0, 300) : null,
    jobId: micoId(j?.jobId),
    correlationId: micoId(j?.correlationId, 64) ?? meta.correlationId,
    warning: meta.warning,
  };
}
