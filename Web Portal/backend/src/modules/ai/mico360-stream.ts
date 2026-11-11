import { ValidationError } from '../../lib/http-errors';
import { ProviderRefusedError, providerRefusal } from './ai-errors';
import { AiCallStoppedError, AiTimeoutError, createSafeFetch, micoId, providerFetch } from './ai-network';
import { collectJob, micoMeta, nativeUrl, type CollectOptions, type NativeProvider } from './mico360-native';

/**
 * b15: MICO360 AI's live text — POST /api/v1/chat/stream (its guide, §5): the /chat body, answered as
 * Server-Sent Events while the model writes: `chunk` events ({ sequence, text, jobId }, sequence from 0
 * with no gaps) and one `done` ({ reason, chunks, jobId, correlationId, replayed?, warning? }).
 *
 * The job is never stopped by the stream ending, so whenever the stream can't give the whole answer —
 * a lost chunk (a gap in `sequence`), `done` with `timed_out`, `client_too_slow` or `switched_to_artifact`,
 * `failed` (a chunk may have been lost: the job says), or a stream cut before `done` — the answer is
 * collected from GET /api/v1/jobs/{jobId} until `collectUntil`. A repeat of a request still being
 * answered (409) collects that one. Stop ends it at once. A server without the native stream (404/405)
 * throws NativeStreamUnavailable, so the caller asks /v1 instead.
 */

export class NativeStreamUnavailable extends Error {
  constructor() {
    super('MICO360 AI has no live stream here.');
    this.name = 'NativeStreamUnavailable';
  }
}

export interface StreamRequest {
  prompt: string;
  system?: string;
  model?: string;
  /** b6: the Tasks user it is for (the platform pseudonymises it). */
  user?: string;
  /** "json", or a JSON Schema the answer is held to (b1). */
  format?: 'json' | Record<string, unknown>;
  /** The platform's own wait, 1–600 s. */
  timeoutSeconds: number;
}

export interface StreamOptions extends Omit<CollectOptions, 'deadline'> {
  /** Our own wait for the whole stream. */
  timeoutMs: number;
  /** After a lost chunk, a cut stream or a timed-out one, the job is collected until then (ms since 1970). */
  collectUntil: number;
  idempotencyKey?: string;
  /** The whole text so far, each time more of it arrives (never after a lost chunk). */
  onText?: (text: string) => void;
  /** Tests: our own time-out, instead of one made from timeoutMs. */
  timeoutSignal?: AbortSignal;
  /** Review minor 10: called once the stream's own request is over and its job is to be collected. */
  beforeCollect?: () => void;
}

export interface StreamResult {
  text: string;
  jobId: string | null;
  correlationId: string | null;
  /** How the stream ended (`done`'s reason, or "cut"). */
  reason: string;
  /** The answer came from the job, not the stream. */
  collected: boolean;
  /** `done`'s warning (JSON an older node could not enforce). */
  warning: string | null;
  /** Another model may have answered: the stream does not say (guide §6). */
}

type Done = { reason: string; chunks: number | null; jobId: string | null; correlationId: string | null; warning: string | null };

/**
 * Split a buffer into complete SSE events; returns them and what is left. A "\r" at the very end is held
 * back (review minor 1): its "\n" may come in the next read, and "\r" + "\n" is one line break.
 */
function takeEvents(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const held = buffer.endsWith('\r') ? '\r' : '';
  const normal = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');
  let start = 0;
  for (;;) {
    const end = normal.indexOf('\n\n', start);
    if (end < 0) break;
    const block = normal.slice(start, end);
    start = end + 2;
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    events.push({ event, data: data.join('\n') });
  }
  return { events, rest: normal.slice(start) + held };
}

