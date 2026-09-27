import { describe, it, expect } from 'vitest';
import { parseDeepLink, notificationToTarget, extractResetToken } from './deep-link';

describe('parseDeepLink (A0.3)', () => {
  it('maps a task URL (custom scheme) to the TaskDetail target', () => {
    expect(parseDeepLink('mico360://task/t123')).toEqual({ screen: 'TaskDetail', params: { taskId: 't123' } });
  });

  it('maps a project URL to the Board target', () => {
    expect(parseDeepLink('mico360://project/p1')).toEqual({ screen: 'Board', params: { projectId: 'p1' } });
  });

  it('maps an https universal link the same way', () => {
    expect(parseDeepLink('https://app.mico360.test/task/t9')).toEqual({ screen: 'TaskDetail', params: { taskId: 't9' } });
  });

  it('maps the notifications and chat paths', () => {
    expect(parseDeepLink('mico360://notifications')).toEqual({ screen: 'Notifications' });
    expect(parseDeepLink('mico360://chat')).toEqual({ screen: 'Chat' });
  });

  it('returns null for an unknown or malformed URL', () => {
    expect(parseDeepLink('mico360://')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink('mico360://task/')).toBeNull();
  });
});

describe('notificationToTarget (A6.2 — deep-link on push tap)', () => {
  it('routes a task notification to TaskDetail — matching the backend’s lowercase entityType', () => {
    // the backend sends entityType: 'task' (lowercase); matching must be case-insensitive
    expect(notificationToTarget({ entityType: 'task', entityId: 't5' })).toEqual({ screen: 'TaskDetail', params: { taskId: 't5' } });
    expect(notificationToTarget({ entityType: 'TASK', entityId: 't5' })).toEqual({ screen: 'TaskDetail', params: { taskId: 't5' } });
  });

  it('routes a project notification to the Board', () => {
    expect(notificationToTarget({ entityType: 'project', entityId: 'p2' })).toEqual({ screen: 'Board', params: { projectId: 'p2' } });
  });

  it('routes a conversation notification to the Chat tab', () => {
    expect(notificationToTarget({ entityType: 'conversation', entityId: 'c1' })).toEqual({ screen: 'Chat' });
  });

  it('falls back to the Notifications screen for a digest / unknown / absent entity', () => {
    expect(notificationToTarget({ entityType: 'digest', entityId: '2026-09-15' })).toEqual({ screen: 'Notifications' });
    expect(notificationToTarget({ type: 'SYSTEM' })).toEqual({ screen: 'Notifications' });
    expect(notificationToTarget({})).toEqual({ screen: 'Notifications' });
  });
});

describe('Alerts list items (WEB-18)', () => {
  it('opens the related task from an API notification’s entityType/entityId, and tolerates nulls', () => {
    expect(notificationToTarget({ entityType: 'task', entityId: 't7' })).toEqual({ screen: 'TaskDetail', params: { taskId: 't7' } });
    expect(notificationToTarget({ entityType: null, entityId: null })).toEqual({ screen: 'Notifications' });
    expect(notificationToTarget({ entityType: 'task', entityId: null })).toEqual({ screen: 'Notifications' });
  });
});

describe('password-reset links (MOB-09)', () => {
  it('maps the e-mailed reset link to the Reset screen with the token', () => {
    expect(parseDeepLink('https://task.mico360.com/reset?token=AbC_d-9')).toEqual({ screen: 'Reset', params: { token: 'AbC_d-9' } });
    expect(parseDeepLink('mico360://reset?token=xyz')).toEqual({ screen: 'Reset', params: { token: 'xyz' } });
  });

  it('ignores a reset link without a token', () => {
    expect(parseDeepLink('https://task.mico360.com/reset')).toBeNull();
  });

  it('extracts the token from a pasted link, a query fragment or a bare token', () => {
    expect(extractResetToken('https://task.mico360.com/reset?token=AbC_d-9&x=1')).toBe('AbC_d-9');
    expect(extractResetToken('reset?token=a%2Db')).toBe('a-b');
    expect(extractResetToken('  AbC_d-9  ')).toBe('AbC_d-9');
    expect(extractResetToken('')).toBe('');
  });
});
