import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../lib/http-errors';
import type { AuditService } from '../audit/audit-service';
import type { AiConfigRepository } from './ai-config-repository';
import { fetchProviderModels } from './ai-provider-sync';
import * as ops from './ai-config';
import type {
  AiCapability,
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
}

/**
 * AI Management service (admin). Persists the AI config, applies every change
 * dynamically (read from the store per request — no restart), keeps API keys
 * out of responses, and writes an audit entry for every mutation.
 */
export function createAiConfigService({
  repo,
  audit,
  genId = () => randomUUID(),
  now = () => new Date().toISOString(),
  fetchImpl = fetch,
}: AiConfigServiceDeps) {
  const meta = () => ({ id: genId(), now: now() });

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
    const { config, provider } = ops.addProvider(await repo.load(), input, meta());
    await repo.save(config);
    await log(actor, 'ai.provider.create', provider.id, { name: provider.name, kind: provider.kind, apiBaseUrl: provider.apiBaseUrl });
    return ops.redactConfig(config);
  }
  async function updateProvider(id: string, patch: ProviderPatch, actor?: AiActor) {
    const config = ops.updateProvider(await repo.load(), id, patch, now());
    await repo.save(config);
    await log(actor, 'ai.provider.update', id, { ...patch, apiKey: patch.apiKey ? '***' : undefined });
    return ops.redactConfig(config);
  }
  async function removeProvider(id: string, actor?: AiActor) {
    const config = ops.removeProvider(await repo.load(), id);
    await repo.save(config);
    await log(actor, 'ai.provider.delete', id);
    return ops.redactConfig(config);
  }

  // Models
  async function addModel(input: ModelInput, actor?: AiActor) {
    const { config, model } = ops.addModel(await repo.load(), input, meta());
    await repo.save(config);
    await log(actor, 'ai.model.create', model.id, { modelKey: model.modelKey, capabilities: model.capabilities });
    return ops.redactConfig(config);
  }
  async function updateModel(id: string, patch: ModelPatch, actor?: AiActor) {
    const config = ops.updateModel(await repo.load(), id, patch, now());
    await repo.save(config);
    await log(actor, 'ai.model.update', id, patch);
    return ops.redactConfig(config);
  }
  async function setModelEnabled(id: string, enabled: boolean, actor?: AiActor) {
    const config = ops.updateModel(await repo.load(), id, { enabled }, now());
    await repo.save(config);
    await log(actor, enabled ? 'ai.model.enable' : 'ai.model.disable', id);
    return ops.redactConfig(config);
  }
  async function removeModel(id: string, actor?: AiActor) {
    const config = ops.removeModel(await repo.load(), id);
    await repo.save(config);
    await log(actor, 'ai.model.delete', id);
    return ops.redactConfig(config);
  }

  // Defaults
  async function setDefault(capability: string, modelId: string | null, actor?: AiActor) {
    const config = ops.setDefault(await repo.load(), capability, modelId, now());
    await repo.save(config);
    await log(actor, 'ai.default.set', capability, { capability, modelId });
    return ops.redactConfig(config);
  }

  // Sync / auto-detect
  async function syncProvider(id: string, actor?: AiActor) {
    const config0 = await repo.load();
    const provider = config0.providers.find((p) => p.id === id);
    if (!provider) throw new NotFoundError('AI provider not found.');
    const keys = await fetchProviderModels(provider, fetchImpl);
    const before = config0.models.filter((m) => m.providerId === id).length;
    const config = ops.applySync(config0, id, keys, meta());
    await repo.save(config);
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
