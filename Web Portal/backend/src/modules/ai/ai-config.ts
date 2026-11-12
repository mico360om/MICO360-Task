import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { isMico360Provider, validateProviderUrl } from './ai-network';
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
  /** MICO360 AI: what its platform said about itself (AI Management's provider card). */
  platform?: ProviderPlatform;
  createdAt: string;
  updatedAt: string;
}

/** b5: another model answered than the one asked for (the platform's substitution), counted per pair. */
export interface PlatformSubstitution {
  asked: string;
  answered: string;
  count: number;
  firstAt: string;
  at: string;
}

/**
 * MICO360 AI's facts about itself, read when its models load (and once a day): the server's version
 * (b12, GET /api/status), what the fleet can do (b7, GET /api/v1/models), how many requests the key may
 * run at once (b11, GET /api/v1/status); and what Tasks noticed: whole-document reading refused, so
 * scans were read as pictures (b4), models that stood in for others (b5), and strict answer shapes
 * (json_schema) refused, so JSON mode is used (the safety net).
 */
export interface ProviderPlatform {
  version?: string | null;
  commit?: string | null;
  /** Every connected node's capabilities (Chat, Vision, Embedding, Ocr…); null: not read yet. */
  capabilities?: string[] | null;
  concurrencyLimit?: number | null;
  checkedAt?: string | null;
  /** The last refusal of POST /api/v1/ocr that sent scans to the picture reader; null once it works again. */
  ocrFallback?: { status: number; reason: string | null; at: string } | null;
  /** Newest first, at most MAX_SUBSTITUTIONS. */
  substitutions?: PlatformSubstitution[];
  /**
   * Safety net: this Connect refused an answer held to a JSON Schema (json_schema, or the stream's schema
   * `format`), so answers are asked for in JSON mode (json_object) for STRICT_JSON_PAUSE_MS, or until the
   * next model refresh forgets it.
   */
  strictJsonRefused?: { status: number; reason: string | null; at: string } | null;
}

export const MAX_SUBSTITUTIONS = 10;

