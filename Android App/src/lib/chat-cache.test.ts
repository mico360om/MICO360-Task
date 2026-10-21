import { describe, it, expect, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createChatCache, threadKey } from './chat-cache';
import { threadMessages, type ThreadPages } from './chat-thread';
import type { ApiChatMessage } from './types';
import type { QueuedMutation } from './sync-queue';

const msg = (id: string, at: string, over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id,
  conversationId: 'c1',
  userId: 'u1',
  body: id,
  editedAt: null,
  deletedAt: null,
  createdAt: `2026-10-21T08:${at}:00.000Z`,
  reactions: [],
  attachments: [],
  ...over,
});
const sent = (payload: unknown, kind = 'chat.send'): QueuedMutation => ({
  id: 'q1',
  kind,
  payload,
  createdAt: 0,
  userId: 'u1',
  idempotencyKey: 'k1',
  attempts: 0,
  status: 'pending',
});

const clients: QueryClient[] = [];
function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  clients.push(qc);
  return qc;
}
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

const seed = (qc: QueryClient, cid: string, ...ps: ApiChatMessage[][]) =>
  qc.setQueryData<ThreadPages>(threadKey(cid), { pages: ps, pageParams: ps.map(() => undefined) });
const shown = (qc: QueryClient, cid: string) => threadMessages(qc.getQueryData<ThreadPages>(threadKey(cid))).map((m) => m.id);

describe('createChatCache: messages put into an open thread without reloading it (3a)', () => {
  it('a sent message’s server copy goes into its thread (the history is not fetched again)', () => {
    const qc = client();
    seed(qc, 'c1', [msg('a', '01')]);
    const cache = createChatCache({ queryClient: qc });
    cache.afterSent(sent({ conversationId: 'c1', body: 'b', clientId: 'k1' }), msg('b', '02', { clientId: 'k1' }));
    expect(shown(qc, 'c1')).toEqual(['b', 'a']);
    expect(qc.getQueryState(threadKey('c1'))?.isInvalidated).toBe(false);
  });

  it('ignores other changes, and answers that are not a message', () => {
    const qc = client();
    seed(qc, 'c1', [msg('a', '01')]);
    const cache = createChatCache({ queryClient: qc });
    cache.afterSent(sent({ id: 't1' }, 'task.update'), msg('x', '02'));
    cache.afterSent(sent({ conversationId: 'c1', body: 'b' }), undefined);
    expect(shown(qc, 'c1')).toEqual(['a']);
  });

  it('keeps the newest page on the phone for reading offline, each time the thread changes', () => {
    const qc = client();
    seed(qc, 'c1', [msg('a', '01')]);
    const keepCopy = vi.fn();
    const cache = createChatCache({ queryClient: qc, keepCopy });
    cache.put('c1', msg('b', '02'));
    expect(keepCopy).toHaveBeenCalledWith('c1', [msg('a', '01'), msg('b', '02')]);
    cache.patch('c1', 'a', (m) => ({ ...m, body: 'changed' }));
    expect(keepCopy).toHaveBeenLastCalledWith('c1', [{ ...msg('a', '01'), body: 'changed' }, msg('b', '02')]);
  });

  it('keeps nothing for a thread that has not loaded, or a change to a message it doesn’t hold', () => {
    const qc = client();
    seed(qc, 'c1', [msg('a', '01')]);
    const keepCopy = vi.fn();
    const cache = createChatCache({ queryClient: qc, keepCopy });
    cache.put('c2', msg('z', '01', { conversationId: 'c2' }));
    cache.patch('c1', 'nope', (m) => m);
    expect(keepCopy).not.toHaveBeenCalled();
  });
});

describe('the offline copy of a thread (3a): what was seen is readable offline, after a restart too', () => {
  it('a live message put into the thread is in the copy the next start reads offline', async () => {
    const { createReadCache } = await import('./read-cache');
    const { createMemoryStore } = await import('./storage');
    const { NetworkError } = await import('./api-client');
    const { chatThreadCopyKey, offlineCopyCaps } = await import('./offline-copy');
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1', rolling: offlineCopyCaps() });
    const qc = client();
    // The thread loaded online (its newest page is kept), then a message arrived live.
    const first = await cache.read(chatThreadCopyKey('c1'), async () => [msg('a', '01')]);
    seed(qc, 'c1', first.data);
    createChatCache({ queryClient: qc, keepCopy: (cid, newest) => cache.keep(chatThreadCopyKey(cid), newest) }).put('c1', msg('b', '02'));
    await cache.settled();
    // The app starts again, offline.
    const next = createReadCache({ store, getUserId: () => 'u1', rolling: offlineCopyCaps() });
    const offline = await next.read(chatThreadCopyKey('c1'), async () => {
      throw new NetworkError('offline');
    });
    expect(offline).toEqual({ data: [msg('a', '01'), msg('b', '02')], stale: true });
  });
});
