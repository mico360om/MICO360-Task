import { describe, it, expect } from 'vitest';
import { getStateFromPath } from '@react-navigation/core';
import { LINKING_PREFIXES, linkingConfig } from './linking';
import { createPendingAction } from './pending-action';
import { requiresSession, targetToAction } from './nav-actions';
import { parseDeepLink } from '../lib/deep-link';

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

  it('maps a parsed reset link to a signed-out navigation action', () => {
    const action = targetToAction(parseDeepLink('https://task.mico360.com/reset?token=zz')!);
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
