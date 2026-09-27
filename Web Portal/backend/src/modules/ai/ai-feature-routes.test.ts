import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createAiFeatureService } from './ai-feature-service';
import { createMemoryAiConfigRepository } from './ai-config-repository';
import type { AiConfig } from './ai-config';

const tokenService = createTokenService({
  accessSecret: 'aif-access',
  refreshSecret: 'aif-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const config: AiConfig = {
  providers: [{ id: 'pr1', name: 'OpenAI', kind: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', enabled: true, createdAt: '', updatedAt: '' }],
  models: [{ id: 'm1', providerId: 'pr1', modelKey: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['chat'], parameters: {}, concurrencyLimit: 4, enabled: true, available: true, createdAt: '', updatedAt: '' }],
  defaults: { chat: 'm1' },
};

async function makeApp() {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '["a","b","c"]' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const aiFeatureService = createAiFeatureService({ repo: createMemoryAiConfigRepository(config), fetchImpl, limits: { perMinute: 2, perDay: 50 } });
  const app = await buildApp({ authService, tokenService, aiFeatureService });
  const headers = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken}` };
  return { app, headers, calls: () => calls };
}

describe('AI feature routes', () => {
  it('rejects oversized input before calling the provider (400)', async () => {
    const { app, headers, calls } = await makeApp();
    const big = await app.inject({ method: 'POST', url: '/api/v1/ai/parse-task', headers, payload: { text: 'x'.repeat(5000) } });
    expect(big.statusCode).toBe(400);
    const many = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summary',
      headers,
      payload: { name: 'P', stats: { total: 1, completed: 0, inProgress: 0, overdue: 0 }, sampleTitles: Array.from({ length: 100 }, () => 't') },
    });
    expect(many.statusCode).toBe(400);
    expect(calls()).toBe(0);
    await app.close();
  });

  it('rate-limits each signed-in user (429 AI_RATE_LIMITED)', async () => {
    const { app, headers } = await makeApp();
    const breakdown = () => app.inject({ method: 'POST', url: '/api/v1/ai/breakdown', headers, payload: { title: 'Monthly report' } });
    expect((await breakdown()).statusCode).toBe(200);
    expect((await breakdown()).statusCode).toBe(200);
    const third = await breakdown();
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('AI_RATE_LIMITED');
    await app.close();
  });

  it('requires authentication (401)', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/breakdown', payload: { title: 'x' } })).statusCode).toBe(401);
    await app.close();
  });
});
