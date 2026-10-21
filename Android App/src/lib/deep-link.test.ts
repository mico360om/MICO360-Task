import { describe, it, expect } from 'vitest';
import * as DeepLink from './deep-link';
import { notificationToTarget, extractResetToken } from './deep-link';

describe('links (A0.3)', () => {
  it('are read in one place only — the navigator’s linking config (navigation/linking) — never by a second parser that could drift from it', () => {
    expect(Object.keys(DeepLink)).not.toContain('parseDeepLink');
  });
});

describe('meeting notifications (2a)', () => {
  it('opens the meeting from a notification about it', () => {
    expect(notificationToTarget({ entityType: 'meeting', entityId: 'm5' })).toEqual({ screen: 'MeetingDetail', params: { meetingId: 'm5' } });
    expect(notificationToTarget({ entityType: 'Meeting', entityId: 'm5' })).toEqual({ screen: 'MeetingDetail', params: { meetingId: 'm5' } });
    expect(notificationToTarget({ entityType: 'meeting' })).toEqual({ screen: 'Notifications' });
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
  it('extracts the token from a pasted link, a query fragment or a bare token', () => {
    expect(extractResetToken('https://task.mico360.com/reset?token=AbC_d-9&x=1')).toBe('AbC_d-9');
    expect(extractResetToken('reset?token=a%2Db')).toBe('a-b');
    expect(extractResetToken('  AbC_d-9  ')).toBe('AbC_d-9');
    expect(extractResetToken('')).toBe('');
  });
});
