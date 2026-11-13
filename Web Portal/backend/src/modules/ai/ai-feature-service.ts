import { createHash } from 'node:crypto';
import { ValidationError } from '../../lib/http-errors';
import { todayKey } from '../../lib/due-date';
import type { AiConfigRepository } from './ai-config-repository';
import { effectiveModel, recordOcrFallback, recordStrictJsonRefusal, recordSubstitution, strictJsonPaused, type AiConfig, type AiModel, type AiProvider } from './ai-config';
import {
  complete,
  COMPLETION_TIMEOUT_MS,
  CONVERSATION_LIMIT,
  ProviderRefusedError,
  type AnswerSchema,
  type ChatModel,
  type CompletionInput,
  type CompletionOptions,
  type ProviderCallInfo,
} from './ai-completion';
import { embedTexts } from './ai-embeddings';
import { AiTimeoutError, createSafeFetch, isMico360Provider } from './ai-network';
import { idempotencyKey, nativeOcr, NATIVE_OCR_MAX_BYTES, NATIVE_OCR_TYPES, type OcrDocument } from './mico360-native';
import { AGENDA_SCHEMA, MEETING_SCHEMA, MINUTES_SCHEMA, PRIORITY_SCHEMA, TASK_SCHEMA } from './ai-schemas';
import { letterCount } from '../../lib/file-text';
import { cutChars } from './ai-text';
import { createAiUsageLimiter, createConcurrencyGate, type AiUsageLimits } from './ai-limits';
import { isValidRule, type RecurrenceRule } from '../tasks/recurrence';
import { projectArchived } from '../companies/project-archive';

/** A project a person can add tasks to, as "Describe it in plain English" may suggest it. */
export interface DescribableProject {
  id: string;
  code: string;
  number: string | null;
  name: string;
  status: string;
  /** companies: it counts as archived (its own status, or all its companies); absent = its own status decides. */
  archived?: boolean;
}

export interface AiFeatureServiceDeps {
  /**
   * The projects the person may add tasks to (archived ones are left out here), so a described
   * task can suggest one. Without it, no project is suggested.
   */
  listProjectsFor?: (user: { id: string; roles: string[] }, pick?: string | null) => Promise<DescribableProject[]>;
  /**
   * The active portal users a described meeting may invite (first name, last name and username
   * only go in the prompt). Without it, nobody is matched.
   */
  listPeople?: (requester?: AiRequester) => Promise<MeetingCandidate[]>;
  repo: AiConfigRepository;
  fetchImpl?: typeof fetch;
  /** Per-user request budget. Default 10 a minute, 200 a day. */
  limits?: Partial<AiUsageLimits>;
  /** Company time zone: "today" for date parsing and the daily budget. Default Asia/Muscat. */
  timeZone?: string;
  /** Allow provider URLs on private / internal hosts (e.g. a local Ollama). Default false. */
  allowPrivateHosts?: boolean;
  /** Abort a provider call after this long. Default 120 seconds (a model may be loading); the minutes draft gets 180. */
  timeoutMs?: number;
  /** How long a request may wait for a free slot under the model's concurrency limit. Default 20 seconds. */
  slotWaitMs?: number;
  now?: () => Date;
  /** MICO360 AI (b10): its failures, with their correlation and job ids (the Error log); notes (warn). */
  logger?: { error(message: string, meta?: Record<string, unknown>): void; warn?(message: string, meta?: Record<string, unknown>): void };
  /** Waits between looks at a job the platform kept (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
  /** MICO360 AI: the most one file's reading may take, all its requests together. Default 5½ minutes. */
  ocrFileBudgetMs?: number;
}

/** The signed-in user an AI request is made for (per-user limits; their roles decide which projects they see). */
export interface AiRequester {
  userId: string;
  roles?: string[];
  /** companies: the picked company (X-Company-Id); a described task's project is one of that company's. */
  pick?: string | null;
}

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
type Priority = (typeof PRIORITIES)[number];

export interface ProjectSummaryInput {
  name: string;
  stats: { total: number; completed: number; inProgress: number; overdue: number };
  sampleTitles?: string[];
}

/** One model call for MICO AI or AI search (see chat()). */
export interface ChatCall {
  system: string;
  prompt: string;
  maxTokens?: number;
  json?: boolean;
  /** b1: the JSON Schema the answer is held to (MICO360 AI). */
  schema?: AnswerSchema;
  signal?: AbortSignal;
  /** b15: the text so far, as the model writes it (MICO360 AI's live stream). */
  onText?: (text: string) => void;
  /** b2: the background job's scope for an Idempotency-Key (MICO360 AI). */
  idempotencyKey?: string;
  /** b6: who it is for, when no limit is counted (AI search). */
  user?: string;
  /** The caller logs its own failures (AI search): not logged here too. */
  quiet?: boolean;
}

/** A model with its provider, ready to call. */
interface Found {
  model: AiModel;
  provider: AiProvider;
  chat: ChatModel;
}

/**
 * Product-facing AI features (task breakdown, natural-language task capture, project status
 * summary, priority suggestion). Each resolves the admin-configured default *chat* model from
 * the AI config and calls the provider — so the AI Management screen actually drives behaviour.
 */
