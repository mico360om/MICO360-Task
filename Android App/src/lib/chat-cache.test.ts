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

describe('a message put in while its thread is being fetched again survives that fetch (3a review fix 1)', () => {
  /** A refetch of the thread's two pages, answered with what the server held before; page 1 waits for `release`. */
  function staleRefetch(qc: QueryClient) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const done = qc.fetchInfiniteQuery<ApiChatMessage[], Error, ThreadPages, string[], string | undefined>({
      queryKey: threadKey('c1'),
      queryFn: async ({ pageParam }) => {
        if (!pageParam) return [msg('a', '01')];
        await gate;
        return [msg('old', '00')];
      },
      initialPageParam: undefined,
      getNextPageParam: (_last: ApiChatMessage[], all: ApiChatMessage[][]) => (all.length === 1 ? 'older' : undefined),
      staleTime: 0,
    });
    return { done, release };
  }

  it('the person’s own sent messages stay when a refetch read before them lands after them', async () => {
    const qc = client();
    qc.setQueryData<ThreadPages>(threadKey('c1'), { pages: [[msg('a', '01')], [msg('old', '00')]], pageParams: [undefined, 'older'] });
    const cache = createChatCache({ queryClient: qc });
    const { done, release } = staleRefetch(qc);
    await new Promise((r) => setTimeout(r, 0));
    // #2 and #3 are sent (their copies put in) while the refetch reads the older page.
    cache.afterSent(sent({ conversationId: 'c1', body: 'two', clientId: 'k2' }), msg('two', '05', { clientId: 'k2' }));
    cache.put('c1', msg('three', '06'));
    release();
    await done;
    expect(shown(qc, 'c1')).toEqual(['three', 'two', 'a', 'old']);
  });

  it('an edit or deletion made meanwhile stays too; a later fetch is taken as it is', async () => {
    const qc = client();
    qc.setQueryData<ThreadPages>(threadKey('c1'), { pages: [[msg('a', '01')], [msg('old', '00')]], pageParams: [undefined, 'older'] });
    const cache = createChatCache({ queryClient: qc });
    const { done, release } = staleRefetch(qc);
    await new Promise((r) => setTimeout(r, 0));
    cache.patch('c1', 'a', (m) => ({ ...m, body: '', deletedAt: '2026-10-21T08:07:00.000Z' }));
    release();
    await done;
    const data = qc.getQueryData<ThreadPages>(threadKey('c1'));
    expect(threadMessages(data).find((m) => m.id === 'a')?.deletedAt).toBe('2026-10-21T08:07:00.000Z');
    // Nothing is replayed on a fetch that started afterwards.
    const second = staleRefetch(qc);
    second.release();
    await second.done;
    expect(threadMessages(qc.getQueryData<ThreadPages>(threadKey('c1'))).find((m) => m.id === 'a')?.deletedAt).toBeNull();
  });
});

describe('an edit or deletion for a thread that isn’t loaded (3a review fix 9)', () => {
  it('changes the thread’s offline copy, so the retracted words don’t stay on the phone', () => {
    const qc = client();
    const revised: Array<{ cid: string; result: ApiChatMessage[] }> = [];
    const copy = [msg('a', '01', { body: 'secret' }), msg('b', '02')];
    const cache = createChatCache({ queryClient: qc, reviseCopy: (cid, change) => revised.push({ cid, result: change(copy) }) });
    cache.patch('c1', 'a', (m) => ({ ...m, body: '', deletedAt: '2026-10-21T09:00:00.000Z' }));
    expect(revised).toHaveLength(1);
    expect(revised[0]!.cid).toBe('c1');
    expect(revised[0]!.result.map((m) => [m.id, m.body])).toEqual([
      ['a', ''],
      ['b', 'b'],
    ]);
    // A loaded thread is changed in place (its copy is kept from it).
    seed(qc, 'c2', [msg('x', '01')]);
    cache.patch('c2', 'x', (m) => ({ ...m, body: 'edited' }));
    expect(revised).toHaveLength(1);
  });
});

describe('my message arriving live while it still waits on the phone (3a)', () => {
  it('shows once: the live copy takes the waiting one’s place by its client id, and the send’s answer adds nothing', async () => {
    const { outboxFor } = await import('./chat-outbox');
    const { threadItems } = await import('./chat-thread');
    const { chatEventPlan } = await import('./chat-realtime');
    const qc = client();
    seed(qc, 'c1', [msg('a', '01', { userId: 'u2' })]);
    const cache = createChatCache({ queryClient: qc });
    const waiting = { ...sent({ conversationId: 'c1', body: 'mine', clientId: 'k1' }), createdAt: Date.parse('2026-10-21T08:02:00.000Z') };
    const saved = msg('m-mine', '02', { body: 'mine', clientId: 'k1' });
    const rows = () => {
      const data = qc.getQueryData<ThreadPages>(threadKey('c1'));
      const confirmed = new Set(threadMessages(data).map((m) => m.clientId).filter((x): x is string => !!x));
      const outbox = outboxFor('c1', { pending: [waiting], failed: [] }, { online: true, confirmed });
      return threadItems(data, outbox, 'u1').map((r) => r.key);
    };
    expect(rows()).toEqual(['out-q1', 'msg-a']);
    // The socket's copy comes first…
    const plan = chatEventPlan('chat:message', { conversationId: 'c1', message: saved }, 'u1');
    cache.put(plan.put!.conversationId, plan.put!.message);
    expect(rows()).toEqual(['msg-m-mine', 'msg-a']);
    // …then the send's answer: still one.
    cache.afterSent(waiting, saved);
    expect(rows()).toEqual(['msg-m-mine', 'msg-a']);
  });
});
