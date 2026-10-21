import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryObserver, focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { createQueryClient, followAppState, type AppStateLike } from './query-client';
import { createReadCache } from './read-cache';
import { createSyncQueue } from './sync-queue';
import { createOfflineReads, withPendingMoves } from './offline-reads';
import { NetworkError } from './api-client';
import type { KeyValueStore } from './storage';
import type { ApiTask } from './types';

function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
    deleteItem: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

/** A stand-in for React Native's AppState: `emit` plays a state change. */
function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return { appState, emit: (state: string) => listeners.forEach((l) => l(state)) };
}

const task = (id: string, columnId: string): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId,
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
});

/** GET /tasks?projectId=p1: the server's board, unless the phone has no connection. */
function boardServer() {
  const state = { online: true, board: [task('t1', 'c1'), task('t2', 'c1'), task('t3', 'c1')] };
  const list = vi.fn(async () => {
    if (!state.online) throw new NetworkError('Network request failed.');
    return state.board.map((t) => ({ ...t }));
  });
  return { state, list };
}

const BOARD_KEY = ['tasks', 'project', 'p1', '2026-10-21'];
const COPY_KEY = 'tasks.p1.2026-10-21';

const clients: QueryClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) {
    c.unmount();
    c.clear();
  }
  vi.useRealTimers();
  focusManager.setEventListener(() => undefined);
  onlineManager.setEventListener(() => undefined);
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

/** The app as the board sees it: one user, the offline copy, the queue and the query client. */
async function boardApp() {
  const store = fakeStore();
  const cache = createReadCache({ store, getUserId: () => 'u1' });
  const queue = createSyncQueue({ store, perform: async () => undefined });
  await queue.load();
  const reads = createOfflineReads({ cache, pendingChanges: () => queue.pendingFor('u1') });
  const client = createQueryClient();
  client.mount();
  clients.push(client);
  const server = boardServer();
  // The board's own query (core/queries useProjectTasks).
  const observer = new QueryObserver(client, {
    queryKey: BOARD_KEY,
    queryFn: ({ queryKey }) => reads.readBoard(queryKey, COPY_KEY, server.list),
  });
  observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeDefined());
  await cache.settled();

  /** The board's move (useMoveTask): the card jumps at once; offline, the move is queued. */
  async function moveOffline(id: string, columnId: string) {
    client.setQueriesData<ApiTask[]>({ queryKey: ['tasks', 'project', 'p1'] }, (list) => list?.map((t) => (t.id === id ? { ...t, columnId } : t)));
    await queue.enqueue('task.move', { id, columnId }, { userId: 'u1' });
  }
  const columns = () => (client.getQueryData<ApiTask[]>(BOARD_KEY) ?? []).map((t) => `${t.id}:${t.columnId}`);
  return { client, queue, server, observer, moveOffline, columns };
}

describe('withPendingMoves', () => {
  const move = (id: string, columnId: string) => ({ kind: 'task.move', payload: { id, columnId } });

  it('shows each task a waiting move names in the column it was moved to, the newest move winning', () => {
    const tasks = [task('t1', 'c1'), task('t2', 'c1')];
    expect(withPendingMoves(tasks, [move('t1', 'c2'), move('t1', 'c3')]).map((t) => t.columnId)).toEqual(['c3', 'c1']);
  });

  it('leaves the list as it is for other changes, other tasks and moves already shown', () => {
    const tasks = [task('t1', 'c2')];
    const others = [{ kind: 'task.update', payload: { id: 't1', patch: { columnId: 'c9' } } }, move('t9', 'c3'), move('t1', 'c2'), { kind: 'task.move', payload: null }];
    expect(withPendingMoves(tasks, others)).toBe(tasks);
  });
});

describe('the board lays the moves still waiting over what it is given', () => {
  it('cards moved offline stay in their new columns when the app comes back and the refresh gets no answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { appState, emit } = fakeAppState();
    followAppState(appState);
    const { server, moveOffline, columns } = await boardApp();

    server.state.online = false;
    await moveOffline('t1', 'c2');
    await moveOffline('t2', 'c2');
    await moveOffline('t3', 'c3');
    expect(columns()).toEqual(['t1:c2', 't2:c2', 't3:c3']);

    // The phone is locked for a minute and unlocked: the refresh gets no answer and the offline
    // copy (from before the moves) answers instead.
    vi.setSystemTime(Date.now() + 60_000);
    emit('background');
    emit('active');
    await vi.waitFor(() => expect(server.list).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));

    expect(columns()).toEqual(['t1:c2', 't2:c2', 't3:c3']);
  });

  it('a server answer from before the move was replayed still shows the card where it was put', async () => {
    const { server, observer, moveOffline, columns } = await boardApp();
    server.state.online = false;
    await moveOffline('t1', 'c2');

    // Back online: the board is fetched before the queued move reached the server.
    server.state.online = true;
    await observer.refetch();
    expect(columns()).toEqual(['t1:c2', 't2:c1', 't3:c1']);
  });

  it('once the move is sent (no longer waiting), the server’s board is shown as it is', async () => {
    const { server, queue, observer, moveOffline, columns } = await boardApp();
    server.state.online = false;
    await moveOffline('t1', 'c2');
    server.state.online = true;
    server.state.board = [task('t1', 'c2'), task('t2', 'c1'), task('t3', 'c1')];
    await queue.flush('u1');
    // Someone else moved it on since: what the server holds wins.
    server.state.board = [task('t1', 'c4'), task('t2', 'c1'), task('t3', 'c1')];
    await observer.refetch();
    expect(columns()).toEqual(['t1:c4', 't2:c1', 't3:c1']);
  });
});
