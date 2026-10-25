import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatBadge } from './useChatBadge';
import { setViewingConversation } from './chat-sound';
import { useAuthStore } from '../stores/auth-store';

const row = (id: string, unread: number) => ({
  conversation: { id, kind: 'DIRECT', projectId: null, createdAt: '' },
  participants: [],
  unread,
  lastMessage: null,
  prefs: { favorite: false, archived: false, muted: false },
});
let inbox: unknown[] = [];

beforeEach(() => {
  inbox = [row('a', 2), row('b', 3)];
  setViewingConversation(null);
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ data: String(url).endsWith('/conversations') ? inbox : [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setViewingConversation(null);
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, ...renderHook(() => useChatBadge(), { wrapper }) };
}

describe('useChatBadge', () => {
  it('counts the unread messages in the conversation list', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current).toBe(5));
  });

  it('follows the conversation list as it changes: up when a message arrives, down when one is read', async () => {
    const { result, qc } = mount();
    await waitFor(() => expect(result.current).toBe(5));
    inbox = [row('a', 3), row('b', 3)];
    await act(async () => { await qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }); });
    await waitFor(() => expect(result.current).toBe(6));
    inbox = [row('a', 0), row('b', 3)];
    await act(async () => { await qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }); });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it('leaves out the conversation you open, straight away', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current).toBe(5));
    act(() => setViewingConversation('b'));
    expect(result.current).toBe(2);
    act(() => setViewingConversation(null));
    expect(result.current).toBe(5);
  });

  it('is 0 when signed out (nothing is asked of the server)', () => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    const { result } = mount();
    expect(result.current).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