/** Safety net: how long a Connect that refused strict answer shapes is asked in JSON mode instead. */
export const STRICT_JSON_PAUSE_MS = 24 * 60 * 60 * 1000;

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
  /**
   * MICO360 AI: when the provider's list first left it out (that list omits busy nodes' models for a
   * while). It stays available until MISSING_GRACE_MS have passed; absent while the list has it.
   */
  missingSince?: string;
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
      const offered = rankable(config, config.models.filter((m) => m.providerId === p.id && m.available));
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
/** MICO360 AI: how long a model may be left out of its list before it counts as gone. */
export const MISSING_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Apply a provider's current model list: known models are marked available or not (and get the
 * provider's name for them unless an admin renamed them), new ones are added switched off with
 * what they can do. The first time a provider's list loads and none of its models is on, its
 * recommended chat model is switched on, so AI works right after connecting; after that the
 * admin's on/off choices are never changed. MICO360 AI's models left out of its list stay
 * available for MISSING_GRACE_MS (its list omits a busy node's models for a while).
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
  // MICO360 AI lists only the models of nodes accepting work right now: one left out may be on a busy
  // node, so it stays available for a while (the platform itself then answers with a substitute or a 503).
  const graceful = isMico360Provider(provider);
  const nowMs = Date.parse(meta.now);

  // Update availability of known models.
  let models = config.models.map((m) => {
    if (m.providerId !== providerId) return m;
    const r = remote.get(m.modelKey);
    const renamed = m.displayName !== m.modelKey && m.displayName !== friendlyModelName(m.modelKey);
    // b14: MICO360 AI's `created` is when the list was asked for, not the model's release: never kept.
    const { missingSince, created, ...rest } = m;
    const since = missingSince ?? meta.now;
    const presence = r || !graceful
      ? { available: Boolean(r) }
      : { available: m.available && !(nowMs - Date.parse(since) >= MISSING_GRACE_MS), missingSince: since };
    const release = graceful ? undefined : (created ?? r?.created);
    return {
      ...rest,
      ...presence,
      ...(r?.displayName && !renamed ? { displayName: r.displayName } : {}),
      ...(release !== undefined ? { created: release } : {}),
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
      ...(r.created !== undefined && !graceful ? { created: r.created } : {}),
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

/**
 * Models as "Automatic" ranks them. b14: a MICO360 AI model's `created` (saved by an older release) is
 * when its list was asked for, so it never decides between two models.
 */
function rankable(config: AiConfig, models: AiModel[]): AiModel[] {
  const mico = new Set(config.providers.filter((p) => isMico360Provider(p)).map((p) => p.id));
  return models.map((m) => (mico.has(m.providerId) && m.created !== undefined ? (({ created: _created, ...rest }) => rest)(m) : m));
}

/** What "Automatic" picks for each capability: the recommended model among the usable ones. */
export function automaticModels(config: AiConfig): Record<AiCapability, string | null> {
  const out = {} as Record<AiCapability, string | null>;
  for (const cap of AI_CAPABILITIES) out[cap] = pickRecommended(rankable(config, usableModels(config, cap)), cap);
  return out;
}

/** The model a capability really uses: the chosen default while it is usable, else the automatic choice. */
export function effectiveModel(config: AiConfig, capability: AiCapability): AiModel | null {
  const chosen = resolveDefaultModel(config, capability);
  if (chosen) return chosen;
  const id = pickRecommended(rankable(config, usableModels(config, capability)), capability);
  return id ? (config.models.find((m) => m.id === id) ?? null) : null;
}

// ── MICO360 AI: its platform's facts (the provider card) ──────────────────────
export interface PlatformFacts {
  version: string | null;
  commit: string | null;
  capabilities: string[] | null;
  concurrencyLimit: number | null;
}

function withPlatform(config: AiConfig, providerId: string, change: (p: ProviderPlatform) => ProviderPlatform): AiConfig {
  requireProvider(config, providerId);
  return { ...config, providers: config.providers.map((p) => (p.id === providerId ? { ...p, platform: change(p.platform ?? {}) } : p)) };
}

/**
 * b7, b11, b12: the facts just read; one that couldn't be read keeps the last one known. A model refresh
 * also forgets a strict-shape refusal (the safety net): the Connect may have been updated since.
 */
export function applyPlatform(config: AiConfig, providerId: string, facts: PlatformFacts, now: string): AiConfig {
  return withPlatform(config, providerId, (p) => {
    const next: ProviderPlatform = {
      ...p,
      version: facts.version ?? p.version ?? null,
      commit: facts.version ? facts.commit : (p.commit ?? null),
      capabilities: facts.capabilities ?? p.capabilities ?? null,
      concurrencyLimit: facts.concurrencyLimit ?? p.concurrencyLimit ?? null,
      checkedAt: now,
    };
    delete next.strictJsonRefused;
    return next;
  });
}

/** b5: another model answered — counted per pair, newest first, at most MAX_SUBSTITUTIONS. */
export function recordSubstitution(config: AiConfig, providerId: string, sub: { asked: string; answered: string }, now: string): AiConfig {
  const asked = sub.asked.slice(0, 200);
  const answered = sub.answered.slice(0, 200);
  return withPlatform(config, providerId, (p) => {
    const list = p.substitutions ?? [];
    const same = list.find((s) => s.asked === asked && s.answered === answered);
    const entry: PlatformSubstitution = same ? { ...same, count: same.count + 1, at: now } : { asked, answered, count: 1, firstAt: now, at: now };
    return { ...p, substitutions: [entry, ...list.filter((s) => s !== same)].slice(0, MAX_SUBSTITUTIONS) };
  });
}

/** b4: whole-document reading was refused (scans read as pictures instead), or (null) works again. */
export function recordOcrFallback(config: AiConfig, providerId: string, fallback: { status: number; reason: string | null } | null, now: string): AiConfig {
  return withPlatform(config, providerId, (p) => ({ ...p, ocrFallback: fallback ? { status: fallback.status, reason: fallback.reason?.slice(0, 300) ?? null, at: now } : null }));
}

/** Safety net: strict answer shapes were refused (status 400/422 and the Connect's reason), or (null) forgotten. */
export function recordStrictJsonRefusal(config: AiConfig, providerId: string, refusal: { status: number; reason: string | null } | null, now: string): AiConfig {
  return withPlatform(config, providerId, (p) => ({
    ...p,
    strictJsonRefused: refusal ? { status: refusal.status, reason: refusal.reason?.slice(0, 300) ?? null, at: now } : null,
  }));
}

/** Safety net: is this provider being asked in JSON mode rather than with a schema (a refusal under 24 hours old)? */
export function strictJsonPaused(provider: Pick<AiProvider, 'platform'>, nowMs: number): boolean {
  const at = Date.parse(provider.platform?.strictJsonRefused?.at ?? '');
  return Number.isFinite(at) && nowMs - at < STRICT_JSON_PAUSE_MS;
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
