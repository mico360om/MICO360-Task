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

const noAudit = { async record() { return {} as never; }, async list() { return [] as never; }, async modules() { return []; } };

/** A stand-in provider: an empty model list, and "OK" to any chat request. */
const fakeProvider = (async (url: string) =>
  new Response(JSON.stringify(String(url).includes('/chat/completions') ? { choices: [{ message: { content: 'OK' } }] } : { data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

async function makeApp() {
  let seq = 0;
  const aiConfigService = createAiConfigService({
    repo: createMemoryAiConfigRepository(),
    audit: noAudit,
    genId: () => `id${++seq}`,
    now: () => '2026-09-08T00:00:00.000Z',
    fetchImpl: fakeProvider,
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

  it('blocks a non-admin from testing a model (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/models/id2/test', headers: await auth(['EMPLOYEE']) });
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

describe('AI routes — presets and model tests', () => {
  it('keeps the preset a provider was connected from, and refuses an unknown one', async () => {
    const admin = await auth(['ADMIN']);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'Groq', kind: 'custom', preset: 'groq', apiBaseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.providers[0].preset).toBe('groq');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'X', kind: 'custom', preset: 'nope', apiBaseUrl: 'https://x.test' } });
    expect(bad.statusCode).toBe(400);
  });

  it('lets an admin test a chat model', async () => {
    const admin = await auth(['ADMIN']);
    await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' } });
    await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: admin, payload: { providerId: 'id1', modelKey: 'gpt-4o-mini', capabilities: ['chat'] } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/ai/models/id2/test', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ ok: true, reply: 'OK' });
  });

  it('shows admins which model "Automatic" stands for', async () => {
    const admin = await auth(['ADMIN']);
    await app.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: admin, payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k' } });
    await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: admin, payload: { providerId: 'id1', modelKey: 'gpt-4o-mini', capabilities: ['chat'] } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/config', headers: admin });
    expect(res.json().data.automatic.chat).toBe('id2');
  });
});

describe('AI routes — a provider refusing the key', () => {
  it('answers 400, not 401 (which the web app would take for an expired session)', async () => {
    const refusing = createAiConfigService({
      repo: createMemoryAiConfigRepository(),
      audit: noAudit,
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'no' }), { status: 401 })) as unknown as typeof fetch,
    });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const app2 = await buildApp({ authService, tokenService, aiConfigService: refusing });
    const res = await app2.inject({ method: 'POST', url: '/api/v1/ai/providers', headers: await auth(['ADMIN']), payload: { name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'bad' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/did not accept the API key/);
  });
});
