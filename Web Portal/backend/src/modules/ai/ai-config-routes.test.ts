import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createAiConfigService } from './ai-config-service';
import { createMemoryAiConfigRepository } from './ai-config-repository';

const tokenService = createTokenService({
  accessSecret: 'ai-access',
  refreshSecret: 'ai-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const noAudit = { async record() { return {} as never; }, async list() { return [] as never; } };

async function makeApp() {
  let seq = 0;
  const aiConfigService = createAiConfigService({
    repo: createMemoryAiConfigRepository(),
    audit: noAudit,
    genId: () => `id${++seq}`,
    now: () => '2026-09-08T00:00:00.000Z',
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, aiConfigService });
}

const auth = async (roles: string[]) => ({
  authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles })).accessToken}`,
});

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('AI routes — authorization', () => {
  it('blocks a non-admin from the AI config (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/config', headers: await auth(['EMPLOYEE']) });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a non-admin from creating a provider (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/providers',
      headers: await auth(['EMPLOYEE']),
      payload: { name: 'x', kind: 'openai', apiBaseUrl: 'https://x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication for the consumer model list (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/models' });
    expect(res.statusCode).toBe(401);
  });
});

describe('AI routes — admin management', () => {
  it('lets an admin add a provider + model, and never returns the API key', async () => {
    const admin = await auth(['ADMIN']);
    const p = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/providers',
      headers: admin,
      payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-9999' },
    });
    expect(p.statusCode).toBe(200);
    const provider = p.json().data.providers[0];
    expect(provider).not.toHaveProperty('apiKey');
    expect(provider.hasApiKey).toBe(true);

    const m = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/models',
      headers: admin,
      payload: { providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat', 'vision'] },
    });
    expect(m.statusCode).toBe(200);
    expect(m.json().data.models[0].modelKey).toBe('gpt-4o');
  });

  it('sets a default model for a capability', async () => {
    const admin = await auth(['ADMIN']);
    await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1' } });
    await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: admin, payload: { providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] } });
    const res = await app.inject({ method: 'PUT', url: '/api/v1/ai/defaults/chat', headers: admin, payload: { modelId: 'id2' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.defaults.chat).toBe('id2');
  });

  it('hides disabled models from the consumer /ai/models endpoint', async () => {
    const admin = await auth(['ADMIN']);
    await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1' } });
    await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: admin, payload: { providerId: 'id1', modelKey: 'gpt-4o', capabilities: ['chat'] } });
    await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: admin, payload: { providerId: 'id1', modelKey: 'gpt-3.5', capabilities: ['chat'], enabled: false } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/models?capability=chat', headers: await auth(['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((m: { modelKey: string }) => m.modelKey)).toEqual(['gpt-4o']);
  });
});
