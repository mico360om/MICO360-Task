import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore, handleAuthMessage, handleStorageChange, readStoredSession, initAuthSync } from './auth-store';
import { userStorageKey } from '../lib/user-storage';

const session = {
  user: { id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['ADMIN'] },
  accessToken: 'at',
  refreshToken: 'rt',
};

beforeEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({ remember: true });
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

  it('"Keep me signed in" unticked keeps tokens out of localStorage (this window only)', () => {
    useAuthStore.getState().setSession(session, { remember: false });
    expect(localStorage.getItem('mico360.accessToken')).toBeNull();
    expect(localStorage.getItem('mico360.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('mico360.accessToken')).toBe('at');
    expect(useAuthStore.getState().remember).toBe(false);
    // a later refresh keeps the same choice
    useAuthStore.getState().setSession({ ...session, accessToken: 'at2', refreshToken: 'rt2' });
    expect(localStorage.getItem('mico360.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('mico360.refreshToken')).toBe('rt2');
    expect(readStoredSession()).toMatchObject({ accessToken: 'at2', remember: false });
  });

  it('ticked moves the session to localStorage and drops any window-only copy', () => {
    useAuthStore.getState().setSession(session, { remember: false });
    useAuthStore.getState().setSession(session, { remember: true });
    expect(localStorage.getItem('mico360.accessToken')).toBe('at');
    expect(sessionStorage.getItem('mico360.accessToken')).toBeNull();
  });

  it('logout clears per-user browser state but keeps device preferences', () => {
    useAuthStore.getState().setSession(session);
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
    localStorage.setItem('mico360.board.projectId', 'legacy');
    localStorage.setItem('mico360.theme', 'dark');
    useAuthStore.getState().logout();
    expect(localStorage.getItem(userStorageKey('u1', 'board.projectId'))).toBeNull();
    expect(localStorage.getItem('mico360.board.projectId')).toBeNull();
    expect(localStorage.getItem('mico360.theme')).toBe('dark');
  });

  it('an explicit logout revokes the refresh token on the server; an expired session does not call it', () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout('expired');
    expect(fetchMock).not.toHaveBeenCalled();
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout('user');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/), expect.objectContaining({ method: 'POST' }));
  });
});

describe('cross-tab session sync', () => {
  it('adopts a refreshed pair another tab broadcast for the same user', () => {
    useAuthStore.getState().setSession(session, { remember: false });
    handleAuthMessage({ type: 'session', session: { ...session, accessToken: 'at2', refreshToken: 'rt2' }, remember: false });
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('at2');
    expect(s.refreshToken).toBe('rt2');
    expect(sessionStorage.getItem('mico360.refreshToken')).toBe('rt2'); // this tab's copy follows along
  });

  it('ignores a session broadcast for a different user or while signed out', () => {
    handleAuthMessage({ type: 'session', session, remember: true });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    useAuthStore.getState().setSession(session);
    handleAuthMessage({ type: 'session', session: { ...session, user: { ...session.user, id: 'u2' }, accessToken: 'x' }, remember: true });
    expect(useAuthStore.getState().accessToken).toBe('at');
  });

  it('signs this tab out when another tab signs the same user out', () => {
    useAuthStore.getState().setSession(session);
    handleAuthMessage({ type: 'logout', userId: 'u1' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('follows the shared remembered session in localStorage (rotation + sign-out)', () => {
    useAuthStore.getState().setSession(session);
    localStorage.setItem('mico360.refreshToken', 'rt3');
    localStorage.setItem('mico360.accessToken', 'at3');
    handleStorageChange('mico360.accessToken');
    expect(useAuthStore.getState().accessToken).toBe('at3');
    expect(useAuthStore.getState().refreshToken).toBe('rt3');
    localStorage.removeItem('mico360.accessToken');
    handleStorageChange('mico360.accessToken');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('logout as a click handler', () => {
  it('treats an event argument as an explicit sign-out (revokes on the server)', () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout({ type: 'click' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().endedBy).toBe('user');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('window-only sessions across tabs', () => {
  it('shares a not-remembered session with a new tab that asks for it (and only then)', () => {
    // An unsolicited share is ignored.
    handleAuthMessage({ type: 'share-session', session });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    const cleanup = initAuthSync(); // signed out → asks the other tabs
    handleAuthMessage({ type: 'share-session', session });
    cleanup();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.remember).toBe(false);
    expect(localStorage.getItem('mico360.accessToken')).toBeNull(); // still never persisted
    expect(sessionStorage.getItem('mico360.accessToken')).toBe('at');
  });
});
