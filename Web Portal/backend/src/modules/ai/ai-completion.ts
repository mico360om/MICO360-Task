import { ValidationError } from '../../lib/http-errors';
import type { AiModelParameters, AiProvider } from './ai-config';

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

/**
 * Single-turn text completion against a configured provider. Speaks each provider kind's
 * chat API (Anthropic Messages, OpenAI/custom chat-completions, Ollama chat) and returns the
 * assistant's text. `fetchImpl` is injected so features are fully testable without a network.
 */
export async function complete(model: ChatModel, input: CompletionInput, fetchImpl: typeof fetch = fetch): Promise<string> {
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
    default:
      url = `${base}/chat/completions`;
      if (model.provider.apiKey) headers['Authorization'] = `Bearer ${model.provider.apiKey}`;
      body = {
        model: model.modelKey,
        max_tokens: maxTokens,
        temperature,
        messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
      };
      break;
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new ValidationError('Could not reach the AI provider. Check the API URL and network.');
  }
  if (!res.ok) {
    throw new ValidationError(`The AI provider rejected the request (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as unknown;
  const text = extractText(model.provider.kind, json);
  if (!text) throw new ValidationError('The AI provider returned an empty response.');
  return text;
}

/** Pull the assistant text out of each provider's response shape. */
export function extractText(kind: AiProvider['kind'], json: unknown): string {
  const b = json as {
    content?: Array<{ type?: string; text?: string }>;
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (kind === 'anthropic') {
    return (b.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text ?? '').join('').trim();
  }
  if (kind === 'ollama') {
    return (b.message?.content ?? '').trim();
  }
  return (b.choices?.[0]?.message?.content ?? '').trim();
}
