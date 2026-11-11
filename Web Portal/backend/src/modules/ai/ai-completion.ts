import { ValidationError } from '../../lib/http-errors';
import type { AiModelParameters, AiProvider } from './ai-config';
import { isReasoningModel } from './ai-model-catalog';
import { createSafeFetch, isMico360Provider, providerErrorDetail, providerFetch, readProviderJson } from './ai-network';
import { wellFormed } from './ai-text';

/** OpenAI reasoning models think before answering, out of the same token budget: leave them room. */
const REASONING_MIN_TOKENS = 4096;

/**
 * A provider refused a request. `message` is what anyone may see; `detail` is the provider's own
 * explanation (which can name models or accounts), shown to admins only (the model test).
 * `providerStatus` is the provider's HTTP status; our own answer stays 400 (`status`), so a
 * provider's 401 or 429 never reads as the user's session expiring or their own rate limit.
 */
export class ProviderRefusedError extends ValidationError {
  constructor(
    public readonly providerStatus: number,
    public readonly detail: string | null,
    /** A 429 for a used-up quota (MICO360 AI), not a busy moment: trying again soon won't help. */
    public readonly quota = false,
  ) {
    super(quota ? QUOTA_MESSAGE : refusalMessage(providerStatus));
  }
}

const QUOTA_MESSAGE =
  'The AI service’s usage allowance is used up for now (HTTP 429). It starts again when its period resets — an admin can check the key’s quota in MICO360 Connect.';

/**
 * MICO360 AI's 429 is one of three (its guide, §2, §5, §8): the key's concurrency (Retry-After: 1), its
 * rate limit (until the minute ends) or a quota — "Quota exceeded: …", with a Retry-After until the
 * period resets (an hour, a day, a month). A quota is said as one; the others are "busy".
 */
const QUOTA_RETRY_AFTER_SECONDS = 60;

/** The provider's refusal, read from its answer: the reason it gives, and (MICO360 AI) whether it is a quota. */
export async function providerRefusal(res: Response, provider: { preset?: string | null; apiBaseUrl?: string | null }): Promise<ProviderRefusedError> {
  const detail = await providerErrorDetail(res);
  const retryAfter = Number(res.headers.get('retry-after'));
  const quota =
    isMico360Provider(provider) &&
    res.status === 429 &&
    (/^\s*quota exceeded/i.test(detail ?? '') || (Number.isFinite(retryAfter) && retryAfter > QUOTA_RETRY_AFTER_SECONDS));
  return new ProviderRefusedError(res.status, detail, quota);
}

/** What a person is told for a provider's answer: the plain cause where the status says it. */
function refusalMessage(status: number): string {
  switch (status) {
    case 429:
      return 'The AI service is busy right now (HTTP 429). Try again in a moment.';
    case 503:
      return 'The AI service has no model available right now (HTTP 503). Try again in a minute, or ask an admin to check AI Management.';
    case 504:
      return 'The AI service took too long to answer (HTTP 504). Try again.';
    case 413:
      return 'That is too long for the AI service to read (HTTP 413).';
    default:
      return `The AI provider rejected the request (HTTP ${status}).`;
  }
}

/** A "try again in a second" (429) worth waiting for once: a Retry-After of at most this many seconds. */
const SHORT_RETRY_SECONDS = 3;

/** The Retry-After of a 429 in milliseconds when it is short enough to wait for, else null. */
function shortRetryAfter(res: Response): number | null {
  if (res.status !== 429) return null;
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= SHORT_RETRY_SECONDS ? seconds * 1000 : null;
}

/** A resolved model ready to invoke: its provider connection + the provider's model key. */
export interface ChatModel {
  provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey' | 'preset'>;
  modelKey: string;
  parameters?: AiModelParameters;
}

export interface CompletionInput {
  /** System / instruction prompt (how to behave). */
  system?: string;
  /** The user prompt (the task/content to act on). */
  prompt: string;
  /** Cap the response length; falls back to the model's configured maxTokens, then 1024. */
  maxTokens?: number;
  /**
   * The caller parses the answer as JSON. MICO360 AI is then asked for a JSON answer
   * (`response_format: json_object`), which its platform holds the model to; other providers are
   * asked in the prompt only, as before.
   */
  json?: boolean;
  /** 1.23 OCR: pictures for the model to read with the prompt (a model that reads images). */
  images?: { data: Buffer; mimeType: string }[];
}

export interface CompletionOptions {
  /** Abort a provider call that takes longer than this. Default 120 seconds (a model loading cold takes 45–90). */
  timeoutMs?: number;
  /** Allow private / internal provider hosts (a local model server). Default false. */
  allowPrivateHosts?: boolean;
  /** Waits before the one retry of a "busy, try again in a second" (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
  /** The caller's stop: the call ends at once with AiCallStoppedError (MICO AI's Stop button). */
  signal?: AbortSignal;
}

/** The default wait for a provider's answer: a cold model on MICO360 AI loads for 20–90 seconds. */
export const COMPLETION_TIMEOUT_MS = 120_000;

