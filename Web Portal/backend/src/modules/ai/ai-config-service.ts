import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { AuditService } from '../audit/audit-service';
import type { AiConfigRepository } from './ai-config-repository';
import { fetchProviderModels, ProviderHttpError } from './ai-provider-sync';
import { complete, ProviderRefusedError } from './ai-completion';
import { createSafeFetch } from './ai-network';
import type { RemoteModel } from './ai-model-catalog';
import * as ops from './ai-config';
import type {
  AiCapability,
  AiConfig,
  AiProvider,
  Meta,
  ModelInput,
  ModelPatch,
  ProviderInput,
  ProviderPatch,
  RedactedConfig,
} from './ai-config';

export interface AiActor {
  userId?: string | null;
  ip?: string | null;
}

export interface AiConfigServiceDeps {
  repo: AiConfigRepository;
  audit: AuditService;
  genId?: () => string;
  now?: () => string;
  fetchImpl?: typeof fetch;
  /** Allow provider URLs on private / internal hosts (e.g. a local Ollama). Default false. */
  allowPrivateHosts?: boolean;
}

/** How old a provider's model list may get before the regular refresh loads it again. */
export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The outcome of asking a provider for its models. */
type Listing = { ok: true; models: RemoteModel[] } | { ok: false; error: ValidationError; keyRefused: boolean };

/** The outcome of a model test: it answered (and how fast), or why not. */
export type ModelTestResult = { ok: true; ms: number; reply: string } | { ok: false; message: string };

/**
 * AI Management service (admin). Persists the AI config, applies every change
 * dynamically (read from the store per request — no restart), keeps API keys
 * out of responses, and writes an audit entry for every mutation. Every change is an
 * atomic read-modify-write, so concurrent admin edits don't overwrite each other.
 * A provider's model list loads when it is connected or its key or address changes, and
 * again once a day (refreshDueProviders), so nobody has to type model names.
 */
