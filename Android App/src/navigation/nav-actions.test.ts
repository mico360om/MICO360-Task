import { describe, it, expect } from 'vitest';
import { meetingScreenId, targetToAction, taskScreenId } from './nav-actions';
import { DRAWER_ITEMS, activeDrawerKey, actionRouteName, drawerItemsFor } from './drawer-menu';
import { TAB_ITEMS } from './tabs';
import { notificationToTarget } from '../lib/deep-link';

describe('targetToAction', () => {
  it('pushes stack screens for task/board and switches tabs for chat/notifications', () => {
    expect(targetToAction({ screen: 'TaskDetail', params: { taskId: 't1' } })).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(targetToAction({ screen: 'Board', params: { projectId: 'p1' } })).toEqual({ type: 'stack', screen: 'Board', params: { projectId: 'p1' } });
    expect(targetToAction({ screen: 'Chat' })).toEqual({ type: 'tab', tab: 'Chat' });
    expect(targetToAction({ screen: 'Notifications' })).toEqual({ type: 'tab', tab: 'Notifications' });
  });

  it('pushes the project’s dashboard (5c)', () => {
    expect(targetToAction({ screen: 'ProjectDetail', params: { projectId: 'p1' } })).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p1' } });
    expect(targetToAction(notificationToTarget({ entityType: 'project', entityId: 'p2' }))).toEqual({ type: 'stack', screen: 'ProjectDetail', params: { projectId: 'p2' } });
  });

  it('pushes the meeting and My Action Items, and switches to the Meetings tab', () => {
    expect(targetToAction({ screen: 'MeetingDetail', params: { meetingId: 'm1' } })).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm1' } });
    expect(targetToAction({ screen: 'MyActionItems' })).toEqual({ type: 'stack', screen: 'MyActionItems' });
    expect(targetToAction({ screen: 'Meetings' })).toEqual({ type: 'tab', tab: 'Meetings' });
    expect(targetToAction(notificationToTarget({ entityType: 'meeting', entityId: 'm2' }))).toEqual({ type: 'stack', screen: 'MeetingDetail', params: { meetingId: 'm2' } });
  });

  it('gives each task and each meeting its own screen, so a link from one to another adds a screen (Back returns)', () => {
    expect(taskScreenId({ params: { taskId: 't1' } })).toBe('t1');
    const route = { params: { meetingId: 'm1', title: 'Weekly' } };
    expect(meetingScreenId(route)).toBe('m1');
    expect(taskScreenId({ params: undefined })).toBeUndefined();
  });

  it('composes with the push resolver end to end', () => {
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

  it('lists the tabs in the tab bar’s order, with My Action Items under Meetings', () => {
    const tabs = DRAWER_ITEMS.filter((i) => i.action.type === 'tab').map((i) => actionRouteName(i.action));
    expect(tabs).toEqual(TAB_ITEMS.map((t) => t.name));
    const keys = DRAWER_ITEMS.map((i) => i.key);
    expect(keys.slice(keys.indexOf('Meetings'), keys.indexOf('Meetings') + 2)).toEqual(['Meetings', 'MyActionItems']);
    expect(DRAWER_ITEMS.find((i) => i.key === 'Meetings')?.action).toEqual({ type: 'tab', tab: 'Meetings' });
    expect(activeDrawerKey('MyActionItems')).toBe('MyActionItems');
  });

  it('keeps the tab bar to six tabs: Settings is in the menu only', () => {
    expect(TAB_ITEMS.map((t) => t.name)).toEqual(['Dashboard', 'MyTasks', 'Projects', 'Meetings', 'Chat', 'Notifications']);
    expect(DRAWER_ITEMS.find((i) => i.key === 'Settings')?.action).toEqual({ type: 'stack', screen: 'Settings' });
    expect(activeDrawerKey('Settings')).toBe('Settings');
    // Each tab is named and drawn as the menu names it.
    for (const t of TAB_ITEMS) {
      const item = DRAWER_ITEMS.find((i) => i.key === t.name);
      expect([item?.label, item?.icon]).toEqual([t.title, t.icon]);
    }
  });

  it('offers Activity to everyone, under Alerts, as the website’s menu (5c)', () => {
    const keys = DRAWER_ITEMS.map((i) => i.key);
    expect(keys.slice(keys.indexOf('Notifications'), keys.indexOf('Notifications') + 2)).toEqual(['Notifications', 'Activity']);
    expect(DRAWER_ITEMS.find((i) => i.key === 'Activity')).toMatchObject({ label: 'Activity', action: { type: 'stack', screen: 'Activity' } });
    expect(drawerItemsFor(['EMPLOYEE']).map((i) => i.key)).toContain('Activity');
    expect(activeDrawerKey('Activity')).toBe('Activity');
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
