import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { loadReleaseFile, makeReleaseFile } from './build-info';

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-11-02

### New features
- Version history.
### Security
- Sign-in codes expire sooner.

## [1.0.0] - 2026-10-16

### Security
- Stronger passwords.
`;

describe('makeReleaseFile', () => {
  it('records the version, when it was built and the code revision, with the parsed changelog', () => {
    const file = makeReleaseFile({ version: '1.1.0', changelogMd: CHANGELOG, now: new Date('2026-11-02T15:30:00.000Z'), commit: 'abc1234' });
    expect(file.build).toEqual({ version: '1.1.0', builtAt: '2026-11-02T15:30:00.000Z', commit: 'abc1234' });
    expect(file.releases.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
  });

  it('refuses to build a version the changelog doesn’t describe, or a broken changelog', () => {
    expect(() => makeReleaseFile({ version: '1.2.0', changelogMd: CHANGELOG, now: new Date(), commit: null })).toThrow(/1\.2\.0.*CHANGELOG/);
    expect(() => makeReleaseFile({ version: '1.0.0', changelogMd: '# Changelog\n\n## [1.0] - x\n', now: new Date(), commit: null })).toThrow(/not a version/);
  });
});

describe('loadReleaseFile', () => {
  it('reads the build’s file, or says it is a development run without one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
    const file = path.join(dir, 'release.json');
    const fallback = { version: '1.1.0', startedAt: new Date('2026-11-03T08:00:00.000Z') };
    expect(loadReleaseFile(file, fallback)).toEqual({ source: 'development', build: { version: '1.1.0', builtAt: '2026-11-03T08:00:00.000Z', commit: null }, releases: [] });
    fs.writeFileSync(file, JSON.stringify(makeReleaseFile({ version: '1.1.0', changelogMd: CHANGELOG, now: new Date('2026-11-02T15:30:00.000Z'), commit: null })));
    expect(loadReleaseFile(file, fallback)).toMatchObject({ source: 'build', build: { builtAt: '2026-11-02T15:30:00.000Z' } });
  });
});

describe('version and release routes', () => {
  const tokenService = createTokenService({
    accessSecret: 'about-access',
    refreshSecret: 'about-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const release = { source: 'build' as const, ...makeReleaseFile({ version: '1.1.0', changelogMd: CHANGELOG, now: new Date('2026-11-02T15:30:00.000Z'), commit: 'abc1234' }) };

  async function setup() {
    const app = await buildApp({ authService, tokenService, about: { release } });
    const as = async (roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles })).accessToken}` });
    return { app, as };
  }

  it('tells a signed-in user the deployed version and when it was deployed — and nobody else', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/version' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/v1/version', headers: await as(['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ version: '1.1.0', deployedAt: '2026-11-02T15:30:00.000Z' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('gives an admin the technical details too', async () => {
    const { app, as } = await setup();
    const data = (await app.inject({ method: 'GET', url: '/api/v1/version', headers: await as(['ADMIN']) })).json().data;
    expect(data).toMatchObject({ version: '1.1.0', deployedAt: '2026-11-02T15:30:00.000Z', commit: 'abc1234', source: 'build', nodeVersion: process.version });
    expect(typeof data.uptimeSeconds).toBe('number');
  });

  it('lists the releases; security fixes only for admins, others just learn there were some', async () => {
    const { app, as } = await setup();
    const user = (await app.inject({ method: 'GET', url: '/api/v1/releases', headers: await as(['EMPLOYEE']) })).json().data;
    expect(user[0]).toEqual({ version: '1.1.0', date: '2026-11-02', sections: { features: ['Version history.'], improvements: [], fixes: [] }, securityUpdates: true });
    expect(user[1]).toEqual({ version: '1.0.0', date: '2026-10-16', sections: { features: [], improvements: [], fixes: [] }, securityUpdates: true });
    expect(JSON.stringify(user)).not.toContain('Stronger passwords');
    const admin = (await app.inject({ method: 'GET', url: '/api/v1/releases', headers: await as(['ADMIN']) })).json().data;
    expect(admin[0].sections.security).toEqual(['Sign-in codes expire sooner.']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/releases' })).statusCode).toBe(401);
  });
});
