import { ValidationError } from '../../lib/http-errors';
import type { AiCapability, AiProvider } from './ai-config';
import { createSafeFetch, providerFetch, readProviderJson } from './ai-network';
import { friendlyModelName, inferCapabilities, isUsableModelKey, type RemoteModel } from './ai-model-catalog';

export interface SyncOptions {
  /** Abort a provider call that takes longer than this. Default 15 seconds. */
  timeoutMs?: number;
  /** Allow private / internal provider hosts (a local model server). Default false. */
  allowPrivateHosts?: boolean;
}

/** Bounds on what a provider's model list may add to the stored config. */
export const MAX_SYNCED_MODELS = 500;
export const MAX_MODEL_KEY_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * A provider answered the model-list request with an error (401/403: the key wasn't accepted).
 * `providerStatus` is the provider's HTTP status; our own answer stays 400 (`status`), so a
 * provider's 401 never looks like an expired session to the web app.
 */
export class ProviderHttpError extends ValidationError {
  constructor(public readonly providerStatus: number) {
    super(
      providerStatus === 401 || providerStatus === 403
        ? 'The provider did not accept the API key. Check it and try again.'
        : `The provider could not list its models (HTTP ${providerStatus}). Check the address.`,
    );
  }
}

/**
 * The models a provider currently offers, with what each can do and a readable name, so admins
 * get the list without typing model names. Handles the common provider shapes; `fetchImpl` is
 * injected for testing.
 */
export async function fetchProviderModels(
  provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey'>,
  fetchImpl?: typeof fetch,
  opts: SyncOptions = {},
): Promise<RemoteModel[]> {
  const base = provider.apiBaseUrl.replace(/\/+$/, '');
  let url: string;
  const headers: Record<string, string> = { Accept: 'application/json' };

  switch (provider.kind) {
    case 'ollama':
      url = `${base}/api/tags`;
      break;
    case 'anthropic':
      url = `${base}/v1/models?limit=1000`; // Anthropic sends 20 a page unless asked for more
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
  if (!res.ok) throw new ProviderHttpError(res.status);
  return extractModels(provider.kind, await readProviderJson(res));
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  display_name?: unknown;
  created?: unknown;
  created_at?: unknown;
  modified_at?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown } | null;
  capabilities?: { completion_chat?: unknown; vision?: unknown } | null;
}

const VISION_CAPABILITIES: AiCapability[] = ['chat', 'vision', 'ocr', 'document'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function releaseTime(m: RawModel): number | undefined {
  if (typeof m.created === 'number' && Number.isFinite(m.created) && m.created > 0) return m.created;
  const iso = str(m.created_at) ?? str(m.modified_at);
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

/**
 * Pull the models out of the various provider response shapes. Only plausible ids are kept
 * (bounded length, no control characters), models the app can't use (image, speech,
 * moderation…) are left out, and the list is capped, since the answer comes from an external
 * server and is stored in the config. What the provider says about a model (its name, what it
 * reads and writes) wins over guesses from the id.
 */
export function extractModels(kind: AiProvider['kind'], json: unknown): RemoteModel[] {
  const body = (json && typeof json === 'object' ? json : {}) as { data?: unknown; models?: unknown };
  const list = (kind === 'ollama' ? body.models : body.data) as Array<RawModel | null> | undefined;
  if (!Array.isArray(list)) return [];

  const out = new Map<string, RemoteModel>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = kind === 'ollama' ? (raw.name ?? raw.model ?? raw.id) : raw.id;
    if (typeof id !== 'string') continue;
    const key = id.trim().replace(/^models\//, ''); // Gemini lists "models/gemini-…"
    // eslint-disable-next-line no-control-regex
    if (!key || key.length > MAX_MODEL_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(key) || out.has(key)) continue;
    if (!isUsableModelKey(kind, key)) continue;

    let capabilities = inferCapabilities(key);
    const embedding = capabilities[0] === 'embedding';
    const outputs = raw.architecture?.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes('text')) continue; // OpenRouter: an image/audio model
    if (raw.capabilities?.completion_chat === false && !embedding) continue; // Mistral: not a chat model (e.g. OCR)
    const inputs = raw.architecture?.input_modalities;
    if (!embedding && Array.isArray(inputs)) capabilities = inputs.includes('image') ? VISION_CAPABILITIES : ['chat'];
    if (!embedding && typeof raw.capabilities?.vision === 'boolean') capabilities = raw.capabilities.vision ? VISION_CAPABILITIES : ['chat'];

    const given = str(raw.display_name) ?? (str(raw.name) !== id ? str(raw.name) : undefined);
    const model: RemoteModel = {
      key,
      displayName: (given ?? friendlyModelName(key)).slice(0, MAX_DISPLAY_NAME_LENGTH),
      capabilities: [...capabilities],
    };
    const created = releaseTime(raw);
    if (created !== undefined) model.created = created;
    out.set(key, model);
    if (out.size >= MAX_SYNCED_MODELS) break;
  }
  return [...out.values()];
}
