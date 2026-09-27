import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bindQueryCacheToSession } from './session-lifecycle';
import { useAuthStore } from '../stores/auth-store';

const as = (id: string, token = `at-${id}`) => ({
  user: { id, email: `${id}@x.test`, username: id, roles: [] as string[] },
  accessToken: token,
  refreshToken: `rt-${id}`,
});

beforeEach(() => {
  useAuthStore.getState().logout('remote');
  localStorage.clear();
});

describe('bindQueryCacheToSession', () => {
  it('drops cached data on sign-out, keeps it across a token refresh for the same user', () => {
    const qc = new QueryClient();
    const unbind = bindQueryCacheToSession(qc);
    useAuthStore.getState().setSession(as('alice'));
    qc.setQueryData(['my-tasks'], [{ id: 't1', title: 'Alice secret' }]);

    useAuthStore.getState().setSession(as('alice', 'at-refreshed'));
    expect(qc.getQueryData(['my-tasks'])).toBeDefined();

    useAuthStore.getState().logout();
    expect(qc.getQueryData(['my-tasks'])).toBeUndefined();
    unbind();
  });

  it('drops cached data when a different user signs in', () => {
    const qc = new QueryClient();
    const unbind = bindQueryCacheToSession(qc);
    useAuthStore.getState().setSession(as('alice'));
    qc.setQueryData(['notif-list'], [{ id: 'n1' }]);
    useAuthStore.getState().setSession(as('bob'));
    expect(qc.getQueryData(['notif-list'])).toBeUndefined();
    unbind();
  });
});
