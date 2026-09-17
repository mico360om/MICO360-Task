import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AiConfigService } from './ai-config-service';
import { AI_CAPABILITIES, PROVIDER_KINDS } from './ai-config';

export interface AiRouteDeps {
  aiConfigService: AiConfigService;
  guard: AuthGuard;
}

const capability = z.enum(AI_CAPABILITIES);
const providerCreate = z.object({
  name: z.string().min(1),
  kind: z.enum(PROVIDER_KINDS),
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});
const providerUpdate = z.object({
  name: z.string().min(1).optional(),
  apiBaseUrl: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});
const parameters = z.record(z.unknown());
const modelCreate = z.object({
  providerId: z.string().min(1),
  modelKey: z.string().min(1),
  displayName: z.string().optional(),
  capabilities: z.array(capability).min(1),
  parameters: parameters.optional(),
  concurrencyLimit: z.number().optional(),
  enabled: z.boolean().optional(),
});
const modelUpdate = z.object({
  displayName: z.string().optional(),
  capabilities: z.array(capability).min(1).optional(),
  parameters: parameters.optional(),
  concurrencyLimit: z.number().optional(),
  enabled: z.boolean().optional(),
});
const defaultBody = z.object({ modelId: z.string().nullable() });

function actorOf(req: FastifyRequest) {
  return { userId: req.user?.id ?? null, ip: req.ip ?? null };
}

export async function registerAiRoutes(app: FastifyInstance, deps: AiRouteDeps): Promise<void> {
  const { aiConfigService: svc, guard } = deps;
  const admin = { preHandler: guard.requireRoles('ADMIN') };

  // ── Admin: full config (keys redacted) ──────────────────────────────────────
  app.get('/ai/config', admin, async () => ({ data: await svc.getConfig() }));

  // ── Admin: providers ────────────────────────────────────────────────────────
  app.post('/ai/providers', admin, async (req) => ({ data: await svc.addProvider(providerCreate.parse(req.body), actorOf(req)) }));
  app.put('/ai/providers/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await svc.updateProvider(id, providerUpdate.parse(req.body), actorOf(req)) };
  });
  app.delete('/ai/providers/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await svc.removeProvider(id, actorOf(req)) };
  });
  app.post('/ai/providers/:id/sync', admin, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await svc.syncProvider(id, actorOf(req)) };
  });

  // ── Admin: models ───────────────────────────────────────────────────────────
  app.post('/ai/models', admin, async (req) => ({ data: await svc.addModel(modelCreate.parse(req.body), actorOf(req)) }));
  app.put('/ai/models/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await svc.updateModel(id, modelUpdate.parse(req.body), actorOf(req)) };
  });
  app.patch('/ai/models/:id/enabled', admin, async (req) => {
    const { id } = req.params as { id: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    return { data: await svc.setModelEnabled(id, enabled, actorOf(req)) };
  });
  app.delete('/ai/models/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await svc.removeModel(id, actorOf(req)) };
  });

  // ── Admin: defaults per capability ──────────────────────────────────────────
  app.put('/ai/defaults/:capability', admin, async (req) => {
    const cap = capability.parse((req.params as { capability: string }).capability);
    const { modelId } = defaultBody.parse(req.body);
    return { data: await svc.setDefault(cap, modelId, actorOf(req)) };
  });

  // ── Consumer: usable models only (disabled/unavailable are hidden) ──────────
  app.get('/ai/models', { preHandler: guard.authenticate }, async (req) => {
    const cap = (req.query as { capability?: string }).capability;
    return { data: await svc.getUsableModels(cap) };
  });
}