/**
 * The most MICO360 AI reads of one conversation, system messages included (its guide, §5 and §11):
 * over it, 413. Every feature's prompt is built to fit it (ai-prompt-size.test).
 */
export const CONVERSATION_LIMIT = 32_000;

/**
 * Single-turn text completion against a configured provider. Speaks each provider kind's
 * chat API (Anthropic Messages, OpenAI/custom chat-completions, Ollama chat) and returns the
 * assistant's text. `fetchImpl` is injected so features are fully testable without a network.
 */
export async function complete(
  model: ChatModel,
  given: CompletionInput,
  fetchImpl?: typeof fetch,
  opts: CompletionOptions = {},
): Promise<string> {
  // MICO360 AI's JSON reader refuses half a character ("\ud83d", from a text cut inside an emoji): the
  // instructions and the prompt are sent well formed (review I2). Other providers get them as given.
  const input: CompletionInput = isMico360Provider(model.provider)
    ? { ...given, prompt: wellFormed(given.prompt), ...(given.system !== undefined ? { system: wellFormed(given.system) } : {}) }
    : given;
  const base = model.provider.apiBaseUrl.replace(/\/+$/, '');
  const maxTokens = input.maxTokens ?? model.parameters?.maxTokens ?? 1024;
  const temperature = model.parameters?.temperature ?? 0.3;
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  let url: string;
  let body: unknown;
  const images = input.images ?? [];
  const b64 = (img: { data: Buffer }) => img.data.toString('base64');

  switch (model.provider.kind) {
    case 'anthropic':
      url = `${base}/v1/messages`;
      if (model.provider.apiKey) headers['x-api-key'] = model.provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: model.modelKey,
        max_tokens: maxTokens,
        temperature,
        ...(input.system ? { system: input.system } : {}),
        messages: [
          {
            role: 'user',
            content: images.length
              ? [...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: b64(img) } })), { type: 'text', text: input.prompt }]
              : input.prompt,
          },
        ],
      };
      break;
    case 'ollama':
      url = `${base}/api/chat`;
      body = {
        model: model.modelKey,
        stream: false,
        options: { temperature },
        messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt, ...(images.length ? { images: images.map(b64) } : {}) }],
      };
      break;
    case 'openai':
    case 'custom':
    default: {
      url = `${base}/chat/completions`;
      if (model.provider.apiKey) headers['Authorization'] = `Bearer ${model.provider.apiKey}`;
      const userContent = images.length
        ? [{ type: 'text', text: input.prompt }, ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${b64(img)}` } }))]
        : input.prompt;
      const messages = [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: userContent }];
      if (model.provider.kind !== 'openai') {
        // Other OpenAI-compatible services still take max_tokens.
        body = { model: model.modelKey, max_tokens: maxTokens, temperature, messages };
        if (input.json && isMico360Provider(model.provider)) (body as Record<string, unknown>).response_format = { type: 'json_object' };
      } else if (isReasoningModel(model.modelKey)) {
        // o-series and GPT-5 refuse max_tokens and any temperature but the default.
        body = { model: model.modelKey, max_completion_tokens: Math.max(maxTokens, REASONING_MIN_TOKENS), reasoning_effort: 'low', messages };
      } else {
        body = { model: model.modelKey, max_completion_tokens: maxTokens, temperature, messages };
      }
      break;
    }
  }

  const send = () =>
    providerFetch(
      url,
      { method: 'POST', headers, body: JSON.stringify(body) },
      {
        fetchImpl: fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
        timeoutMs: opts.timeoutMs ?? COMPLETION_TIMEOUT_MS,
        allowPrivateHosts: opts.allowPrivateHosts,
        signal: opts.signal,
      },
    );
  let res = await send();
  // A service at its concurrency limit says "try again in a second": wait that once, then ask again.
  const wait = shortRetryAfter(res);
  if (wait !== null) {
    await res.body?.cancel().catch(() => {});
    await (opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
    res = await send();
  }
  if (!res.ok) throw await providerRefusal(res, model.provider);
  const json = await readProviderJson(res);
  const text = extractText(model.provider.kind, json);
  if (!text) throw new ValidationError('The AI provider returned an empty response.');
  return text;
}

/** Pull the assistant text out of each provider's response shape. */
export function extractText(kind: AiProvider['kind'], json: unknown): string {
  // The body comes from an external server: tolerate any shape instead of throwing a 500.
  const b = (json && typeof json === 'object' ? json : {}) as {
    content?: unknown;
    message?: { content?: unknown };
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (kind === 'anthropic') {
    const parts = Array.isArray(b.content) ? (b.content as Array<{ type?: string; text?: unknown } | null>) : [];
    return parts.filter((p) => p?.type === 'text').map((p) => str(p?.text)).join('').trim();
  }
  if (kind === 'ollama') {
    return str(b.message?.content).trim();
  }
  return str(Array.isArray(b.choices) ? b.choices[0]?.message?.content : undefined).trim();
}
