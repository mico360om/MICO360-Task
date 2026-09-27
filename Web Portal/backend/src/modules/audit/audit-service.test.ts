import { describe, it, expect } from 'vitest';
import { createAuditService, redactSecrets, REDACTED } from './audit-service';
import { createMemoryAuditRepository } from './audit-repository';

describe('AuditService', () => {
  it('records an audit entry and lists it (newest first)', async () => {
    let t = Date.parse('2026-09-26T08:00:00Z');
    const svc = createAuditService({ audit: createMemoryAuditRepository(() => new Date((t += 1000))) });
    await svc.record({ userId: 'admin', action: 'USER_CREATED', module: 'users', entityId: 'u9' });
    await svc.record({ userId: 'admin', action: 'PROJECT_CREATED', module: 'projects', entityId: 'p1' });
    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.action).toBe('PROJECT_CREATED');
  });

  it('masks secrets before storing and again when listing', async () => {
    const repo = createMemoryAuditRepository();
    const svc = createAuditService({ audit: repo });
    await svc.record({ action: 'x', module: 'm', newValue: { name: 'OpenAI', apiKey: 'sk-live-1' } });
    expect(JSON.stringify(repo.rows)).not.toContain('sk-live-1');
    // An entry written before masking existed is still masked on the way out.
    repo.rows.push({ ...repo.rows[0]!, id: 'legacy', newValue: { password: 'hunter2', nested: [{ refreshToken: 'rt' }] } });
    expect(JSON.stringify(await svc.list())).not.toMatch(/hunter2|"rt"/);
  });
});

describe('redactSecrets', () => {
  it('masks credential fields at any depth and leaves the rest', () => {
    expect(
      redactSecrets({ email: 'a@x.co', password: 'p', apiKey: 'k', api_key: 'k', secretKey: 's', key: 'k', token: 't', modelKey: 'gpt-4o', list: [{ accessToken: 'a' }] }),
    ).toEqual({ email: 'a@x.co', password: REDACTED, apiKey: REDACTED, api_key: REDACTED, secretKey: REDACTED, key: REDACTED, token: REDACTED, modelKey: 'gpt-4o', list: [{ accessToken: REDACTED }] });
  });

  it('passes through primitives and empty values', () => {
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(['TODO'])).toEqual(['TODO']);
    expect(redactSecrets({ apiKey: '' })).toEqual({ apiKey: '' });
    expect(redactSecrets(null)).toBeNull();
  });
});