export function createAiFeatureService({
  repo,
  listProjectsFor,
  listPeople,
  fetchImpl,
  limits,
  timeZone = 'Asia/Muscat',
  allowPrivateHosts = false,
  timeoutMs = COMPLETION_TIMEOUT_MS,
  slotWaitMs = 20_000,
  now = () => new Date(),
  logger,
  sleep,
  ocrFileBudgetMs = OCR_FILE_BUDGET_MS,
}: AiFeatureServiceDeps) {
  const doFetch = fetchImpl ?? createSafeFetch({ allowPrivateHosts });
  const usage = createAiUsageLimiter({ perMinute: limits?.perMinute ?? 10, perDay: limits?.perDay ?? 200 }, timeZone, now);
  const gate = createConcurrencyGate(slotWaitMs);
  // ── MICO360 AI (b) bundles: what this server learns as it calls the platform ──
  /** b11: one concurrency budget for the whole key, shared by every model it runs. */
  const keyGate = createConcurrencyGate(slotWaitMs);
  /** b11: the key's concurrency as the platform last said it (X-Mico-Concurrency-Limit), by provider. */
  const keyLimits = new Map<string, number>();
  /** b13: when each model last answered (a model stays loaded for 30 minutes after use). */
  const answeredAt = new Map<string, number>();
  /** b5: when each stand-in pair was last written down (at most once every 10 minutes). */
  const substitutionsNoted = new Map<string, number>();
  /** b4: whole-document reading paused after a refusal, until (by provider). */
  const ocrPausedUntil = new Map<string, number>();
  /** b13: a warm-up was sent (not again before this). */
  let warmUpUntil = 0;

  const found = (config: AiConfig, model: AiModel | null): Found | null => {
    const provider = model ? config.providers.find((p) => p.id === model.providerId) : undefined;
    return model && provider ? { model, provider, chat: { provider, modelKey: model.modelKey, parameters: model.parameters } } : null;
  };

  function resolveChatModel(config: AiConfig): Found {
    // The admin's default chat model while it is usable, otherwise the recommended one ("Automatic").
    const out = found(config, effectiveModel(config, 'chat'));
    if (!out) {
      throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
    }
    return out;
  }

  const keyLimit = (provider: AiProvider): number => keyLimits.get(provider.id) ?? provider.platform?.concurrencyLimit ?? DEFAULT_KEY_CONCURRENCY;
  const sameModel = (a: string, b: string) => a.trim().toLowerCase().replace(/:latest$/, '') === b.trim().toLowerCase().replace(/:latest$/, '');
  const warn = (message: string, meta: Record<string, unknown>) => {
    try {
      logger?.warn?.(message, meta);
    } catch {
      // A note must never be what fails.
    }
  };

  /** What a MICO360 AI answer said about itself: the key's budget, a warm model, a stand-in (b5, b11, b13). */
  function noted(f: Found, info: ProviderCallInfo): void {
    if (info.concurrencyLimit) keyLimits.set(f.provider.id, info.concurrencyLimit);
    if (info.strictRefused) noteStrictRefusal(f, info.strictRefused);
    if (!info.ok) return;
    answeredAt.set(f.model.id, now().getTime());
    if (!info.substituted || !info.model || sameModel(info.model, f.model.modelKey)) return;
    const pair = `${f.provider.id}\u0000${f.model.modelKey}\u0000${info.model}`;
    const at = now().getTime();
    if (at - (substitutionsNoted.get(pair) ?? -Infinity) < SUBSTITUTION_NOTE_EVERY_MS) return;
    substitutionsNoted.set(pair, at);
    const sub = { asked: f.model.modelKey, answered: info.model };
    void repo
      .update((c) => (c.providers.some((p) => p.id === f.provider.id) ? recordSubstitution(c, f.provider.id, sub, new Date(at).toISOString()) : c))
      .catch((err) => warn('MICO360 AI: a stand-in model could not be noted', { err }));
  }

  /**
   * Safety net: this Connect refused strict answer shapes (json_schema), and JSON mode answered instead.
   * Written on the provider — features use JSON mode for 24 hours or until the next model refresh, and
   * the provider card says so — once, not by every call in flight: a refusal already noted (and not yet
   * forgotten by a model refresh) is left as it is.
   */
  function noteStrictRefusal(f: Found, refusal: { status: number; reason: string | null }): void {
    const at = now().getTime();
    let wrote = false;
    void repo
      .update((c) => {
        const p = c.providers.find((x) => x.id === f.provider.id);
        if (!p || strictJsonPaused(p, at)) return c;
        wrote = true;
        return recordStrictJsonRefusal(c, p.id, refusal, new Date(at).toISOString());
      })
      .then(() => {
        if (wrote) warn('MICO360 AI: strict answer shapes not accepted by this Connect — using JSON mode', { status: refusal.status, reason: refusal.reason });
      })
      .catch((err) => warn('MICO360 AI: the refusal of strict answer shapes could not be noted', { err }));
  }

  /**
   * b10: a MICO360 AI failure worth an admin's look goes to the log (and so the Error log) with its
   * correlation and job ids. A busy moment or a used-up quota (429) is not one; the key is never logged.
   */
  function report(feature: string, err: unknown): void {
    const status = err instanceof ProviderRefusedError ? err.providerStatus : null;
    const worth = err instanceof AiTimeoutError || (status !== null && status !== 429 && (status >= 500 || status === 401 || status === 403 || status === 404 || status === 413));
    if (!worth) return;
    try {
      logger?.error(`MICO360 AI: ${feature} failed`, { err, feature });
    } catch {
      // Logging must never be what fails.
    }
  }

  /**
   * One model call: the model's own concurrency slot and — MICO360 AI — a slot of the key's (b11); what
   * the answer says about itself is noted, and a failure worth it is logged (b10) unless `quiet`.
   */
  async function invoke(f: Found, input: CompletionInput, opts: CompletionOptions & { feature: string; quiet?: boolean }): Promise<string> {
    const mico = isMico360Provider(f.provider);
    const { feature, quiet, ...callOpts } = opts;
    const releaseModel = await gate.acquire(f.model.id, f.model.concurrencyLimit);
    let releaseKey = () => {};
    try {
      if (mico) releaseKey = await keyGate.acquire(`provider:${f.provider.id}`, keyLimit(f.provider));
      return await complete(f.chat, input, doFetch, {
        allowPrivateHosts,
        ...(sleep ? { sleep } : {}),
        ...callOpts,
        // Review minor 10: a job being collected no longer runs a request of the key's: its slot is freed.
        ...(mico ? { observe: (i: ProviderCallInfo) => noted(f, i), beforeCollect: () => releaseKey() } : {}),
      });
    } catch (err) {
      if (mico && !quiet) report(feature, err);
      throw err;
    } finally {
      releaseKey();
      releaseModel();
    }
  }

  /**
   * One completion with the default chat model. `json`: the answer is parsed as JSON, so a provider
   * that can hold the model to JSON is asked to (MICO360 AI); `schema` (b1) holds it to that schema;
   * `wait` overrides the time allowed; `background`: nobody is waiting at a page, so MICO360 AI is
   * waited for as long as it waits itself, and a job it kept after its 504 is collected (b3).
   */
  async function run(
    system: string,
    prompt: string,
    maxTokens: number | undefined,
    requester: AiRequester | undefined,
    opts: {
      feature: string;
      json?: boolean;
      schema?: AnswerSchema;
      wait?: number;
      signal?: AbortSignal;
      dailyOnly?: boolean;
      background?: boolean;
      idempotencyKey?: string;
      onText?: (text: string) => void;
      user?: string;
      quiet?: boolean;
    },
  ): Promise<string> {
    const f = resolveChatModel(await repo.load());
    if (requester) {
      if (opts.dailyOnly) usage.takeDaily(requester.userId);
      else usage.take(requester.userId);
    }
    const mico = isMico360Provider(f.provider);
    const wait = opts.background && mico ? BACKGROUND_WAIT_MS : (opts.wait ?? timeoutMs);
    // Safety net: a Connect that refused strict answer shapes lately is asked in JSON mode (the answer is checked as before).
    const schema = opts.schema && !(mico && strictJsonPaused(f.provider, now().getTime())) ? opts.schema : undefined;
    return invoke(
      f,
      { system, prompt, maxTokens, json: opts.json || !!opts.schema, schema, user: opts.user ?? requester?.userId },
      {
        feature: opts.feature,
        quiet: opts.quiet,
        timeoutMs: wait,
        signal: opts.signal,
        idempotencyKey: opts.idempotencyKey,
        onText: opts.onText,
        ...(opts.background && mico ? { collectUntil: Date.now() + BACKGROUND_COLLECT_MS } : {}),
      },
    );
  }

  /** Is a chat model set up and usable? (MICO AI says so on its page before anyone types.) */
  async function chatReady(): Promise<boolean> {
    return effectiveModel(await repo.load(), 'chat') !== null;
  }

  /**
   * One model call for MICO AI's tool loop: the default chat model, its concurrency slot and the
   * configured wait, with the caller's stop. With a requester, the call counts against the person's
   * daily AI limit, the same one every AI feature uses; the minute counted the question once
   * (startMicoAiQuestion), so a question of several steps never fails halfway on the minute.
   * Without one (AI search), nothing more is counted; `user` still says who it is for (b6).
   */
  async function chat(input: ChatCall, requester?: AiRequester): Promise<string> {
    return run(input.system, input.prompt, input.maxTokens, requester, {
      feature: requester ? 'MICO AI' : 'AI search',
      json: input.json,
      schema: input.schema,
      signal: input.signal,
      dailyOnly: true,
      onText: input.onText,
      idempotencyKey: input.idempotencyKey,
      user: input.user,
      quiet: input.quiet,
    });
  }

  /** A MICO AI question starts: it counts once against the minute; throws (429) when the minute or the day is used up. */
  function startMicoAiQuestion(userId: string): void {
    usage.startQuestion(userId);
  }

  /** 1.22: throws the person's limit (429) when one more request would be over it — counts nothing (work asked for in the background). */
  function checkLimits(userId: string): void {
    usage.check(userId);
  }

  /**
   * 1.23: an AI search question counts as one request against the person's limits (minute and day);
   * its model calls (chat without a requester) count nothing more. Throws (429) when over a limit.
   */
  function startSearchQuestion(userId: string): void {
    usage.take(userId);
  }

  /** b13: has the chat model in use answered on this server in the last 25 minutes? */
  const isCold = (modelId: string): boolean => {
    const last = answeredAt.get(modelId);
    return last === undefined || now().getTime() - last > COLD_AFTER_MS;
  };

  /**
   * b13: how long the AI search panel may take. MICO360 AI's first answer of the day loads the model
   * (20–90 s, its guide §7), so a cold model gets the long budget; otherwise the usual 20 seconds.
   */
  async function searchBudgetMs(): Promise<number> {
    const f = found(await repo.load(), effectiveModel(await repo.load(), 'chat'));
    return f && isMico360Provider(f.provider) && isCold(f.model.id) ? AI_SEARCH_COLD_BUDGET_MS : AI_SEARCH_WARM_BUDGET_MS;
  }

  /**
   * b13: someone is about to search (the search box or page asked whether AI is on): a cold MICO360 AI
   * chat model is asked one tiny question, so it is loaded by the time the question comes. System work
   * (no one's limit), at most every 5 minutes, never waited for; other providers are left alone.
   */
  function warmUp(): void {
    void (async () => {
      const config = await repo.load();
      const f = found(config, effectiveModel(config, 'chat'));
      if (!f || !isMico360Provider(f.provider) || !isCold(f.model.id) || now().getTime() < warmUpUntil) return;
      warmUpUntil = now().getTime() + WARM_UP_EVERY_MS;
      await invoke(f, { prompt: 'Reply with OK.', maxTokens: 1 }, { feature: 'warm-up', quiet: true, timeoutMs: COMPLETION_TIMEOUT_MS });
    })().catch((err) => warn('MICO360 AI: the warm-up was not answered', { err }));
  }

  /** The usable model for a capability with its provider connection, or null. */
  function resolveFor(config: AiConfig, capability: 'ocr' | 'embedding'): Found | null {
    return found(config, effectiveModel(config, capability));
  }

  /** 1.23: is an OCR model set up and usable (scanned files and pictures are read by it)? */
  /** b4: are whole documents read now (the OCR model is MICO360 AI's)? Scans no picture could carry are then read again. */
  async function readsWholeDocuments(): Promise<boolean> {
    const f = resolveFor(await repo.load(), 'ocr');
    return !!f && isMico360Provider(f.provider);
  }

  async function ocrReady(): Promise<boolean> {
    return resolveFor(await repo.load(), 'ocr') !== null;
  }

  /**
   * 1.23: the text in pictures (a scanned PDF's pages, a photo), read by the OCR model — work the
   * system does for search, so no person's limit is counted; the model's concurrency limit applies.
   * Background work: MICO360 AI is waited for as long as it waits itself (a vision job may take 300 s).
   *
   * b8 (MICO360 AI): GLM-OCR — the reader its console installs — works best asked plainly: one picture a
   * request, "Text Recognition:", no instructions. A page that gives nothing (an empty answer, or the
   * platform's 502 for one) is passed over while others read; the caller logs failures (quiet here).
   * Review I3: one file has one `deadline` for all its pictures (its OCR claim lasts 10 minutes): past it
   * no picture is sent — a time-out, tried again later, when the pages already read are answered from
   * their first reading (Idempotency-Key).
   */
  async function readPictures(images: { data: Buffer; mimeType: string }[], opts: { signal?: AbortSignal; key?: string; deadline?: number } = {}): Promise<string> {
    const f = resolveFor(await repo.load(), 'ocr');
    if (!f) throw new ValidationError('No OCR model is set up in AI Management.');
    if (!isMico360Provider(f.provider)) {
      return invoke(
        f,
        {
          system: 'You transcribe documents. Reply with only the text you can read in the pictures, in reading order, keeping its language. No commentary. If there is no text, reply with nothing.',
          prompt: 'Transcribe all the text in these pictures.',
          maxTokens: 4000,
          images,
        },
        { feature: 'reading pictures', quiet: true, timeoutMs: Math.max(timeoutMs, 120_000), signal: opts.signal },
      );
    }
    const deadline = opts.deadline ?? Date.now() + ocrFileBudgetMs;
    const texts: string[] = [];
    let failure: unknown = null;
    for (const image of images) {
      const left = deadline - Date.now();
      if (left < MIN_REQUEST_MS) throw new AiTimeoutError();
      try {
        const text = await invoke(f, { prompt: 'Text Recognition:', maxTokens: 4000, images: [image] }, {
          feature: 'reading pictures',
          quiet: true,
          timeoutMs: Math.min(BACKGROUND_WAIT_MS, left),
          signal: opts.signal,
          idempotencyKey: opts.key,
          collectUntil: deadline,
        });
        texts.push(text.trim());
      } catch (err) {
        const blank = (err instanceof ProviderRefusedError && err.providerStatus === 502) || (err instanceof ValidationError && /empty response/.test(err.message));
        if (!blank) throw err;
        failure ??= err;
      }
    }
    if (texts.length === 0 && failure) throw failure;
    return texts.filter(Boolean).join('\n\n');
  }

  /** b4: write down (or clear) why whole-document reading fell back to pictures — only when it changes. */
  async function noteOcrFallback(f: Found, fallback: { status: number; reason: string | null } | null): Promise<void> {
    const was = f.provider.platform?.ocrFallback ?? null;
    if (!fallback && !was) return;
    if (fallback && was && was.status === fallback.status && was.reason === fallback.reason) return;
    await repo
      .update((c) => (c.providers.some((p) => p.id === f.provider.id) ? recordOcrFallback(c, f.provider.id, fallback, now().toISOString()) : c))
      .catch((err) => warn('MICO360 AI: the reading note could not be saved', { err }));
  }

  /**
   * b4: one whole document on MICO360 AI, within the file's `deadline`. A language its node can't read is
   * tried again without one; so is a guessed language that read (almost) nothing (review I4: the node
   * reads one language) — the text with more letters is kept.
   */
  async function readWhole(f: Found, doc: OcrDocument, opts: { language: string | null; key?: string; signal?: AbortSignal; deadline: number }): Promise<{ text: string; pages: number | null }> {
    const hash = createHash('sha256').update(doc.data).digest('hex');
    const once = async (language: string | null) => {
      const left = opts.deadline - Date.now();
      if (left < MIN_REQUEST_MS) throw new AiTimeoutError();
      const releaseModel = await gate.acquire(f.model.id, f.model.concurrencyLimit);
      let releaseKey = () => {};
      try {
        releaseKey = await keyGate.acquire(`provider:${f.provider.id}`, keyLimit(f.provider));
        return await nativeOcr(f.provider, doc, {
          fetchImpl: doFetch,
          allowPrivateHosts,
          signal: opts.signal,
          language,
          // The platform's own wait, inside what is left of the file's (ours is 15 s longer).
          timeoutSeconds: Math.max(1, Math.min(NATIVE_OCR_SECONDS, Math.floor(left / 1000) - 20)),
          idempotencyKey: opts.key ? idempotencyKey(opts.key, 'POST /api/v1/ocr', hash, language ?? '') : undefined,
          collectUntil: opts.deadline,
          beforeCollect: () => releaseKey(),
          ...(sleep ? { sleep } : {}),
        });
      } finally {
        releaseKey();
        releaseModel();
      }
    };
    let out: Awaited<ReturnType<typeof once>>;
    try {
      out = await once(opts.language);
    } catch (err) {
      if (opts.language && err instanceof ProviderRefusedError && err.providerStatus === 502 && /ocr language/i.test(err.detail ?? '')) return once(null);
      throw err;
    }
    const letters = (t: string) => letterCount(t);
    if (opts.language && letters(out.text) < POOR_LETTERS_PER_PAGE * Math.max(1, out.pages ?? 1) && opts.deadline - Date.now() >= MIN_REQUEST_MS) {
      const plain = await once(null);
      return letters(plain.text) > letters(out.text) ? plain : out;
    }
    return out;
  }

  /**
   * b4: the text of a scan or a picture. With MICO360 AI, the whole document goes to POST /api/v1/ocr —
   * every page of a PDF within the platform's limits (black-and-white scanner PDFs too), turned upright
   * first, read in `language` when one is known. When the platform can't (403: the key may not use Ocr,
   * 404: an older server, 503: no OCR node; 413: too large) the pictures are read instead, as before, the
   * admin is told on the provider's card, and whole-document reading waits a while (no upload each time).
   * A file it won't take (415) or one over its page or pixel limits goes to the pictures alone (review
   * minor 4). Other providers (and WebP, which the platform doesn't read) read the pictures, as before.
   * Review I3: everything for one file — the whole read, a second reading, the pictures — stays within
   * one budget, well inside the 10 minutes the file is claimed for.
   */
  async function readDocument(
    doc: OcrDocument,
    opts: { language?: string | null; key?: string; signal?: AbortSignal; pictures: () => Promise<{ data: Buffer; mimeType: string }[]> },
  ): Promise<{ text: string; pages: number | null; whole: boolean }> {
    const f = resolveFor(await repo.load(), 'ocr');
    if (!f) throw new ValidationError('No OCR model is set up in AI Management.');
    const deadline = Date.now() + ocrFileBudgetMs;
    const at = now().getTime();
    if (isMico360Provider(f.provider) && NATIVE_OCR_TYPES.has(doc.mimeType) && doc.data.length <= NATIVE_OCR_MAX_BYTES && (ocrPausedUntil.get(f.provider.id) ?? 0) <= at) {
      try {
        const out = await readWhole(f, doc, { language: opts.language ?? null, key: opts.key, signal: opts.signal, deadline });
        await noteOcrFallback(f, null);
        return { text: out.text, pages: out.pages, whole: true };
      } catch (err) {
        const status = err instanceof ProviderRefusedError ? err.providerStatus : 0;
        const thisFile = status === 415 || (status === 502 && OVER_LIMITS.test((err as ProviderRefusedError).detail ?? ''));
        if (!(err instanceof ProviderRefusedError) || !(OCR_FALLBACK_STATUSES.has(status) || thisFile)) throw err;
        if (!thisFile) {
          ocrPausedUntil.set(f.provider.id, at + (status === 503 ? OCR_PAUSE_SHORT_MS : OCR_PAUSE_LONG_MS));
          await noteOcrFallback(f, { status, reason: err.detail });
        }
        warn('MICO360 AI: whole-document reading was refused; reading the pictures instead', { status, correlationId: err.correlationId, thisFile });
      }
    }
    const images = await opts.pictures();
    if (images.length === 0) return { text: '', pages: null, whole: false };
    return { text: await readPictures(images, { signal: opts.signal, key: opts.key, deadline }), pages: null, whole: false };
  }

  /** 1.23: the embedding model meaning search uses, or null (no meaning search). */
  async function embeddingModel(): Promise<{ id: string; modelKey: string } | null> {
    const f = resolveFor(await repo.load(), 'embedding');
    return f ? { id: f.model.id, modelKey: f.model.modelKey } : null;
  }

  /**
   * 1.23: vectors for texts with the embedding model (and which model made them). `background`: the
   * search sweep — MICO360 AI is given 120 s, as its guide asks of every client (a person's question
   * keeps the short wait). MICO360 AI: a slot of the key's budget too (b11).
   */
  async function embed(texts: string[], opts: { signal?: AbortSignal; background?: boolean } = {}): Promise<{ model: string; vectors: number[][] }> {
    const f = resolveFor(await repo.load(), 'embedding');
    if (!f) throw new ValidationError('No embedding model is set up in AI Management.');
    const mico = isMico360Provider(f.provider);
    const wait = opts.background && mico ? EMBEDDING_SWEEP_WAIT_MS : undefined;
    const releaseModel = await gate.acquire(f.model.id, f.model.concurrencyLimit);
    let releaseKey = () => {};
    try {
      if (mico) releaseKey = await keyGate.acquire(`provider:${f.provider.id}`, keyLimit(f.provider));
      return { model: f.model.id, vectors: await embedTexts(f.chat, texts, doFetch, { allowPrivateHosts, signal: opts.signal, timeoutMs: wait }) };
    } finally {
      releaseKey();
      releaseModel();
    }
  }

  /** Break a task into 3–7 short checklist steps. */
  async function breakdownTask(input: { title: string; description?: string }, requester?: AiRequester): Promise<string[]> {
    const text = await run(
      'You break a work task into a short, actionable checklist. Reply with ONLY JSON: {"steps": [3 to 7 short imperative steps, each under ~10 words]}. No numbering, no commentary.',
      `Title: ${input.title}\nDescription: ${input.description?.trim() || '(none)'}`,
      512,
      requester,
      { feature: 'task checklist', json: true },
    );
    const items = parseStringArray(text)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (items.length === 0) throw new ValidationError('The AI response could not be parsed into checklist items.');
    return items;
  }

  /**
   * Turn a free-text note into a task: a title, and only what the note says of a description,
   * due date, priority, repeat and project. The project is one the person can add tasks to: the
   * one whose number or code is written in the note, else the one the model names.
   */
  /** The person's projects for a prompt (not archived ones, by name, at most MAX_PROMPT_PROJECTS). */
  async function promptProjects(requester?: AiRequester): Promise<DescribableProject[]> {
    return listProjectsFor && requester
      ? (await listProjectsFor({ id: requester.userId, roles: requester.roles ?? [] }, requester.pick ?? null))
          .filter((p) => !projectArchived(p))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, MAX_PROMPT_PROJECTS)
      : [];
  }

  /**
   * MICO360 AI reads at most CONVERSATION_LIMIT characters a conversation, instructions included (its
   * guide, §5): the room a prompt has there, less some for the platform's own framing. Other providers:
   * none (their prompts are built as before).
   */
  async function promptRoom(): Promise<number | null> {
    const config = await repo.load();
    const model = effectiveModel(config, 'chat');
    const provider = model ? config.providers.find((p) => p.id === model.providerId) : undefined;
    return provider && isMico360Provider(provider) ? CONVERSATION_LIMIT - FRAMING_ROOM : null;
  }

  const PROJECTS_HEADER = '\nProjects (code | number | name), one per line:\n';
  const projectLine = (p: DescribableProject, short: boolean) => `${p.code} | ${p.number ?? '-'} | ${short ? cut(p.name, PROMPT_NAME_CHARS) : p.name}`;
  /** A project the text names by its code, number or whole name. */
  const projectNamed = (text: string) => (p: DescribableProject) => matchProject(text, null, [p]) !== null || (normalise(p.name).length > 3 && normalise(text).includes(normalise(p.name)));

  async function parseTask(input: { text: string; today?: string }, requester?: AiRequester): Promise<DescribedTask> {
    // "Today" is the company-local date: before 04:00 in Muscat the UTC date is still yesterday.
    const today = input.today ?? todayKey(timeZone, now());
    const projects = await promptProjects(requester);
    const room = await promptRoom();
    const instructions = [
      `Extract a single task from the user's note. Today is ${today}. Reply with ONLY JSON:`,
      '{"title": string, "description": string|null, "dueDate": string|null, "priority": "LOW"|"NORMAL"|"HIGH"|"URGENT"|null,',
      ' "repeat": null | {"freq": "DAILY"|"WEEKLY"|"MONTHLY"|"QUARTERLY"|"YEARLY", "interval": number, "weekdays"?: number[] (0=Sunday…6=Saturday, WEEKLY only), "dayOfMonth"?: number (MONTHLY/QUARTERLY), "until"?: "YYYY-MM-DD", "count"?: number},',
      ' "project": string|null}.',
      'Title: concise, without date, priority, repeat or project words. Description: only details the note gives beyond the title, in a sentence or two; else null.',
      'dueDate: YYYY-MM-DD, resolving relative dates like "Friday" or "tomorrow"; null if none. Repeat: only if the note says the task repeats; else null.',
      projects.length ? 'project: the code of the project from the list the note is about; null if none fits.' : 'project: null.',
    ].join('\n');
    // On MICO360 AI the list fits the room the instructions and the note leave (the projects the note
    // names first); the note's own project number or code still matches any of the person's projects.
    const { lines } = promptList(projects, projectLine, projectNamed(input.text), room === null ? null : room - instructions.length - PROJECTS_HEADER.length - input.text.length);
    const text = await run(
      instructions + (lines.length ? PROJECTS_HEADER + lines.join('\n') : ''),
      input.text,
      600,
      requester,
      { feature: 'describe a task', schema: TASK_SCHEMA },
    );
    const obj = parseJsonObject(text);
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : input.text.trim();
    const rawDescription = typeof obj.description === 'string' ? obj.description.trim().slice(0, 4000) : '';
    const description = rawDescription && normalise(rawDescription) !== normalise(title) ? rawDescription : null;
    // Review fix #29: a real day only (an impossible one is dropped).
    const dueDate = isDay(obj.dueDate) ? obj.dueDate : null;
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : null;
    const recurrence = toRepeatRule(obj.repeat);
    const match = matchProject(input.text, typeof obj.project === 'string' ? obj.project : null, projects);
    const project = match ? { id: match.id, code: match.code, number: match.number, name: match.name } : null;
    return { title, description, dueDate, priority, recurrence, project };
  }

  /**
   * Fill the new-meeting form from a sentence: only what it says of the title, day, time, length,
   * repeat, project, place, link, people, guests and agenda. People are matched among the active
   * users by the ids the model gives, checked against that list; a name more than one person goes
   * by comes back as a choice, never a guess. Emails and links are kept only if the sentence has them.
   */
  async function parseMeeting(input: { text: string; today?: string }, requester?: AiRequester): Promise<DescribedMeeting> {
    const today = input.today ?? todayKey(timeZone, now());
    const projects = await promptProjects(requester);
    const room = await promptRoom();
    // Everyone active is checked for shared names; the first 300 (by name) are listed for the model.
    // companies: only the people the requester knows (colleagues, teammates, chat partners).
    const everyone = (listPeople ? await listPeople(requester) : [])
      .map((p) => ({ ...p, name: `${p.firstName} ${p.lastName}`.trim() || p.username }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const instructions = [
        `Fill in a meeting from the user's sentence. Today is ${today}; times are company time. Reply with ONLY JSON:`,
        '{"title": string, "description": string|null, "date": "YYYY-MM-DD"|null, "startTime": "HH:MM" (24-hour)|null, "minutes": number|null,',
        ' "repeat": null | {"freq": "DAILY"|"WEEKLY"|"MONTHLY"|"QUARTERLY"|"YEARLY", "interval": number, "weekdays"?: number[] (0=Sunday…6=Saturday, WEEKLY only), "dayOfMonth"?: number (MONTHLY/QUARTERLY), "until"?: "YYYY-MM-DD", "count"?: number},',
        ' "project": string|null, "location": string|null, "onlineLink": string|null,',
        ' "people": [{"said": string, "ids": string[]}], "guests": [{"email": string, "name": string}], "agenda": string[]}.',
        'Title: concise, without date, time, people or project words. Description: only details the sentence gives beyond the title; else null.',
        'date: resolve relative days like "Monday" or "tomorrow"; null if none. minutes: how long it lasts; null if not said. Repeat: only if the sentence says it repeats; else null.',
        'location: a place written in the sentence; onlineLink: a link written in the sentence; else null.',
        everyone.length
          ? 'people: each person named, "said" as written; "ids": every id from the people list whose name could be them (several if unsure, none if nobody fits).'
          : 'people: each person named, with "ids": [].',
        'guests: email addresses written in the sentence, each with the name given for it, else "". agenda: the topics the sentence lists; else [].',
        projects.length ? 'project: the code of the project from the list the meeting is about; null if none fits.' : 'project: null.',
      ].join('\n');
    // On MICO360 AI both lists fit the room the instructions and the sentence leave: the projects first,
    // then the people — those the sentence names first. Names are still matched against everyone below,
    // and a unique exact name of someone left out is found by the name.
    const PEOPLE_HEADER = '\nPeople (id | name | username), one per line:\n';
    const free = room === null ? null : room - instructions.length - input.text.length - PROJECTS_HEADER.length - PEOPLE_HEADER.length;
    const projectsOut = promptList(projects, projectLine, projectNamed(input.text), free);
    const words = new Set(normalise(input.text).split(' '));
    const personNamed = (p: MeetingCandidate & { name: string }) =>
      [p.firstName, p.lastName, p.username].some((x) => normalise(x).length > 1 && normalise(x).split(' ').every((w) => words.has(w)));
    const personLine = (p: MeetingCandidate & { name: string }, short: boolean) => `${p.id} | ${short ? cut(p.name, PROMPT_NAME_CHARS) : p.name} | ${short ? cut(p.username, PROMPT_USERNAME_CHARS) : p.username}`;
    const peopleOut = promptList(everyone, personLine, personNamed, free === null ? null : free - projectsOut.chars, MAX_PROMPT_PEOPLE);
    const listed = new Set(peopleOut.listed.map((p) => p.id));
    const text = await run(
      instructions +
        (projectsOut.lines.length ? PROJECTS_HEADER + projectsOut.lines.join('\n') : '') +
        (peopleOut.lines.length ? PEOPLE_HEADER + peopleOut.lines.join('\n') : ''),
      input.text,
      900,
      requester,
      { feature: 'describe a meeting', schema: MEETING_SCHEMA },
    );
    const obj = parseJsonObject(text);
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    // No title from the model: none is suggested (the sentence itself, e.g. "move it to Tuesday", isn't one).
    const title = str(obj.title, 300);
    const rawDescription = str(obj.description, 4000);
    const description = rawDescription && normalise(rawDescription) !== normalise(title ?? '') ? rawDescription : null;
    const minutes = typeof obj.minutes === 'number' && Number.isInteger(obj.minutes) && obj.minutes >= 5 && obj.minutes <= 720 ? obj.minutes : null;
    const match = matchProject(input.text, typeof obj.project === 'string' ? obj.project : null, projects);
    const link = str(obj.onlineLink, 2000);
    return {
      title,
      description,
      date: isDay(obj.date) ? obj.date : null,
      startTime: typeof obj.startTime === 'string' && HHMM.test(obj.startTime) ? obj.startTime : null,
      minutes,
      recurrence: toRepeatRule(obj.repeat),
      project: match ? { id: match.id, code: match.code, number: match.number, name: match.name } : null,
      location: str(obj.location, 200),
      onlineLink: link && /^https?:\/\//i.test(link) && input.text.includes(link) ? link : null,
      people: matchPeople(obj.people, everyone, room === null ? undefined : new Set(everyone.filter((p) => !listed.has(p.id)).map((p) => p.id))),
      guests: guestsIn(input.text, obj.guests),
      agenda: (Array.isArray(obj.agenda) ? obj.agenda : []).map((a) => str(a, 300)).filter((a): a is string => !!a).slice(0, MAX_AGENDA_POINTS),
    };
  }

  /**
   * Propose a meeting's agenda from what was typed, the project's open tasks and the last meeting's
   * leftovers. Each item gets a lead from the invited people (anyone else is dropped) and minutes,
   * scaled so the items fit the meeting's length.
   */
  async function draftAgenda(input: DraftAgendaInput, requester?: AiRequester): Promise<DraftedAgendaItem[]> {
    // On MICO360 AI (32,000 characters a conversation) long titles and names are cut and the people fit
    // the room left by everything else; other providers get the prompt as before.
    const room = await promptRoom();
    const short = room !== null;
    const title = (t: string) => (short ? cut(t, PROMPT_TITLE_CHARS) : t);
    const system = [
      'You plan business meetings. Propose up to 12 agenda items for the meeting below, drawing on what the organizer wrote, the open project tasks and what the last meeting left open.',
      'Write in the language the organizer wrote in. Each title is short (under 10 words); never invent names, dates or numbers.',
      'Reply with ONLY JSON: {"items": [{"title": string, "ownerId": an id from the people list or null, "minutes": number}]}.',
      'The minutes of all agenda items together must fit the meeting length.',
    ].join('\n');
    const head = [
      `Meeting: ${input.title}`,
      input.description?.trim() ? `Description: ${input.description.trim()}` : '',
      input.text?.trim() ? `What the organizer wrote: ${input.text.trim()}` : '',
      `Length: ${input.minutes} minutes`,
    ].filter(Boolean);
    const tail = [
      input.tasks.length ? `Open project tasks (key | title | why):\n${input.tasks.map((t) => `${t.key} | ${title(t.title)} | ${t.reason}`).join('\n')}` : '',
      input.leftovers.length ? `Left open by the last meeting:\n${input.leftovers.map((l) => `${l.kind === 'action' ? 'Action item' : 'Agenda item'}: ${title(l.title)}`).join('\n')}` : '',
    ].filter(Boolean);
    const PEOPLE_HEADER = 'People (id | name), one per line:\n';
    const fixed = system.length + [...head, ...tail].join('\n\n').length + PEOPLE_HEADER.length + 4;
    const people = promptList(input.people, (p, cutName) => `${p.id} | ${cutName ? cut(p.name, PROMPT_NAME_CHARS) : p.name}`, () => false, room === null ? null : room - fixed).lines;
    const lines = [...head, people.length ? `${PEOPLE_HEADER}${people.join('\n')}` : 'People: none listed', ...tail];
    const text = await run(
      system,
      lines.join('\n\n'),
      900,
      requester,
      { feature: 'draft agenda', schema: AGENDA_SCHEMA },
    );
    const raw = parseJsonObject(text).items;
    const invited = new Set(input.people.map((p) => p.id));
    const items = (Array.isArray(raw) ? raw : [])
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {}))
      .map((v) => ({
        title: typeof v.title === 'string' ? v.title.trim().slice(0, 300) : '',
        ownerId: typeof v.ownerId === 'string' && invited.has(v.ownerId) ? v.ownerId : null,
        minutes: typeof v.minutes === 'number' && Number.isFinite(v.minutes) && v.minutes >= 1 ? Math.round(v.minutes) : null,
      }))
      .filter((i) => i.title)
      // At most 12, and no more items than the meeting has minutes (each gets at least one).
      .slice(0, Math.min(MAX_DRAFT_AGENDA, input.minutes));
    if (items.length === 0) throw new ValidationError('The AI didn’t suggest an agenda. Try again, or add the items yourself.');
    const share = Math.max(1, Math.round(input.minutes / items.length));
    const asked = items.map((i) => i.minutes ?? share);
    const total = asked.reduce((s, m) => s + m, 0);
    const scale = total > input.minutes ? input.minutes / total : 1;
    return items.map((i, n) => ({ title: i.title, ownerId: i.ownerId, minutes: Math.max(1, Math.floor(asked[n]! * scale)) }));
  }

  /** A short description for a meeting's invitation, from its title, agenda and what was typed. */
  async function writeMeetingDescription(input: { title: string; agenda?: string[]; text?: string }, requester?: AiRequester): Promise<string> {
    const text = await run(
      [
        'You write the description of a business meeting invitation: 1 to 3 sentences on its purpose and what it covers.',
        'Write in the language the organizer wrote in (Arabic or English). Use only what is given: never invent names, dates or numbers.',
        'Reply with ONLY JSON: {"description": string}.',
      ].join('\n'),
      [
        `Meeting: ${input.title}`,
        input.agenda?.length ? `Agenda:\n${input.agenda.map((a) => `- ${a}`).join('\n')}` : '',
        input.text?.trim() ? `What the organizer wrote: ${input.text.trim()}` : '',
      ].filter(Boolean).join('\n\n'),
      500,
      requester,
      { feature: 'meeting description', json: true },
    );
    const description = parseJsonObject(text).description;
    const out = typeof description === 'string' ? description.trim().slice(0, 2000) : '';
    if (!out) throw new ValidationError('The AI didn’t write a description. Try again, or write it yourself.');
    return out;
  }

  /** A concise 2–3 sentence status summary for a project. */
  async function summarizeProject(input: ProjectSummaryInput, requester?: AiRequester): Promise<string> {
    const { name, stats, sampleTitles } = input;
    const pct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    const summary = await run(
      'You are a delivery manager. Write a concise, plain-language status update in 2–3 sentences: overall progress, what needs attention, and momentum. No headings, no bullet points.',
      [
        `Project: ${name}`,
        `Tasks: ${stats.total} total, ${stats.completed} completed (${pct}%), ${stats.inProgress} in progress, ${stats.overdue} overdue.`,
        sampleTitles?.length ? `Recent items: ${sampleTitles.slice(0, 8).join('; ')}.` : '',
      ].filter(Boolean).join('\n'),
      300,
      requester,
      { feature: 'project summary' },
    );
    return summary.trim();
  }

  /** Suggest a priority for a task with a one-line reason. */
  async function suggestPriority(
    input: { title: string; description?: string; dueDate?: string | null },
    requester?: AiRequester,
  ): Promise<{ priority: Priority; reason: string }> {
    const text = await run(
      'You triage task priority. Reply with ONLY JSON: {"priority": "LOW"|"NORMAL"|"HIGH"|"URGENT", "reason": string (max 12 words)}.',
      `Title: ${input.title}\nDescription: ${input.description?.trim() || '(none)'}\nDue: ${input.dueDate || '(none)'}`,
      120,
      requester,
      { feature: 'suggest priority', schema: PRIORITY_SCHEMA },
    );
    const obj = parseJsonObject(text);
    const priority = PRIORITIES.includes(obj.priority as Priority) ? (obj.priority as Priority) : 'NORMAL';
    const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 140) : '';
    return { priority, reason };
  }

  /**
   * Draft a meeting's final minutes from its facts (see meetings/final-minutes minutesFacts). The
   * model is told to write only what the facts support. Returns its JSON; the caller checks it.
   * `background`: the Final MOM job (1.22), which nobody waits for at a page.
   */
  async function draftMinutes(facts: string, requester?: AiRequester, opts: { signal?: AbortSignal; background?: boolean; jobId?: string } = {}): Promise<Record<string, unknown>> {
    const text = await run(
      [
        'You write the final minutes of a business meeting. Use only the facts given: never invent names, dates, numbers or decisions.',
        'Write concise, professional sentences, in the language the notes are written in.',
        'Reply with ONLY JSON: {"summary": string (2-4 sentences: the purpose and the outcome),',
        ' "discussion": [{"topic": string (an agenda item, or "Other points"), "text": string (what was discussed, 1-4 sentences)}],',
        ' "decisions": string[], "risks": string[] (risks, issues and open questions), "nextSteps": string[] (each "action — owner, by date" when known)}.',
        'Leave a list empty when the facts give nothing for it.',
      ].join('\n'),
      facts,
      2500,
      requester,
      // A long answer: ~2,500 tokens at ~35 a second, after a cold load, is well over 2 minutes.
      {
        feature: 'Final MOM',
        schema: MINUTES_SCHEMA,
        wait: Math.max(timeoutMs, MINUTES_TIMEOUT_MS),
        signal: opts.signal,
        background: opts.background,
        // b2: the Final MOM job's tries of the same request are one piece of work on MICO360 AI.
        idempotencyKey: opts.jobId ? `tasks-mom-${opts.jobId}` : undefined,
      },
    );
    const obj = parseJsonObject(text);
    if (Object.keys(obj).length === 0) throw new ValidationError('The AI’s draft couldn’t be read. Try again, or start from the notes.');
    return obj;
  }

  return {
    breakdownTask,
    parseTask,
    parseMeeting,
    draftAgenda,
    writeMeetingDescription,
    summarizeProject,
    suggestPriority,
    draftMinutes,
    chatReady,
    chat,
    startMicoAiQuestion,
    checkLimits,
    startSearchQuestion,
    searchBudgetMs,
    warmUp,
    ocrReady,
    readsWholeDocuments,
    readPictures,
    readDocument,
    embeddingModel,
    embed,
  };
}

