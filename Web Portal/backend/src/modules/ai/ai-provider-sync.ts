import { ValidationError } from '../../lib/http-errors';
import type { AiProvider } from './ai-config';

/**
 * Detect the model keys a provider currently offers, so admins can auto-sync the
 * available model list. Handles the common provider shapes; `fetchImpl` is
 * injected for testing.
 */
export async function fetchProviderModels(
  provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey'>,
  fetchImpl: typeof fetch = fetch,
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

  let res: Response;
  try {
    res = await fetchImpl(url, { headers });
  } catch {
    throw new ValidationError('Could not reach the AI provider. Check the API URL and network.');
  }
  if (!res.ok) {
    throw new ValidationError(`The provider rejected the request (HTTP ${res.status}). Check the API key.`);
  }
  const json = (await res.json()) as unknown;
  return extractModelKeys(provider.kind, json);
}

/** Pull model identifiers out of the various provider response shapes. */
export function extractModelKeys(kind: AiProvider['kind'], json: unknown): string[] {
  const body = json as { data?: Array<{ id?: string }>; models?: Array<{ name?: string; id?: string }> };
  let keys: Array<string | undefined> = [];
  if (kind === 'ollama') {
    keys = (body.models ?? []).map((m) => m.name ?? m.id);
  } else {
    keys = (body.data ?? []).map((m) => m.id);
  }
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0))];
}