const parse = (data: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(data) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export async function streamChat(provider: NativeProvider, req: StreamRequest, opts: StreamOptions): Promise<StreamResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream', 'X-Mico-Api-Key': provider.apiKey };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const body: Record<string, unknown> = { prompt: req.prompt };
  if (req.system) body.system = req.system;
  if (req.model) body.model = req.model;
  if (req.user) body.user = req.user;
  if (req.format) body.format = req.format;
  body.timeoutSeconds = Math.max(1, Math.min(600, Math.round(req.timeoutSeconds)));

  const ours = opts.timeoutSignal ?? AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([ours, opts.signal]) : ours;
  const stopped = () => opts.signal?.aborted === true;
  const collect = async (jobId: string, correlationId: string | null, reason: string, warning: string | null): Promise<StreamResult> => {
    opts.beforeCollect?.();
    const job = await collectJob(provider, jobId, { ...opts, deadline: opts.collectUntil });
    return { text: job.output, jobId, correlationId, reason, collected: true, warning: job.warning ?? warning };
  };

  let res: Response;
  try {
    res = await providerFetch(nativeUrl(provider, '/chat/stream'), { method: 'POST', headers, body: JSON.stringify(body) }, {
      fetchImpl: opts.fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
      // The whole stream is bounded by `ours`; this only guards a connection that never answers.
      timeoutMs: opts.timeoutMs + 5_000,
      allowPrivateHosts: opts.allowPrivateHosts,
      signal,
    });
  } catch (err) {
    if (stopped()) throw new AiCallStoppedError();
    throw err;
  }
  const meta = micoMeta(res);
  if (res.status === 404 || res.status === 405) {
    await res.body?.cancel().catch(() => {});
    throw new NativeStreamUnavailable();
  }
  if (!res.ok) {
    const refusal = await providerRefusal(res, { preset: 'mico360', apiBaseUrl: provider.apiBaseUrl });
    if (res.status === 409 && refusal.jobId) return collect(refusal.jobId, refusal.correlationId, 'repeat', null);
    throw refusal;
  }
  if (!res.body || !/text\/event-stream/i.test(res.headers.get('content-type') ?? '')) {
    await res.body?.cancel().catch(() => {});
    throw new ValidationError('The AI provider returned an unreadable response.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let expected = 0;
  let lost = false;
  let jobId: string | null = null;
  let done: Done | null = null;
  try {
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const out = takeEvents(buffer);
      buffer = out.rest;
      for (const e of out.events) {
        const d = parse(e.data);
        if (!d) continue;
        jobId = micoId(d.jobId) ?? jobId;
        if (e.event === 'chunk') {
          if (d.sequence !== expected) lost = true;
          if (lost) continue;
          expected += 1;
          text += typeof d.text === 'string' ? d.text : '';
          opts.onText?.(text);
        } else if (e.event === 'done') {
          done = {
            reason: typeof d.reason === 'string' ? d.reason : 'completed',
            chunks: typeof d.chunks === 'number' ? d.chunks : null,
            jobId: micoId(d.jobId) ?? jobId,
            correlationId: micoId(d.correlationId, 64) ?? meta.correlationId,
            warning: typeof d.warning === 'string' ? d.warning.slice(0, 300) : null,
          };
          break;
        }
      }
    }
  } catch (err) {
    if (stopped()) throw new AiCallStoppedError();
    // Our own time ran out (or the connection broke) mid-answer: the job runs on — collect it.
    if (jobId) return collect(jobId, meta.correlationId, 'cut', null);
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError' || ours.aborted) throw new AiTimeoutError(null, meta.correlationId);
    throw new ValidationError('Could not reach the AI provider. Check the API URL and network.');
  } finally {
    reader.cancel().catch(() => {});
  }
  if (stopped()) throw new AiCallStoppedError();

  if (!done) {
    if (jobId) return collect(jobId, meta.correlationId, 'cut', null);
    throw new AiTimeoutError(null, meta.correlationId);
  }
  const whole = !lost && (done.chunks === null || done.chunks === expected);
  if (done.reason === 'completed' && whole) return { text, jobId: done.jobId, correlationId: done.correlationId, reason: 'completed', collected: false, warning: done.warning };
  if (!done.jobId) {
    if (done.reason === 'failed') throw new ProviderRefusedError(502, null, false, null, true, done.correlationId, null);
    throw new AiTimeoutError(null, done.correlationId);
  }
  return collect(done.jobId, done.correlationId, done.reason, done.warning);
}
