import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../../app';
import { createEmailWebhookService } from './email-webhook-service';
import { registerEmailWebhookRoutes, tokensMatch } from './email-webhook-routes';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

const tokenService = createTokenService({ accessSecret: 'wh-a', refreshSecret: 'wh-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

function makeApp(token?: string) {
  const recorded: unknown[] = [];
  const emailWebhookService = createEmailWebhookService({ store: { async record(e) { recorded.push(e); } } });
  return buildApp({ authService, tokenService, emailWebhookService, mailjetWebhookToken: token }).then((app) => ({ app, recorded }));
}

describe('Mailjet webhook route', () => {
  it('records posted events (accepts an array)', async () => {
    const { app, recorded } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/mailjet',
      payload: [{ event: 'bounce', email: 'a@x.com', MessageID: 1, hard_bounce: true }, { event: 'spam', email: 'b@x.com' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recorded).toBe(2);
    expect(recorded).toHaveLength(2);
  });

  it('accepts a single event object', async () => {
    const { app, recorded } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet', payload: { event: 'sent', email: 'a@x.com' } });
    expect(res.statusCode).toBe(200);
    expect(recorded).toHaveLength(1);
  });

  it('rejects a bad token when one is configured (401)', async () => {
    const { app, recorded } = await makeApp('secret123');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet?token=wrong', payload: [{ event: 'spam', email: 'x@y.z' }] });
    expect(bad.statusCode).toBe(401);
    const missing = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet', payload: [{ event: 'spam', email: 'x@y.z' }] });
    expect(missing.statusCode).toBe(401);
    expect(recorded).toHaveLength(0);
    const good = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet?token=secret123', payload: [] });
    expect(good.statusCode).toBe(200);
  });

  it('accepts the token as the HTTP Basic password (Mailjet URL credentials)', async () => {
    const { app } = await makeApp('secret123');
    const auth = `Basic ${Buffer.from('mailjet:secret123').toString('base64')}`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet', headers: { authorization: auth }, payload: [] });
    expect(res.statusCode).toBe(200);
  });

  it('refuses every event when a token is required but not configured (production)', async () => {
    const recorded: unknown[] = [];
    const app = Fastify();
    await registerEmailWebhookRoutes(app, {
      emailWebhookService: createEmailWebhookService({ store: { async record(e) { recorded.push(e); } } }),
      requireToken: true,
    });
    const res = await app.inject({ method: 'POST', url: '/webhooks/mailjet', payload: [{ event: 'bounce', email: 'ceo@x.com', hard_bounce: true }] });
    expect(res.statusCode).toBe(503);
    expect(recorded).toHaveLength(0);
    await app.close();
  });
});

describe('tokensMatch', () => {
  it('compares tokens of any length', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
    expect(tokensMatch('', 'abc')).toBe(false);
  });
});
