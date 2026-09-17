import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';

const session = {
  user: { id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['ADMIN'] },
  accessToken: 'at',
  refreshToken: 'rt',
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().logout();
});

describe('auth store', () => {
  it('starts unauthenticated', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('setSession authenticates and persists the access token', () => {
    useAuthStore.getState().setSession(session);
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.username).toBe('ada');
    expect(localStorage.getItem('mico360.accessToken')).toBe('at');
  });

  it('logout clears state and storage', () => {
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(localStorage.getItem('mico360.accessToken')).toBeNull();
  });

  it('isAdmin reflects the ADMIN role', () => {
    useAuthStore.getState().setSession(session);
    expect(useAuthStore.getState().isAdmin()).toBe(true);
    useAuthStore.getState().setSession({ ...session, user: { ...session.user, roles: ['EMPLOYEE'] } });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
  });
});
