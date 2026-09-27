import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../lib/http-errors';
import type { AuditService } from '../audit/audit-service';
import type { AiConfigRepository } from './ai-config-repository';
import { fetchProviderModels } from './ai-provider-sync';
import { createSafeFetch } from './ai-network';
import * as ops from './ai-config';
import type {
  AiCapability,
  AiConfig,
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

/**
 * AI Management service (admin). Persists the AI config, applies every change
 * dynamically (read from the store per request — no restart), keeps API keys
 * out of responses, and writes an audit entry for every mutation. Every change is an
 * atomic read-modify-write, so concurrent admin edits don't overwrite each other.
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

  // Reads
  async function getConfig(): Promise<RedactedConfig> {
    return ops.redactConfig(await repo.load());
  }
  /** Consumer view — only enabled + available models (disabled/unavailable hidden). */
  async function getUsableModels(capability?: string) {
    return ops.usableModels(await repo.load(), capability);
  }

  // Providers
  async function addProvider(input: ProviderInput, actor?: AiActor) {
    const { config, result: provider } = await mutate((c) => {
      const out = ops.addProvider(c, input, meta(), policy);
      return { config: out.config, result: out.provider };
    });
    await log(actor, 'ai.provider.create', provider.id, { name: provider.name, kind: provider.kind, apiBaseUrl: provider.apiBaseUrl });
    return ops.redactConfig(config);
  }
  async function updateProvider(id: string, patch: ProviderPatch, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.updateProvider(c, id, patch, now(), policy), result: null }));
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

  // Defaults
  async function setDefault(capability: string, modelId: string | null, actor?: AiActor) {
    const { config } = await mutate((c) => ({ config: ops.setDefault(c, capability, modelId, now()), result: null }));
    await log(actor, 'ai.default.set', capability, { capability, modelId });
    return ops.redactConfig(config);
  }

  // Sync / auto-detect
  async function syncProvider(id: string, actor?: AiActor) {
    const provider = (await repo.load()).providers.find((p) => p.id === id);
    if (!provider) throw new NotFoundError('AI provider not found.');
    // The network call happens outside the update: the result is applied to the LATEST config,
    // so edits made while the provider was answering aren't lost.
    const keys = await fetchProviderModels(provider, providerFetch, { allowPrivateHosts });
    const { config, result: before } = await mutate((c) => ({
      config: ops.applySync(c, id, keys, meta()),
      result: c.models.filter((m) => m.providerId === id).length,
    }));
    const after = config.models.filter((m) => m.providerId === id).length;
    const result = { detected: keys.length, added: after - before };
    await log(actor, 'ai.provider.sync', id, result);
    return { ...result, config: ops.redactConfig(config) };
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
    setDefault,
    syncProvider,
  };
}

export type AiConfigService = ReturnType<typeof createAiConfigService>;
export type { AiCapability };