export type AiFeatureService = ReturnType<typeof createAiFeatureService>;

/** What a plain-English note fills in (null where it says nothing). */
export interface DescribedTask {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
}

/** An active portal user a described meeting may invite. */
export interface MeetingCandidate {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

/** What a sentence fills in on the new-meeting form (null or empty where it says nothing). */
export interface DescribedMeeting {
  title: string | null;
  description: string | null;
  /** YYYY-MM-DD, company time. */
  date: string | null;
  /** HH:MM, 24-hour, company time. */
  startTime: string | null;
  minutes: number | null;
  recurrence: RecurrenceRule | null;
  project: { id: string; code: string; number: string | null; name: string } | null;
  location: string | null;
  onlineLink: string | null;
  people: {
    found: Array<{ id: string; name: string; username: string }>;
    /** A name that fits more than one person: they choose. */
    choices: Array<{ said: string; options: Array<{ id: string; name: string; username: string }> }>;
    notFound: string[];
  };
  guests: Array<{ email: string; name: string }>;
  agenda: string[];
}

/** What Draft agenda works from (the server gathers the tasks and leftovers). */
export interface DraftAgendaInput {
  title: string;
  description?: string;
  text?: string;
  /** The meeting's length: the items' minutes are fitted to it. */
  minutes: number;
  /** The invited portal users (the organizer included): the only possible leads. */
  people: Array<{ id: string; name: string }>;
  tasks: Array<{ key: string; title: string; reason: 'overdue' | 'blocked' | 'due' }>;
  leftovers: Array<{ title: string; kind: 'action' | 'agenda' }>;
}

export interface DraftedAgendaItem {
  title: string;
  ownerId: string | null;
  minutes: number;
}

const MAX_DRAFT_AGENDA = 12;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** At most this many people are listed in the prompt (each one is a line). */
const MAX_PROMPT_PEOPLE = 300;
const MAX_AGENDA_POINTS = 10;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * The model's people, checked: only ids of active people count. A name more than one person goes by
 * is a choice even when the model picked one of them. So is a one-word name that isn't exactly the
 * person the model picked ("Omer", "عمر" for Omar) when others share that person's first name: that
 * is a guess. One id is found; none is "not found". `unlisted` (MICO360 AI, whose prompt may not hold
 * everyone): people the model could not name by id — a name said exactly as one of them, and nobody
 * else, is that person.
 */
export function matchPeople(value: unknown, people: Array<MeetingCandidate & { name: string }>, unlisted: ReadonlySet<string> = new Set()): DescribedMeeting['people'] {
  const order = new Map(people.map((p, i) => [p.id, i]));
  const out: DescribedMeeting['people'] = { found: [], choices: [], notFound: [] };
  for (const entry of (Array.isArray(value) ? value : []).slice(0, 50)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const said = typeof e.said === 'string' ? e.said.trim().slice(0, 100) : '';
    if (!said) continue;
    const ids = (Array.isArray(e.ids) ? e.ids : []).filter((id): id is string => typeof id === 'string' && order.has(id));
    const n = normalise(said);
    const named = (p: MeetingCandidate & { name: string }) => [p.firstName, p.lastName, p.username, p.name].some((x) => normalise(x) === n);
    const sameName = people.filter(named).map((p) => p.id);
    let chosen = [...new Set([...ids, ...(sameName.length > 1 ? sameName : [])])];
    if (chosen.length === 0 && sameName.length === 1 && unlisted.has(sameName[0]!)) chosen = sameName;
    if (chosen.length === 1 && !n.includes(' ')) {
      const only = people[order.get(chosen[0]!)!]!;
      const namesakes = people.filter((p) => normalise(p.firstName) === normalise(only.firstName)).map((p) => p.id);
      if (!named(only) && namesakes.length > 1) chosen = namesakes;
    }
    const options = chosen
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .map((id) => ({ id, name: people[order.get(id)!]!.name, username: people[order.get(id)!]!.username }));
    if (options.length === 1) {
      if (!out.found.some((f) => f.id === options[0]!.id)) out.found.push(options[0]!);
    } else if (options.length > 1) out.choices.push({ said, options });
    else out.notFound.push(said);
  }
  return out;
}

/** The email addresses written in the sentence, named as the model says, else from the part before the @. */
function guestsIn(sentence: string, value: unknown): DescribedMeeting['guests'] {
  const named = new Map<string, string>();
  for (const g of Array.isArray(value) ? value : []) {
    if (!g || typeof g !== 'object') continue;
    const { email, name } = g as Record<string, unknown>;
    if (typeof email === 'string' && typeof name === 'string' && name.trim()) named.set(email.trim().toLowerCase(), name.trim().slice(0, 200));
  }
  const seen = new Set<string>();
  const guests: DescribedMeeting['guests'] = [];
  for (const email of sentence.match(EMAIL) ?? []) {
    const key = email.toLowerCase();
    if (seen.has(key) || guests.length >= 50) continue;
    seen.add(key);
    guests.push({ email, name: named.get(key) ?? email.split('@')[0]! });
  }
  return guests;
}

/** The minutes draft is the one long answer: it gets 3 minutes, as MICO360 AI's guide advises for long text. */
const MINUTES_TIMEOUT_MS = 180_000;

/**
 * Background work on MICO360 AI (reading pictures, the Final MOM job): its OpenAI surface waits 300 s and
 * a vision job may run 300 s on a node (its guide, §5 and §7). Giving up sooner leaves the job running
 * there and the retry runs it again; just past 300 s, the platform's own 504 (with the job id) comes first.
 */
export const BACKGROUND_WAIT_MS = 310_000;
/** MICO360 AI's meaning-search sweep: at least the 120 s its guide asks of every client (§4, §7). */
export const EMBEDDING_SWEEP_WAIT_MS = 120_000;
/**
 * b3: a job MICO360 AI kept running after its 504 is collected for up to this long after the request
 * (background work only; under the 10 minutes a file being read is held for).
 */
export const BACKGROUND_COLLECT_MS = 9 * 60_000;
/** b11: a MICO360 AI key runs 4 requests at once unless an administrator changed it (its guide, §2). */
export const DEFAULT_KEY_CONCURRENCY = 4;
/** b5: a stand-in pair is written down at most this often. */
const SUBSTITUTION_NOTE_EVERY_MS = 10 * 60_000;
/** b13: a model stays loaded 30 minutes after use (its guide, §7); after 25 without an answer it may be cold. */
export const COLD_AFTER_MS = 25 * 60_000;
const WARM_UP_EVERY_MS = 5 * 60_000;
/** b13: the AI search panel's time: 20 s, and 90 s for a cold MICO360 AI model's first answer (20–90 s to load). */
export const AI_SEARCH_WARM_BUDGET_MS = 20_000;
export const AI_SEARCH_COLD_BUDGET_MS = 90_000;
/** b4: the platform's own wait for a whole document (its default; a longer one is collected, b3). */
const NATIVE_OCR_SECONDS = 300;
/** b4: refusals that send a document to the picture reader (the key, an older server, no node, a file it won't take). */
const OCR_FALLBACK_STATUSES: ReadonlySet<number> = new Set([403, 404, 413, 503]);
/** A node's 502 for a document over the platform's limits (guide §5: over 500 pages, a page over 50 million pixels). */
const OVER_LIMITS = /\b500 pages\b|50 million pixels|more than \d+ pages|too many pages/i;
/**
 * Review I3: one file's reading, every request together — about what one read took before (310 s), so
 * the minute's other search work is not held up longer; well inside the 10 minutes a file is claimed for.
 * What isn't done by then is tried again later, and what was is answered from its first reading.
 */
export const OCR_FILE_BUDGET_MS = 330_000;
/** No request is started with less than this left. */
const MIN_REQUEST_MS = 10_000;
/** Review I4: a guessed language that read fewer letters than this a page is read again without one. */
const POOR_LETTERS_PER_PAGE = 20;
/** …after which whole-document reading waits before it is tried again: no OCR node (503) briefly, otherwise an hour. */
const OCR_PAUSE_SHORT_MS = 10 * 60_000;
const OCR_PAUSE_LONG_MS = 60 * 60_000;

/** At most this many projects are listed in the prompt (each one is a line). */
const MAX_PROMPT_PROJECTS = 100;

/**
 * MICO360 AI only (32,000 characters a conversation, its guide §5): room kept for the platform's own
 * framing ("User: …"), and how long a name or title in a list may be. Every feature stays within the
 * limit at its largest inputs (ai-prompt-size.test); other providers' prompts are unchanged.
 */
const FRAMING_ROOM = 500;
const PROMPT_NAME_CHARS = 120;
const PROMPT_USERNAME_CHARS = 60;
const PROMPT_TITLE_CHARS = 200;

/** At most `n` characters, a cut one ending in "…" (never inside a character pair, such as an emoji). */
const cut = (s: string, n: number): string => (s.length > n ? `${cutChars(s, n - 1)}…` : s);

/**
 * A prompt list. With no room (other providers): every item's line, in order, at most `max`, as before.
 * With room (MICO360 AI): the items the text names first, then the rest, short lines, while they fit —
 * a line too long for what is left is passed over. Returns the lines, the items listed and their size.
 */
export function promptList<T>(items: T[], line: (item: T, short: boolean) => string, named: (item: T) => boolean, room: number | null, max = Infinity): { lines: string[]; listed: T[]; chars: number } {
  if (room === null) {
    const listed = items.slice(0, max);
    const lines = listed.map((x) => line(x, false));
    return { lines, listed, chars: lines.reduce((n, l) => n + l.length + 1, 0) };
  }
  const ordered = [...items.filter(named), ...items.filter((x) => !named(x))];
  const out: { lines: string[]; listed: T[]; chars: number } = { lines: [], listed: [], chars: 0 };
  for (const item of ordered) {
    if (out.listed.length >= max) break;
    const l = line(item, true);
    if (out.chars + l.length + 1 > room) continue;
    out.lines.push(l);
    out.listed.push(item);
    out.chars += l.length + 1;
  }
  return out;
}
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/**
 * A real calendar day written 'YYYY-MM-DD'. Review fix #29 (13 Nov 2026): an impossible one from the model
 * ("2026-13-01") is no day — never thrown (toISOString of an invalid date), as tasks/recurrence's isDayKey.
 */
const isDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const wholeInt = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;

/**
 * A model's "repeat" as a rule the task form can use, or null. Only the fields the form edits are
 * kept (frequency, interval, weekdays, day of month, end date or count); anything else is dropped.
 */
export function toRepeatRule(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!FREQUENCIES.includes(v.freq as (typeof FREQUENCIES)[number])) return null;
  if (typeof v.interval === 'number' && v.interval < 1) return null;
  const rule: RecurrenceRule = { freq: v.freq as RecurrenceRule['freq'], interval: wholeInt(v.interval, 1, 99) ?? 1 };
  if (rule.freq === 'WEEKLY' && Array.isArray(v.weekdays)) {
    const days = [...new Set(v.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length) rule.weekdays = days;
  }
  if ((rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') && Number.isInteger(v.dayOfMonth) && (v.dayOfMonth as number) >= 1 && (v.dayOfMonth as number) <= 31) {
    rule.dayOfMonth = v.dayOfMonth as number;
  }
  if (isDay(v.until)) rule.until = v.until;
  else if (Number.isInteger(v.count) && (v.count as number) >= 1) rule.count = Math.min(999, v.count as number);
  return isValidRule(rule) ? rule : null;
}

/**
 * The project a note is about, among the ones the person can use: one whose number is written in
 * the note (any case) or whose code is (in capitals, as codes are written, so the word "web" isn't
 * the WEB project), else the one the model named by code, number or name. Never one outside the list.
 */
export function matchProject<P extends { code: string; number: string | null; name: string }>(
  note: string,
  named: string | null,
  projects: P[],
): P | null {
  const token = (s: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, `u${flags}`);
  const written = projects.filter((p) => (p.number && token(p.number, 'i').test(note)) || token(p.code, '').test(note));
  if (written.length === 1) return written[0]!;
  if (named) {
    const n = normalise(named);
    const byName = projects.filter((p) => normalise(p.code) === n || (p.number && normalise(p.number) === n) || normalise(p.name) === n);
    if (byName.length === 1) return byName[0]!;
  }
  return null;
}

// ── Output parsing (LLMs sometimes wrap JSON in prose / code fences) ──────────
/** Extract a JSON string[] from model output, tolerating prose/fences; falls back to line parsing. */
export function parseStringArray(text: string): string[] {
  const arr = tryJson(sliceBetween(text, '[', ']'));
  if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  // Fallback: treat each non-empty line as an item, stripping bullets/numbering.
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.)\]]+/, '').trim())
    .filter(Boolean);
}

/** Extract the first JSON object from model output, tolerating prose/fences. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const obj = tryJson(sliceBetween(text, '{', '}'));
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
}

function sliceBetween(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
