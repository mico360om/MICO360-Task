import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { PortalService } from './portal-service';

// 1.23 security review: each portal write tells the team, so one client can't flood them.
describe('Client portal writes', () => {
  it('a client may send 20 a minute; the next is refused (429)', async () => {
    const tokenService = createTokenService({
      accessSecret: 'portal-a', refreshSecret: 'portal-r', accessTtl: 900, refreshTtl: 1000,
      refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
    });
    const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
    let comments = 0;
    const portal = { async comment() { comments++; return { ok: true }; } } as unknown as PortalService;
    const app = await buildApp({ authService, tokenService, portal });
    const authorization = `Bearer ${(await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] })).accessToken}`;
    const send = () => app.inject({ method: 'POST', url: '/api/v1/portal/projects/p1/tasks/t1/comments', headers: { authorization }, payload: { body: 'Hello' } });
    for (let i = 0; i < 20; i++) expect((await send()).statusCode).toBe(201);
    const over = await send();
    expect(over.statusCode).toBe(429);
    expect(comments).toBe(20);
    await app.close();
  });
});

// Owner, 10 Nov 2026: a client replies to a comment they can see.
describe('Client portal replies', () => {
  it('a reply names the comment it answers; anything else in the body is dropped', async () => {
    const tokenService = createTokenService({
      accessSecret: 'portal-a', refreshSecret: 'portal-r', accessTtl: 900, refreshTtl: 1000,
      refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
    });
    const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
    const calls: unknown[][] = [];
    const portal = { async comment(...a: unknown[]) { calls.push(a); return { ok: true }; } } as unknown as PortalService;
    const app = await buildApp({ authService, tokenService, portal });
    const authorization = `Bearer ${(await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] })).accessToken}`;
    const url = '/api/v1/portal/projects/p1/tasks/t1/comments';
    expect((await app.inject({ method: 'POST', url, headers: { authorization }, payload: { body: 'Thanks', replyTo: 'k9', clientVisible: true } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url, headers: { authorization }, payload: { body: 'Top' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url, headers: { authorization }, payload: { body: 'Bad', replyTo: 'x'.repeat(200) } })).statusCode).toBe(400);
    expect(calls.map((a) => [a[3], a[5]])).toEqual([['Thanks', 'k9'], ['Top', undefined]]);
    await app.close();
  });
});