export function createAiConfigService({
  repo,
  audit,
  genId = () => randomUUID(),
  now = () => new Date().toISOString(),
  fetchImpl,
  allowPrivateHosts = false,
}: AiConfigServiceDeps) {
  const meta = () => ({ id: genId(), now: now() });
  const policy = { allowPrivateHosts };
  const providerFetch = fetchImpl ?? createSafeFetch({ allowPrivateHosts });

  async function log(actor: AiActor | undefined, action: string, entityId: string | null, newValue?: unknown) {
    await audit.record({
      userId: actor?.userId ?? null,
      action,
      module: 'ai',
      entityId,
      newValue,
      ip: actor?.ip ?? null,
    });
  }

  /** Apply `change` atomically; it returns the next config plus anything the caller needs. */
  async function mutate<T>(change: (config: AiConfig) => { config: AiConfig; result: T }): Promise<{ config: AiConfig; result: T }> {
    let result!: T;
    const config = await repo.update((current) => {
      const out = change(current);
      result = out.result;
      return out.config;
    });
    return { config, result };
  }

  /** Ask a provider for its models. Network and provider problems become a failed listing, not an error. */
  async function list(provider: Pick<AiProvider, 'kind' | 'apiBaseUrl' | 'apiKey'>): Promise<Listing> {
    try {
      return { ok: true, models: await fetchProviderModels(provider, providerFetch, { allowPrivateHosts }) };
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return { ok: false, error: err, keyRefused: err instanceof ProviderHttpError && (err.providerStatus === 401 || err.providerStatus === 403) };
    }
  }
  function applyListing(config: AiConfig, providerId: string, listing: Listing, m: Meta): AiConfig {
    return listing.ok ? ops.applySync(config, providerId, listing.models, m) : ops.recordSyncFailure(config, providerId, listing.error.message, m.now);
  }

  // Reads
  async function getConfig(): Promise<RedactedConfig> {
    return ops.redactConfig(await repo.load());
  }
  /** Consumer view — only enabled + available models (disabled/unavailable hidden). */
  async function getUsableModels(capability?: string) {
    return ops.usableModels(await repo.load(), capability);
  }

  // Providers
  /**
   * Connect a provider and load its models. A key the provider refuses is not saved; a list that
   * can't be loaded for another reason (the service is down, no model list) is noted on the
   * provider, which is saved so models can still be added by name.
   */
  async function addProvider(input: ProviderInput, actor?: AiActor) {
    const m = meta();
    const draft = ops.addProvider(ops.emptyConfig(), input, m, policy).provider; // checks the input first
    const listing = await list(draft);
    if (!listing.ok && listing.keyRefused) throw listing.error;
    const { config, result: provider } = await mutate((c) => {
      const out = ops.addProvider(c, input, m, policy);
      return { config: applyListing(out.config, out.provider.id, listing, m), result: out.provider };
    });
    await log(actor, 'ai.provider.create', provider.id, {
      name: provider.name,
      kind: provider.kind,
      preset: provider.preset,
      apiBaseUrl: provider.apiBaseUrl,
      models: listing.ok ? listing.models.length : null,
    });
    return ops.redactConfig(config);
  }
  /** Change a provider. A new key or address loads the models again, and a refused key is not saved. */
  async function updateProvider(id: string, patch: ProviderPatch, actor?: AiActor) {
    let listing: Listing | null = null;
    if (patch.apiKey || patch.apiBaseUrl !== undefined) {
      const candidate = ops.updateProvider(await repo.load(), id, patch, now(), policy).providers.find((p) => p.id === id)!;
      listing = await list(candidate);
      if (!listing.ok && listing.keyRefused) throw listing.error;
    }
    const m = listing ? meta() : null;
    const { config } = await mutate((c) => {
      const next = ops.updateProvider(c, id, patch, now(), policy);
      return { config: listing && m ? applyListing(next, id, listing, m) : next, result: null };
    });
    await log(actor, 'ai.provider.update', id, { ...patch, apiKey: patch.apiKey ? '***' : undefined });
    return ops.redactConfig(config);
  }
  async function removeProvider(id: string, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.removeProvider(c, id), result: null }));
    await log(actor, 'ai.provider.delete', id);
    return ops.redactConfig(config);
  }

  // Models
  async function addModel(input: ModelInput, actor?: AiActor) {
    const { config, result: model } = await mutate((c) => {
      const out = ops.addModel(c, input, meta());
      return { config: out.config, result: out.model };
    });
    await log(actor, 'ai.model.create', model.id, { modelKey: model.modelKey, capabilities: model.capabilities });
    return ops.redactConfig(config);
  }
  async function updateModel(id: string, patch: ModelPatch, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.updateModel(c, id, patch, now()), result: null }));
    await log(actor, 'ai.model.update', id, patch);
    return ops.redactConfig(config);
  }
  async function setModelEnabled(id: string, enabled: boolean, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.updateModel(c, id, { enabled }, now()), result: null }));
    await log(actor, enabled ? 'ai.model.enable' : 'ai.model.disable', id);
    return ops.redactConfig(config);
  }
  async function removeModel(id: string, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.removeModel(c, id), result: null }));
    await log(actor, 'ai.model.delete', id);
    return ops.redactConfig(config);
  }

  /** Send a model a tiny prompt, so an admin can see it works before people use it (switched on or not). */
  async function testModel(id: string): Promise<ModelTestResult> {
    const config = await repo.load();
    const model = config.models.find((m) => m.id === id);
    if (!model) throw new NotFoundError('AI model not found.');
    if (!model.capabilities.includes('chat')) throw new ValidationError('Only chat models can be tested here.');
    const provider = config.providers.find((p) => p.id === model.providerId);
    if (!provider) throw new NotFoundError('AI provider not found.');
    const started = Date.now();
    try {
      const reply = await complete(
        { provider, modelKey: model.modelKey, parameters: model.parameters },
        { system: 'Reply with the single word OK.', prompt: 'Are you there?', maxTokens: 16 },
        providerFetch,
        { timeoutMs: 60_000, allowPrivateHosts },
      );
      return { ok: true, ms: Date.now() - started, reply: reply.slice(0, 80) };
    } catch (err) {
      if (err instanceof ProviderRefusedError) return { ok: false, message: `HTTP ${err.providerStatus}${err.detail ? `: ${err.detail}` : ''}` };
      if (err instanceof ValidationError) return { ok: false, message: err.message };
      throw err;
    }
  }

  // Defaults
  async function setDefault(capability: string, modelId: string | null, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.setDefault(c, capability, modelId, now()), result: null }));
    await log(actor, 'ai.default.set', capability, { capability, modelId });
    return ops.redactConfig(config);
  }

  // Sync / auto-detect
  /** Load a provider's models again. A failure is noted on the provider and reported. */
  async function syncProvider(id: string, actor?: AiActor) {
    const provider = (await repo.load()).providers.find((p) => p.id === id);
    if (!provider) throw new NotFoundError('AI provider not found.');
    // The network call happens outside the update: the result is applied to the LATEST config,
    // so edits made while the provider was answering aren't lost.
    const listing = await list(provider);
    const m = meta();
    const { config, result: before } = await mutate((c) => ({
      config: applyListing(c, id, listing, m),
      result: c.models.filter((x) => x.providerId === id).length,
    }));
    if (!listing.ok) {
      await log(actor, 'ai.provider.sync', id, { error: listing.error.message });
      throw listing.error;
    }
    const after = config.models.filter((x) => x.providerId === id).length;
    const result = { detected: listing.models.length, added: after - before };
    await log(actor, 'ai.provider.sync', id, result);
    return { ...result, config: ops.redactConfig(config) };
  }

  /** Reload the model list of every switched-on provider not checked in the last day (the regular job). */
  async function refreshDueProviders(): Promise<{ refreshed: number; failed: number }> {
    const at = Date.parse(now());
    const due = (await repo.load()).providers.filter(
      (p) => p.enabled && (!p.lastSyncAttemptAt || at - Date.parse(p.lastSyncAttemptAt) >= MODEL_LIST_MAX_AGE_MS),
    );
    let refreshed = 0;
    let failed = 0;
    for (const p of due) {
      try {
        await syncProvider(p.id);
        refreshed++;
      } catch {
        failed++; // noted on the provider; the others still run
      }
    }
    return { refreshed, failed };
  }

  return {
    getConfig,
    getUsableModels,
    addProvider,
    updateProvider,
    removeProvider,
    addModel,
    updateModel,
    setModelEnabled,
    removeModel,
    testModel,
    setDefault,
    syncProvider,
    refreshDueProviders,
  };
}

export type AiConfigService = ReturnType<typeof createAiConfigService>;
export type { AiCapability };
