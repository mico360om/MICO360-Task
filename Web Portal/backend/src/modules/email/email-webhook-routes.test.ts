import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createEmailWebhookService } from './email-webhook-service';
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
      payload: [{ event: 'bounce', email: 'a@x.com', MessageID: 1 }, { event: 'spam', email: 'b@x.com' }],
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
    const { app } = await makeApp('secret123');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet?token=wrong', payload: [] });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/api/v1/webhooks/mailjet?token=secret123', payload: [] });
    expect(good.statusCode).toBe(200);
  });
});
