import { ValidationError } from '../../lib/http-errors';
import type { AiProvider } from './ai-config';
import { createSafeFetch, providerFetch, readProviderJson } from './ai-network';

export interface SyncOptions {
  /** Abort a provider call that takes longer than this. Default 15 seconds. */
  timeoutMs?: number;
  /** Allow private / internal provider hosts (a local model server). Default false. */
  allowPrivateHosts?: boolean;
}

/** Bounds on what a provider's model list may add to the stored config. */
export const MAX_SYNCED_MODELS = 500;
export const MAX_MODEL_KEY_LENGTH = 200;

/**
 * Detect the model keys a provider currently offers, so admins can auto-sync the
 * available model list. Handles the common provider shapes; `fetchImpl` is
 * injected for testing.
 */
export async function fetchProviderModels(
  provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey'>,
  fetchImpl?: typeof fetch,
  opts: SyncOptions = {},
): Promise<string[]> {
  const base = provider.apiBaseUrl.replace(/\/+$/, '');
  let url: string;
  const headers: Record<string, string> = { Accept: 'application/json' };

  switch (provider.kind) {
    case 'ollama':
      url = `${base}/api/tags`;
      break;
    case 'anthropic':
      url = `${base}/v1/models`;
      if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case 'openai':
    case 'custom':
    default:
      url = `${base}/models`;
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
      break;
  }

  const res = await providerFetch(
    url,
    { headers },
    {
      fetchImpl: fetchImpl ?? createSafeFetch({ allowPrivateHosts: opts.allowPrivateHosts }),
      timeoutMs: opts.timeoutMs ?? 15_000,
      allowPrivateHosts: opts.allowPrivateHosts,
    },
  );
  if (!res.ok) {
    throw new ValidationError(`The provider rejected the request (HTTP ${res.status}). Check the API key.`);
  }
  return extractModelKeys(provider.kind, await readProviderJson(res));
}

/**
 * Pull model identifiers out of the various provider response shapes. Only plausible ids are
 * kept (bounded length, no control characters) and the list is capped, since the answer comes
 * from an external server and is stored in the config.
 */
export function extractModelKeys(kind: AiProvider['kind'], json: unknown): string[] {
  const body = (json && typeof json === 'object' ? json : {}) as { data?: unknown; models?: unknown };
  const list = (kind === 'ollama' ? body.models : body.data) as Array<{ name?: unknown; id?: unknown } | null> | undefined;
  if (!Array.isArray(list)) return [];
  const keys = list.map((m) => (kind === 'ollama' ? (m?.name ?? m?.id) : m?.id));
  const valid = keys
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim())
    // eslint-disable-next-line no-control-regex
    .filter((k) => k.length > 0 && k.length <= MAX_MODEL_KEY_LENGTH && !/[\u0000-\u001f\u007f]/.test(k));
  return [...new Set(valid)].slice(0, MAX_SYNCED_MODELS);
}
