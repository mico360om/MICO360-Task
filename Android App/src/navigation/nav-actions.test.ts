import { describe, it, expect } from 'vitest';
import { targetToAction } from './nav-actions';
import { DRAWER_ITEMS, activeDrawerKey, actionRouteName } from './drawer-menu';
import { notificationToTarget, parseDeepLink } from '../lib/deep-link';

describe('targetToAction', () => {
  it('pushes stack screens for task/board and switches tabs for chat/notifications', () => {
    expect(targetToAction({ screen: 'TaskDetail', params: { taskId: 't1' } })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(targetToAction({ screen: 'Board', params: { projectId: 'p1' } })).toEqual({ type: 'stack', screen: 'Board', params: { projectId: 'p1' } });
    expect(targetToAction({ screen: 'Chat' })).toEqual({ type: 'tab', tab: 'Chat' });
    expect(targetToAction({ screen: 'Notifications' })).toEqual({ type: 'tab', tab: 'Notifications' });
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

  it('includes the stack-only screens the tabs do not reach (Calendar, Profile)', () => {
    const routes = DRAWER_ITEMS.map((i) => actionRouteName(i.action));
    expect(routes).toContain('Calendar');
    expect(routes).toContain('Profile');
  });

  it('resolves the active drawer key from the focused route name', () => {
    expect(activeDrawerKey('Projects')).toBe('Projects');
    expect(activeDrawerKey('Calendar')).toBe('Calendar');
    expect(activeDrawerKey('SomethingElse')).toBeUndefined();
    expect(activeDrawerKey(undefined)).toBeUndefined();
  });
});
