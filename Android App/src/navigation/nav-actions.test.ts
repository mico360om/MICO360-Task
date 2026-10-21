import { describe, it, expect } from 'vitest';
import { targetToAction } from './nav-actions';
import { DRAWER_ITEMS, activeDrawerKey, actionRouteName, drawerItemsFor } from './drawer-menu';
import { notificationToTarget, parseDeepLink } from '../lib/deep-link';

describe('targetToAction', () => {
  it('pushes stack screens for task/board and switches tabs for chat/notifications', () => {
    expect(targetToAction({ screen: 'TaskDetail', params: { taskId: 't1' } })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(targetToAction({ screen: 'Board', params: { projectId: 'p1' } })).toEqual({ type: 'stack', screen: 'Board', params: { projectId: 'p1' } });
    expect(targetToAction({ screen: 'Chat' })).toEqual({ type: 'tab', tab: 'Chat' });
    expect(targetToAction({ screen: 'Notifications' })).toEqual({ type: 'tab', tab: 'Notifications' });
  });

  it('pushes the meeting and My Action Items, and switches to the Meetings tab', () => {
    expect(targetToAction({ screen: 'MeetingDetail', params: { meetingId: 'm1' } })).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm1' } });
    expect(targetToAction({ screen: 'MyActionItems' })).toEqual({ type: 'stack', screen: 'MyActionItems' });
    expect(targetToAction({ screen: 'Meetings' })).toEqual({ type: 'tab', tab: 'Meetings' });
    expect(targetToAction(notificationToTarget({ entityType: 'meeting', entityId: 'm2' }))).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm2' } });
  });

  it('composes with the deep-link + push resolvers end to end', () => {
    expect(targetToAction(parseDeepLink('mico360://task/t9')!)).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't9' } });
    // a real backend push (lowercase entityType) → opens the task
    expect(targetToAction(notificationToTarget({ entityType: 'task', entityId: 't9' }))).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't9' } });
    expect(targetToAction(notificationToTarget({ entityType: 'conversation', entityId: 'c1' }))).toEqual({ type: 'tab', tab: 'Chat' });
  });
});

describe('drawer menu', () => {
  it('exposes destinations with unique keys and a route for each', () => {
    const keys = DRAWER_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of DRAWER_ITEMS) expect(actionRouteName(i.action)).toBeTruthy();
  });

  it('includes the stack-only screens the tabs do not reach (Calendar, Profile, My Action Items)', () => {
    const routes = DRAWER_ITEMS.map((i) => actionRouteName(i.action));
    expect(routes).toContain('Calendar');
    expect(routes).toContain('Profile');
    expect(routes).toContain('MyActionItems');
  });

  it('puts Meetings and My Action Items after Chat', () => {
    const keys = DRAWER_ITEMS.map((i) => i.key);
    expect(keys.slice(keys.indexOf('Chat'), keys.indexOf('Chat') + 3)).toEqual(['Chat', 'Meetings', 'MyActionItems']);
    expect(DRAWER_ITEMS.find((i) => i.key === 'Meetings')?.action).toEqual({ type: 'tab', tab: 'Meetings' });
    expect(activeDrawerKey('MyActionItems')).toBe('MyActionItems');
  });

  it('offers Reports to administrators only (the server checks the role too)', () => {
    expect(drawerItemsFor(['ADMIN']).map((i) => i.key)).toContain('Reports');
    expect(drawerItemsFor(['EMPLOYEE']).map((i) => i.key)).not.toContain('Reports');
    expect(drawerItemsFor([]).length).toBe(DRAWER_ITEMS.length - 1);
    expect(activeDrawerKey('Reports')).toBe('Reports');
  });

  it('resolves the active drawer key from the focused route name', () => {
    expect(activeDrawerKey('Projects')).toBe('Projects');
    expect(activeDrawerKey('Calendar')).toBe('Calendar');
    expect(activeDrawerKey('SomethingElse')).toBeUndefined();
    expect(activeDrawerKey(undefined)).toBeUndefined();
  });
});
