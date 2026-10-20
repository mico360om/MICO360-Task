import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { validateProviderUrl } from './ai-network';
import { friendlyModelName, inferCapabilities, pickRecommended, type RemoteModel } from './ai-model-catalog';

/** Capabilities a model can serve. "document" = Document Processing. */
export const AI_CAPABILITIES = ['chat', 'ocr', 'vision', 'document', 'embedding'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const PROVIDER_KINDS = ['openai', 'anthropic', 'ollama', 'custom'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The services AI Management offers ready-made (address filled in); "custom" is any OpenAI-compatible one. */
export const PROVIDER_PRESETS = ['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'mistral', 'deepseek', 'mico360', 'ollama', 'custom'] as const;
export type ProviderPreset = (typeof PROVIDER_PRESETS)[number];

export interface AiProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Which ready-made service this is, for display. Older providers have none. */
  preset?: ProviderPreset | null;
  apiBaseUrl: string;
  apiKey: string; // secret — never sent to clients (see redactConfig)
  enabled: boolean;
  /** When the model list last loaded, when it was last tried, and why the last try failed. */
  lastSyncedAt?: string | null;
  lastSyncAttemptAt?: string | null;
  lastSyncError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiModelParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export interface AiModel {
  id: string;
  providerId: string;
  modelKey: string; // the provider's model identifier, e.g. "gpt-4o"
  displayName: string;
  capabilities: AiCapability[];
  parameters: AiModelParameters;
  concurrencyLimit: number;
  enabled: boolean; // admin toggle
  available: boolean; // detected from the provider on sync
  /** When the provider released the model (seconds since 1970), if it says: newer is recommended first. */
  created?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConfig {
  providers: AiProvider[];
  models: AiModel[];
  defaults: Partial<Record<AiCapability, string | null>>; // capability -> modelId
}

export interface Meta {
  id: string;
  now: string;
}

export function emptyConfig(): AiConfig {
  return { providers: [], models: [], defaults: {} };
}

// ── Redaction (never leak API keys) ──────────────────────────────────────────
export interface RedactedProvider extends Omit<AiProvider, 'apiKey'> {
  hasApiKey: boolean;
  apiKeyHint: string | null; // last 4 chars, e.g. "…a1b2"
  /** The chat model recommended among this provider's available models (switched on or not). */
  recommendedModelId: string | null;
}
export interface RedactedConfig {
  providers: RedactedProvider[];
  models: AiModel[];
  defaults: Partial<Record<AiCapability, string | null>>;
  /** The model "Automatic" stands for now, per capability (see automaticModels). */
  automatic: Record<AiCapability, string | null>;
}

export function redactConfig(config: AiConfig): RedactedConfig {
  return {
    providers: config.providers.map((p) => {
      const { apiKey, ...rest } = p;
      const offered = config.models.filter((m) => m.providerId === p.id && m.available);
      return {
        ...rest,
        hasApiKey: Boolean(apiKey),
        apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
        recommendedModelId: pickRecommended(offered, 'chat'),
      };
    }),
    models: config.models,
    defaults: config.defaults,
    automatic: automaticModels(config),
  };
}

// ── Validation helpers ───────────────────────────────────────────────────────
function requireProvider(config: AiConfig, id: string): AiProvider {
  const p = config.providers.find((x) => x.id === id);
  if (!p) throw new NotFoundError('AI provider not found.');
  return p;
}
function requireModel(config: AiConfig, id: string): AiModel {
  const m = config.models.find((x) => x.id === id);
  if (!m) throw new NotFoundError('AI model not found.');
  return m;
}
function validCapabilities(caps: unknown): AiCapability[] {
  if (!Array.isArray(caps) || caps.length === 0) throw new ValidationError('At least one capability is required.');
  for (const c of caps) if (!AI_CAPABILITIES.includes(c as AiCapability)) throw new ValidationError(`Unknown capability: ${c}`);
  return caps as AiCapability[];
}

// ── Provider operations ──────────────────────────────────────────────────────
export interface ProviderInput {
  name: string;
  kind: ProviderKind;
  preset?: ProviderPreset;
  apiBaseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

/** Network policy for provider URLs: private / internal hosts are refused unless allowed. */
export interface UrlPolicy {
  allowPrivateHosts?: boolean;
}

export function addProvider(config: AiConfig, input: ProviderInput, meta: Meta, policy: UrlPolicy = {}): { config: AiConfig; provider: AiProvider } {
  if (!input.name?.trim()) throw new ValidationError('Provider name is required.');
  if (!PROVIDER_KINDS.includes(input.kind)) throw new ValidationError('Invalid provider kind.');
  if (input.preset !== undefined && !PROVIDER_PRESETS.includes(input.preset)) throw new ValidationError('Invalid provider preset.');
  const provider: AiProvider = {
    id: meta.id,
    name: input.name.trim(),
    kind: input.kind,
    preset: input.preset ?? null,
    apiBaseUrl: validateProviderUrl(input.apiBaseUrl, policy.allowPrivateHosts),
    apiKey: input.apiKey ?? '',
    enabled: input.enabled ?? true,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
  return { config: { ...config, providers: [...config.providers, provider] }, provider };
}

export interface ProviderPatch {
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string; // empty string leaves the existing key untouched
  enabled?: boolean;
}

export function updateProvider(config: AiConfig, id: string, patch: ProviderPatch, now: string, policy: UrlPolicy = {}): AiConfig {
  const existing = requireProvider(config, id);
  if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError('Provider name is required.');
  const next: AiProvider = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    // Same URL rules as when adding a provider (editing used to skip them).
    ...(patch.apiBaseUrl !== undefined ? { apiBaseUrl: validateProviderUrl(patch.apiBaseUrl, policy.allowPrivateHosts) } : {}),
    ...(patch.apiKey ? { apiKey: patch.apiKey } : {}), // only overwrite when a non-empty key is provided
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: now,
  };
  return { ...config, providers: config.providers.map((p) => (p.id === id ? next : p)) };
}

export function removeProvider(config: AiConfig, id: string): AiConfig {
  requireProvider(config, id);
  const removedModelIds = new Set(config.models.filter((m) => m.providerId === id).map((m) => m.id));
  return {
    providers: config.providers.filter((p) => p.id !== id),
    models: config.models.filter((m) => m.providerId !== id),
    defaults: clearDefaults(config.defaults, removedModelIds),
  };
}

// ── Model operations ─────────────────────────────────────────────────────────
export interface ModelInput {
  providerId: string;
  modelKey: string;
  displayName?: string;
  capabilities: AiCapability[];
  parameters?: AiModelParameters;
  concurrencyLimit?: number;
  enabled?: boolean;
  available?: boolean;
}

export function addModel(config: AiConfig, input: ModelInput, meta: Meta): { config: AiConfig; model: AiModel } {
  requireProvider(config, input.providerId);
  if (!input.modelKey?.trim()) throw new ValidationError('Model key is required.');
  const caps = validCapabilities(input.capabilities);
  if (config.models.some((m) => m.providerId === input.providerId && m.modelKey === input.modelKey)) {
    throw new ValidationError('That model already exists for this provider.');
  }
  const model: AiModel = {
    id: meta.id,
    providerId: input.providerId,
    modelKey: input.modelKey.trim(),
    displayName: input.displayName?.trim() || input.modelKey.trim(),
    capabilities: caps,
    parameters: normalizeParams(input.parameters ?? {}),
    concurrencyLimit: clampConcurrency(input.concurrencyLimit ?? 4),
    enabled: input.enabled ?? true,
    available: input.available ?? true,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
  return { config: { ...config, models: [...config.models, model] }, model };
}

export interface ModelPatch {
  displayName?: string;
  capabilities?: AiCapability[];
  parameters?: AiModelParameters;
  concurrencyLimit?: number;
  enabled?: boolean;
}

export function updateModel(config: AiConfig, id: string, patch: ModelPatch, now: string): AiConfig {
  const existing = requireModel(config, id);
  const next: AiModel = {
    ...existing,
    ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || existing.modelKey } : {}),
    ...(patch.capabilities !== undefined ? { capabilities: validCapabilities(patch.capabilities) } : {}),
    ...(patch.parameters !== undefined ? { parameters: normalizeParams(patch.parameters) } : {}),
    ...(patch.concurrencyLimit !== undefined ? { concurrencyLimit: clampConcurrency(patch.concurrencyLimit) } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: now,
  };
  let defaults = config.defaults;
  if (patch.enabled === false) defaults = clearDefaults(defaults, new Set([id])); // a disabled model can't stay a default
  return { ...config, models: config.models.map((m) => (m.id === id ? next : m)), defaults };
}

export function removeModel(config: AiConfig, id: string): AiConfig {
  requireModel(config, id);
  return {
    ...config,
    models: config.models.filter((m) => m.id !== id),
    defaults: clearDefaults(config.defaults, new Set([id])),
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────────
export function setDefault(config: AiConfig, capability: string, modelId: string | null, now: string): AiConfig {
  if (!AI_CAPABILITIES.includes(capability as AiCapability)) throw new ValidationError(`Unknown capability: ${capability}`);
  if (modelId === null) {
    return { ...config, defaults: { ...config.defaults, [capability]: null } };
  }
  const model = requireModel(config, modelId);
  if (!model.capabilities.includes(capability as AiCapability)) {
    throw new ValidationError(`That model does not support ${capability}.`);
  }
  if (!model.enabled) throw new ValidationError('Cannot set a disabled model as the default.');
  void now;
  return { ...config, defaults: { ...config.defaults, [capability]: modelId } };
}

// ── Provider sync (mark availability + auto-detect new models) ───────────────
/**
 * Apply a provider's current model list: known models are marked available or not (and get the
 * provider's name for them unless an admin renamed them), new ones are added switched off with
 * what they can do. The first time a provider's list loads and none of its models is on, its
 * recommended chat model is switched on, so AI works right after connecting; after that the
 * admin's on/off choices are never changed.
 */
export function applySync(config: AiConfig, providerId: string, remoteModels: Array<string | RemoteModel>, meta: Meta): AiConfig {
  const provider = requireProvider(config, providerId);
  const remote = new Map<string, RemoteModel>();
  for (const r of remoteModels) {
    const m = typeof r === 'string' ? { key: r } : r;
    const key = m.key.trim();
    if (key && !remote.has(key)) remote.set(key, { ...m, key });
  }
  const known = new Set(config.models.filter((m) => m.providerId === providerId).map((m) => m.modelKey));

  // Update availability of known models.
  let models = config.models.map((m) => {
    if (m.providerId !== providerId) return m;
    const r = remote.get(m.modelKey);
    const renamed = m.displayName !== m.modelKey && m.displayName !== friendlyModelName(m.modelKey);
    return {
      ...m,
      available: Boolean(r),
      ...(r?.displayName && !renamed ? { displayName: r.displayName } : {}),
      ...(r?.created !== undefined && m.created === undefined ? { created: r.created } : {}),
      updatedAt: meta.now,
    };
  });

  // Auto-detect newly available models (added disabled, so they stay hidden until an admin enables them).
  let seq = 0;
  for (const [key, r] of remote) {
    if (known.has(key)) continue;
    models.push({
      id: `${meta.id}-${seq++}`,
      providerId,
      modelKey: key,
      displayName: r.displayName || friendlyModelName(key),
      capabilities: r.capabilities?.length ? [...r.capabilities] : inferCapabilities(key),
      parameters: {},
      concurrencyLimit: 4,
      enabled: false,
      available: true,
      ...(r.created !== undefined ? { created: r.created } : {}),
      createdAt: meta.now,
      updatedAt: meta.now,
    });
  }

  const own = models.filter((m) => m.providerId === providerId);
  if (!provider.lastSyncedAt && !own.some((m) => m.enabled)) {
    const pick = pickRecommended(own.filter((m) => m.available), 'chat');
    if (pick) models = models.map((m) => (m.id === pick ? { ...m, enabled: true } : m));
  }

  const providers = config.providers.map((p) =>
    p.id === providerId ? { ...p, lastSyncedAt: meta.now, lastSyncAttemptAt: meta.now, lastSyncError: null } : p,
  );
  return { ...config, providers, models };
}

/** A model list that could not be loaded: note why and when, and leave every model as it was. */
export function recordSyncFailure(config: AiConfig, providerId: string, message: string, now: string): AiConfig {
  requireProvider(config, providerId);
  return {
    ...config,
    providers: config.providers.map((p) =>
      p.id === providerId ? { ...p, lastSyncAttemptAt: now, lastSyncError: message.slice(0, 300) } : p,
    ),
  };
}

// ── Consumer view (hide disabled/unavailable models from users + APIs) ───────
export function usableModels(config: AiConfig, capability?: string): AiModel[] {
  const enabledProviders = new Set(config.providers.filter((p) => p.enabled).map((p) => p.id));
  return config.models.filter(
    (m) =>
      m.enabled &&
      m.available &&
      enabledProviders.has(m.providerId) &&
      (!capability || m.capabilities.includes(capability as AiCapability)),
  );
}

/** The default model for a capability, but only if it's still usable; otherwise null. */
export function resolveDefaultModel(config: AiConfig, capability: AiCapability): AiModel | null {
  const id = config.defaults[capability];
  if (!id) return null;
  return usableModels(config, capability).find((m) => m.id === id) ?? null;
}

/** What "Automatic" picks for each capability: the recommended model among the usable ones. */
export function automaticModels(config: AiConfig): Record<AiCapability, string | null> {
  const out = {} as Record<AiCapability, string | null>;
  for (const cap of AI_CAPABILITIES) out[cap] = pickRecommended(usableModels(config, cap), cap);
  return out;
}

/** The model a capability really uses: the chosen default while it is usable, else the automatic choice. */
export function effectiveModel(config: AiConfig, capability: AiCapability): AiModel | null {
  const chosen = resolveDefaultModel(config, capability);
  if (chosen) return chosen;
  const id = pickRecommended(usableModels(config, capability), capability);
  return id ? (config.models.find((m) => m.id === id) ?? null) : null;
}

// ── small helpers ────────────────────────────────────────────────────────────
function clearDefaults(defaults: AiConfig['defaults'], removedModelIds: Set<string>): AiConfig['defaults'] {
  const next: AiConfig['defaults'] = { ...defaults };
  for (const cap of Object.keys(next) as AiCapability[]) {
    if (next[cap] && removedModelIds.has(next[cap] as string)) next[cap] = null;
  }
  return next;
}
function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(64, Math.round(n)));
}
function normalizeParams(p: AiModelParameters): AiModelParameters {
  const out: AiModelParameters = { ...p };
  if (out.temperature !== undefined) out.temperature = Math.max(0, Math.min(2, Number(out.temperature)));
  if (out.topP !== undefined) out.topP = Math.max(0, Math.min(1, Number(out.topP)));
  if (out.maxTokens !== undefined) out.maxTokens = Math.max(1, Math.round(Number(out.maxTokens)));
  return out;
}
