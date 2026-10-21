import { describe, it, expect } from 'vitest';
import { getStateFromPath } from '@react-navigation/core';
import { LINKING_PREFIXES, linkingConfig, normalizeLinkPath, withoutLinkTitles } from './linking';
import { createPendingAction } from './pending-action';
import { requiresSession, targetToAction } from './nav-actions';

// React Navigation's config type is invariant on the param list; the pure config is plain data.
const cfg = linkingConfig as unknown as Parameters<typeof getStateFromPath>[1];

describe('linking config (MOB-09)', () => {
  it('handles the production web host so App Links reach the app', () => {
    expect(LINKING_PREFIXES).toContain('https://task.mico360.com');
    expect(LINKING_PREFIXES).toContain('mico360://');
  });

  it('routes reset?token= to the Reset screen with the token prefilled', () => {
    const state = getStateFromPath('reset?token=AbC_d-9', cfg);
    expect(state?.routes[0]).toMatchObject({ name: 'Reset', params: { token: 'AbC_d-9' } });
  });

  it('still routes task and project links', () => {
    expect(getStateFromPath('task/t1', cfg)?.routes[0]).toMatchObject({ name: 'TaskDetail', params: { taskId: 't1' } });
    expect(getStateFromPath('project/p1', cfg)?.routes[0]).toMatchObject({ name: 'Board', params: { projectId: 'p1' } });
  });

  it('routes a meeting link to the meeting, and the meetings and action items paths to their screens', () => {
    expect(getStateFromPath('meeting/m1', cfg)?.routes[0]).toMatchObject({ name: 'MeetingDetail', params: { meetingId: 'm1' } });
    expect(getStateFromPath('my-action-items', cfg)?.routes[0]).toMatchObject({ name: 'MyActionItems' });
    const tabs = getStateFromPath('meetings', cfg)?.routes[0];
    expect(tabs).toMatchObject({ name: 'Tabs' });
    expect(tabs?.state?.routes[0]).toMatchObject({ name: 'Meetings' });
  });

  it('opens a conversation from a chat link (3a), without taking its title from the link', () => {
    expect(getStateFromPath('chat/c1', cfg)?.routes[0]).toMatchObject({ name: 'ChatThread', params: { conversationId: 'c1' } });
    const state = withoutLinkTitles(getStateFromPath('chat/c1?title=Payroll', cfg));
    expect(state?.routes[0]?.params).toEqual({ conversationId: 'c1' });
  });

  it('opens the website’s own meeting address (/meetings/<id>) as the meeting too', () => {
    expect(normalizeLinkPath('meetings/m1')).toBe('meeting/m1');
    expect(normalizeLinkPath('/meetings/m1?from=mail')).toBe('/meeting/m1?from=mail');
    expect(normalizeLinkPath('meetings')).toBe('meetings');
    expect(normalizeLinkPath('meetings?q=x')).toBe('meetings?q=x');
    expect(normalizeLinkPath('task/t1')).toBe('task/t1');
    expect(getStateFromPath(normalizeLinkPath('meetings/m9'), cfg)?.routes[0]).toMatchObject({ name: 'MeetingDetail', params: { meetingId: 'm9' } });
  });

  it('never takes a screen title from a link — only the app itself names a screen it opens', () => {
    const open = (path: string) => withoutLinkTitles(getStateFromPath(normalizeLinkPath(path), cfg));
    expect(open('meeting/m1?title=Pay%20now')?.routes[0]).toEqual(expect.objectContaining({ name: 'MeetingDetail', params: { meetingId: 'm1' } }));
    expect(open('meetings/m2?title=x')?.routes[0]?.params).toEqual({ meetingId: 'm2' });
    expect(open('task/t1?title=Urgent%3A%20call%20me')?.routes[0]?.params).toEqual({ taskId: 't1' });
    expect(open('project/p1?projectName=Fake')?.routes[0]?.params).toEqual({ projectId: 'p1' });
    // Everything else a link carries stays (the reset token), and a link without a state is left alone.
    expect(open('reset?token=AbC')?.routes[0]?.params).toEqual({ token: 'AbC' });
    expect(withoutLinkTitles(undefined)).toBeUndefined();
  });

  // 3a review fix 8: an id that isn't an id (a path, spaces, too long) opens nothing.
  it('opens nothing for a link whose id isn’t an id — never another API path', () => {
    const open = (path: string) => withoutLinkTitles(getStateFromPath(normalizeLinkPath(path), cfg));
    expect(open('chat/..%2F..%2Fprojects%2Fp1')).toBeUndefined();
    expect(open('task/a%20b')).toBeUndefined();
    expect(open(`meeting/${'x'.repeat(65)}`)).toBeUndefined();
    expect(open('project/p1%3Fx%3D1')).toBeUndefined();
    // Real ids (cuid, uuid) still open.
    expect(open('chat/cmg1abcdef0001xyz')?.routes[0]?.params).toEqual({ conversationId: 'cmg1abcdef0001xyz' });
    expect(open('task/3f2c1b9e-8f4a-4b7e-9a1d-2c3e4f5a6b7c')?.routes[0]?.params).toEqual({ taskId: '3f2c1b9e-8f4a-4b7e-9a1d-2c3e4f5a6b7c' });
  });

  it('maps a parsed reset link to a signed-out navigation action', () => {
    const action = targetToAction({ screen: 'Reset', params: { token: 'zz' } });
    expect(action).toEqual({ type: 'auth', screen: 'Reset', params: { token: 'zz' } });
    expect(requiresSession(action)).toBe(false);
    expect(requiresSession({ type: 'tab', tab: 'Chat' })).toBe(true);
  });
});

describe('createPendingAction (WEB-18 — push taps while signed out wait for sign-in)', () => {
  it('keeps an action until it is taken, once', () => {
    const p = createPendingAction();
    p.set({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(p.peek()).not.toBeNull();
    expect(p.take()).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't1' } });
    expect(p.take()).toBeNull();
  });

  it('drops a stale action', () => {
    let t = 0;
    const p = createPendingAction({ ttlMs: 1000, now: () => t });
    p.set({ type: 'tab', tab: 'Notifications' });
    t = 5000;
    expect(p.peek()).toBeNull();
    expect(p.take()).toBeNull();
  });

  it('the latest tap wins', () => {
    const p = createPendingAction();
    p.set({ type: 'tab', tab: 'Chat' });
    p.set({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't2' } });
    expect(p.take()).toEqual({ type: 'stack', screen: 'TaskDetail', params: { taskId: 't2' } });
  });
});
