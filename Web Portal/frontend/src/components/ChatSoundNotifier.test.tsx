import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { ChatSoundNotifier } from './ChatSoundNotifier';
import { useAuthStore } from '../stores/auth-store';
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from '../api/notifications';
import { setViewingConversation } from '../lib/chat-sound';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
vi.mock('socket.io-client', () => ({
  io: () => ({ connected: false, on: (ev: string, cb: Handler) => { handlers[ev] = cb; }, emit: () => {}, connect: () => {}, disconnect: () => {} }),
}));
const sound = vi.hoisted(() => ({ off: true, playChime: vi.fn() }));
vi.mock('../lib/notificationSound', () => ({ playChime: sound.playChime, isChatMuted: () => sound.off, primeAudio: vi.fn() }));

let inbox: unknown[] = [];
let posts: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  inbox = [];
  posts = [];
  sound.off = true;
  sound.playChime.mockClear();
  localStorage.clear();
  setViewingConversation(null);
  for (const k of Object.keys(handlers)) delete handlers[k];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') posts.push(String(url));
    const data = String(url).endsWith('/conversations') ? inbox : [];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}><ChatSoundNotifier /></QueryClientProvider>);
  const refreshed = (key: readonly unknown[]) => invalidate.mock.calls.some(([arg]) => JSON.stringify((arg as { queryKey?: unknown }).queryKey) === JSON.stringify(key));
  return { qc, invalidate, refreshed };
}

describe('ChatSoundNotifier chimes once, and only when it should', () => {
  it('chimes for someone else’s message — once, even if the event arrives twice', () => {
    sound.off = false;
    mount();
    act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { id: 'm1', userId: 'u2' } }));
    act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { id: 'm1', userId: 'u2' } }));
    expect(sound.playChime).toHaveBeenCalledTimes(1);
  });

  it('stays quiet in a conversation you muted (even if the chat page was never opened), and in the one open in front of you', async () => {
    sound.off = false;
    inbox = [{ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 0, lastMessage: null, prefs: { favorite: false, archived: false, muted: true } }];
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { id: 'm2', userId: 'u2' } }));
    setViewingConversation('c3');
    act(() => handlers['chat:message']?.({ conversationId: 'c3', message: { id: 'm3', userId: 'u2' } }));
    expect(sound.playChime).not.toHaveBeenCalled();
    act(() => handlers['chat:message']?.({ conversationId: 'c4', message: { id: 'm4', userId: 'u2' } }));
    expect(sound.playChime).toHaveBeenCalledTimes(1);
  });
});

describe('ChatSoundNotifier confirms delivery', () => {
  const dm = (lastDeliveredAt: string | null) => ({
    conversation: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '' },
    participants: [
      { conversationId: 'd1', userId: 'me', lastReadAt: null, lastDeliveredAt, addedAt: '' },
      { conversationId: 'd1', userId: 'u2', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
    ],
    unread: 1,
    lastMessage: { id: 'm1', conversationId: 'd1', userId: 'u2', body: 'hi', editedAt: null, deletedAt: null, createdAt: '2026-10-10T08:00:00.000Z' },
    prefs: { favorite: false, archived: false, muted: false },
  });

  it('tells the server a direct message reached this app, once, so its sender sees “Delivered”', async () => {
    inbox = [dm(null)];
    const { qc } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(posts.filter((u) => u.endsWith('/conversations/d1/delivered'))).toHaveLength(1);
    // The inbox comes back unchanged (the server has not caught up yet): no second report.
    await act(async () => { await qc.invalidateQueries({ queryKey: ['chat', 'conversations'] }); await vi.advanceTimersByTimeAsync(0); });
    expect(posts.filter((u) => u.endsWith('/conversations/d1/delivered'))).toHaveLength(1);
  });

  it('does not report what was already delivered', async () => {
    inbox = [dm('2026-10-10T08:00:05.000Z')];
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(posts.some((u) => u.endsWith('/delivered'))).toBe(false);
  });

  it('refreshes the conversation list when someone else’s message arrives (unread counts, new conversations)', () => {
    const { refreshed } = mount();
    act(() => handlers['chat:message']?.({ conversationId: 'd9', message: { id: 'm9', userId: 'u2' } }));
    expect(refreshed(['chat', 'conversations'])).toBe(true);
  });
});

describe('ChatSoundNotifier keeps the unread counts current', () => {
  it('refreshes them when you read a conversation somewhere else (another tab, the phone app)', () => {
    const { refreshed } = mount();
    act(() => handlers['chat:read']?.({ conversationId: 'c1', userId: 'me', at: '2026-10-25T05:00:00.000Z' }));
    expect(refreshed(['chat', 'conversations'])).toBe(true);
  });

  it('does not refresh again for a conversation you are reading on this page (the Chat page already did)', () => {
    const { invalidate } = mount();
    setViewingConversation('c1');
    act(() => handlers['chat:read']?.({ conversationId: 'c1', userId: 'me', at: '2026-10-25T05:00:00.000Z' }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refreshes them when a message is deleted (an unread one stops counting)', () => {
    const { refreshed } = mount();
    act(() => handlers['chat:message:deleted']?.({ conversationId: 'c1', id: 'm1' }));
    expect(refreshed(['chat', 'conversations'])).toBe(true);
  });

  it('refreshes them when you mute or archive a conversation somewhere else', () => {
    const { refreshed } = mount();
    act(() => handlers['chat:prefs']?.({ conversationId: 'c1', prefs: { favorite: false, archived: false, muted: true } }));
    expect(refreshed(['chat', 'conversations'])).toBe(true);
  });

  it('refreshes them, and your projects, when you are taken off a project', () => {
    const { refreshed } = mount();
    act(() => handlers['project:removed']?.({ projectId: 'p1' }));
    expect(refreshed(['chat', 'conversations'])).toBe(true);
    expect(refreshed(['projects'])).toBe(true);
  });

  it('does not refresh when someone else reads a channel you are in', () => {
    const { invalidate } = mount();
    act(() => handlers['chat:read']?.({ conversationId: 'c1', userId: 'u2', at: '2026-10-25T05:00:00.000Z' }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refreshes them after the live connection comes back (messages may have arrived meanwhile)', () => {
    const { refreshed } = mount();
    act(() => handlers['connect']?.()); // first connection
    expect(refreshed(['chat', 'conversations'])).toBe(false);
    act(() => handlers['connect']?.()); // back after a drop
    expect(refreshed(['chat', 'conversations'])).toBe(true);
  });
});

describe('ChatSoundNotifier keeps the bell current', () => {
  it('refreshes the notification count soon after a message from someone else arrives (not on the next 30 s poll)', async () => {
    const { refreshed } = mount();
    act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { userId: 'u2' } }));
    expect(refreshed(UNREAD_COUNT_KEY)).toBe(false); // the server needs a moment to store the notification
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(refreshed(UNREAD_COUNT_KEY)).toBe(true);
    expect(refreshed(NOTIFICATIONS_KEY)).toBe(true);
  });

  it('does not refresh for your own messages, and a burst of messages costs one refresh', async () => {
    const { invalidate, refreshed } = mount();
    act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { userId: 'me' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(refreshed(UNREAD_COUNT_KEY)).toBe(false);

    for (let i = 0; i < 5; i++) act(() => handlers['chat:message']?.({ conversationId: 'c1', message: { userId: 'u2' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(invalidate.mock.calls.filter(([arg]) => JSON.stringify((arg as { queryKey?: unknown }).queryKey) === JSON.stringify(UNREAD_COUNT_KEY))).toHaveLength(1);
  });
});
