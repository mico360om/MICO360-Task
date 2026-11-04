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

describe('AuditService: a task’s entries name the task (1.22.3)', () => {
  it('adds the task’s current number and title to entries about a task (one lookup per page); none for anything else', async () => {
    const repo = createMemoryAuditRepository();
    const asked: string[][] = [];
    const svc = createAuditService({
      audit: repo,
      tasks: async (ids) => {
        asked.push([...ids]);
        return [{ id: 't1', key: 'MICO-142', title: 'Fix the pump' }];
      },
    });
    await svc.record({ action: 'task.approve', module: 'tasks', entityId: 't1', newValue: { key: 'RIG-4' } });
    await svc.record({ action: 'client-view.task.shown', module: 'client-view', entityId: 't1' });
    await svc.record({ action: 'USER_CREATED', module: 'users', entityId: 'u9' });
    await svc.record({ action: 'settings.change', module: 'settings' });
    const list = await svc.list();
    expect(asked).toEqual([['u9', 't1']]);
    expect(list.map((r) => [r.action, r.task])).toEqual([
      ['settings.change', null],
      ['USER_CREATED', null],
      ['client-view.task.shown', { key: 'MICO-142', title: 'Fix the pump' }],
      ['task.approve', { key: 'MICO-142', title: 'Fix the pump' }],
    ]);
  });

  it('without the lookup (older wiring) every entry’s task is null', async () => {
    const svc = createAuditService({ audit: createMemoryAuditRepository() });
    await svc.record({ action: 'task.approve', module: 'tasks', entityId: 't1' });
    expect((await svc.list())[0]!.task).toBeNull();
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
