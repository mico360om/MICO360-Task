import { describe, it, expect } from 'vitest';
import { parseDeepLink, notificationToTarget } from './deep-link';

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
