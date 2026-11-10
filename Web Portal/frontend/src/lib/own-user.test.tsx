import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth-store';
import { ownName, updateOwnUser, useOwnUserRefresh } from './own-user';

// The header's face (11 Nov): the signed-in person's own name and current photo — refreshed on every
// load (GET /users/me) and the moment they change their photo, not only when they sign in.
const session = (user: Record<string, unknown>) =>
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'aisha@x.co', username: 'admin', roles: ['ADMIN'], ...user } as never, accessToken: 'a1', refreshToken: 'r1' }, { remember: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('ownName', () => {
  it('their first and last name, else the username', () => {
    expect(ownName({ username: 'admin', firstName: 'Aisha', lastName: 'Khan' })).toBe('Aisha Khan');
    expect(ownName({ username: 'admin', firstName: '', lastName: '' })).toBe('admin');
    expect(ownName({ username: 'admin' })).toBe('admin');
    expect(ownName(null)).toBe('');
  });
});

describe('updateOwnUser', () => {
  it('changes only what it is given, keeps the name and the session, and is saved for the next load', () => {
    session({ firstName: 'Aisha', lastName: 'Khan', avatarUrl: null });
    updateOwnUser({ id: 'u1', avatarUrl: '/uploads/new.png' });
    const s = useAuthStore.getState();
    expect(s.user).toMatchObject({ id: 'u1', username: 'admin', firstName: 'Aisha', lastName: 'Khan', avatarUrl: '/uploads/new.png' });
    expect([s.accessToken, s.refreshToken, s.isAuthenticated]).toEqual(['a1', 'r1', true]);
    expect(JSON.parse(localStorage.getItem('mico360.user')!)).toMatchObject({ firstName: 'Aisha', avatarUrl: '/uploads/new.png' });
  });

  it('never touches someone else’s session, or none', () => {
    session({ avatarUrl: null });
    updateOwnUser({ id: 'other', avatarUrl: '/uploads/x.png' });
    expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    expect(() => updateOwnUser({ id: 'u1', avatarUrl: '/uploads/x.png' })).not.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('useOwnUserRefresh', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
  const answer = (data: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })));

  it('on load: reads GET /users/me and takes their current name and photo', async () => {
    session({ avatarUrl: null });
    answer({ id: 'u1', email: 'aisha@x.co', username: 'admin', firstName: 'Aisha', lastName: 'Khan', roles: ['ADMIN'], avatarUrl: '/uploads/now.png' });
    renderHook(() => useOwnUserRefresh(), { wrapper });
    await waitFor(() => expect(useAuthStore.getState().user).toMatchObject({ firstName: 'Aisha', lastName: 'Khan', avatarUrl: '/uploads/now.png' }));
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toMatch(/\/users\/me$/);
  });

  it('an answer that isn’t about them changes nothing', async () => {
    session({ firstName: 'Aisha', lastName: 'Khan', avatarUrl: '/uploads/mine.png' });
    answer({ count: 0 });
    renderHook(() => useOwnUserRefresh(), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(useAuthStore.getState().user).toMatchObject({ firstName: 'Aisha', avatarUrl: '/uploads/mine.png' });
  });
});
