import { ValidationError } from '../../lib/http-errors';
import type { AiModelParameters, AiProvider } from './ai-config';
import { isReasoningModel } from './ai-model-catalog';
import { createSafeFetch, providerFetch, readProviderJson } from './ai-network';

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
  ) {
    super(`The AI provider rejected the request (HTTP ${providerStatus}).`);
  }
}

/** The provider's explanation in an error body, if there is a readable one (bounded). */
async function refusalDetail(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).slice(0, 4000);
    let msg: unknown = text;
    try {
      const j = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
      const e = j.error;
      msg = (e && typeof e === 'object' ? (e as { message?: unknown }).message : e) ?? j.message ?? j.detail;
    } catch {
      // not JSON: the text itself, if it isn't a web page
      if (/^\s*</.test(text)) msg = null;
    }
    // eslint-disable-next-line no-control-regex
    return typeof msg === 'string' && msg.trim() ? msg.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** A resolved model ready to invoke: its provider connection + the provider's model key. */
export interface ChatModel {
  provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey'>;
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
}

export interface CompletionOptions {
  /** Abort a provider call that takes longer than this. Default 60 seconds. */
  timeoutMs?: number;
  /** Allow private / internal provider hosts (a local model server). Default false. */
  allowPrivateHosts?: boolean;
}

/**
 * Single-turn text completion against a configured provider. Speaks each provider kind's
 * chat API (Anthropic Messages, OpenAI/custom chat-completions, Ollama chat) and returns the
 * assistant's text. `fetchImpl` is injected so features are fully testable without a network.
 */
export async function complete(
  model: ChatModel,
  input: CompletionInput,
  fetchImpl?: typeof fetch,
  opts: CompletionOptions = {},
): Promise<string> {
  const base = model.provider.apiBaseUrl.replace(/\/+$/, '');
  const maxTokens = input.maxTokens ?? model.parameters?.maxTokens ?? 1024;
  const temperature = model.parameters?.temperature ?? 0.3;
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  let url: string;
  let body: unknown;

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
        messages: [{ role: 'user', content: input.prompt }],
      };
      break;
    case 'ollama':
      url = `${base}/api/chat`;
      body = {
        model: model.modelKey,
        stream: false,
        options: { temperature },
        messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
      };
      break;
    case 'openai':
    case 'custom':
    default: {
      url = `${base}/chat/completions`;
      if (model.provider.apiKey) headers['Authorization'] = `Bearer ${model.provider.apiKey}`;
      const messages = [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }];
      if (model.provider.kind !== 'openai') {
        // Other OpenAI-compatible services still take max_tokens.
        body = { model: model.modelKey, max_tokens: maxTokens, temperature, messages };
      } else if (isReasoningModel(model.modelKey)) {
        // o-series and GPT-5 refuse max_tokens and any temperature but the default.
        body = { model: model.modelKey, max_completion_tokens: Math.max(maxTokens, REASONING_MIN_TOKENS), reasoning_effort: 'low', messages };
      } else {
        body = { model: model.modelKey, max_completion_tokens: maxTokens, temperature, messages };
      }
      break;
    }
  }

  const res = await providerFetch(
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    {
      fetchImpl: fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
      timeoutMs: opts.timeoutMs ?? 60_000,
      allowPrivateHosts: opts.allowPrivateHosts,
    },
  );
  if (!res.ok) throw new ProviderRefusedError(res.status, await refusalDetail(res));
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
