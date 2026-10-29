import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useManagementLink } from './useManagementLink';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
let answer: (allowed: boolean) => void;
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u7', email: 'o@x.co', username: 'omar', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = (allowed) => resolve(json({ data: { allowed } })); })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('useManagementLink (the sidebar’s Management link)', () => {
  it('shows what the server said last time while it is asked again — the menu doesn’t shift when the answer comes', async () => {
    localStorage.setItem('mico360.managementLink.u7', '1');
    const { result } = renderHook(() => useManagementLink(), { wrapper });
    expect(result.current).toBe(true);
    answer(true);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });

  it('follows the server’s answer, and remembers it for next time', async () => {
    localStorage.setItem('mico360.managementLink.u7', '1');
    const { result } = renderHook(() => useManagementLink(), { wrapper });
    answer(false);
    await waitFor(() => expect(result.current).toBe(false));
    expect(localStorage.getItem('mico360.managementLink.u7')).toBe('0');
  });

  it('with nothing remembered, shows no link until the server says yes', async () => {
    const { result } = renderHook(() => useManagementLink(), { wrapper });
    expect(result.current).toBe(false);
    answer(true);
    await waitFor(() => expect(result.current).toBe(true));
    expect(localStorage.getItem('mico360.managementLink.u7')).toBe('1');
  });

  it('is always shown to an administrator', () => {
    useAuthStore.getState().setSession({ user: { id: 'a1', email: 'a@x.co', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    const { result } = renderHook(() => useManagementLink(), { wrapper });
    expect(result.current).toBe(true);
  });
});
