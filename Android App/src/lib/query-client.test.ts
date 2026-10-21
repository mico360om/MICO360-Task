import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryObserver, focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { createQueryClient, followAppState, followConnectivity, type AppStateLike } from './query-client';
import { createConnectivity } from './connectivity';
import { ApiError, NetworkError } from './api-client';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A stand-in for React Native's AppState: `emit` plays a state change. */
function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  const remove = vi.fn();
  const appState: AppStateLike = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          remove();
          listeners.delete(listener);
        },
      };
    },
  };
  return { appState, remove, emit: (state: string) => listeners.forEach((l) => l(state)) };
}

/** Watch one query the way a mounted screen does; returns its fetch count. */
function watch(client: QueryClient, key: string, opts: { staleTime?: number } = {}) {
  const queryFn = vi.fn(async () => 'data');
  const observer = new QueryObserver(client, { queryKey: [key], queryFn, ...opts });
  const stop = observer.subscribe(() => {});
  return { queryFn, observer, stop };
}

const clients: QueryClient[] = [];
function mounted(): QueryClient {
  const client = createQueryClient();
  client.mount();
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const c of clients.splice(0)) {
    c.unmount();
    c.clear();
  }
  focusManager.setEventListener(() => undefined);
  onlineManager.setEventListener(() => undefined);
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe('createQueryClient', () => {
  it('still asks the server while it believes the phone is offline (reads fall back to the offline copy)', async () => {
    const client = mounted();
    onlineManager.setOnline(false);
    const { queryFn, observer } = watch(client, 'mine');
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().fetchStatus).not.toBe('paused');
  });

  it('still sends a change while it believes the phone is offline (so it can be queued for later)', async () => {
    const client = mounted();
    onlineManager.setOnline(false);
    const mutationFn = vi.fn(async () => 'saved');
    const mutation = client.getMutationCache().build(client, { mutationFn });
    const run = mutation.execute(undefined);
    await tick();
    expect(mutationFn).toHaveBeenCalledTimes(1);
    await expect(run).resolves.toBe('saved');
  });

  it('retries a dropped connection or a 5xx once, never a 4xx answer', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new NetworkError('offline'))).toBe(true);
    expect(retry(0, new ApiError(503, 'X', 'busy'))).toBe(true);
    expect(retry(1, new NetworkError('offline'))).toBe(false);
    expect(retry(0, new ApiError(404, 'NOT_FOUND', 'gone'))).toBe(false);
  });
});

describe('followAppState (coming back to the app refreshes what is on screen)', () => {
  it('refetches out-of-date queries when the app returns to the front', async () => {
    const client = mounted();
    const { appState, emit } = fakeAppState();
    followAppState(appState);
    const { queryFn } = watch(client, 'notifications', { staleTime: 0 });
    await tick();
    emit('background');
    emit('active');
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('leaves data that is still fresh alone', async () => {
    const client = mounted();
    const { appState, emit } = fakeAppState();
    followAppState(appState);
    const { queryFn } = watch(client, 'projects', { staleTime: 60_000 });
    await tick();
    emit('background');
    emit('active');
    await tick();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('stops listening when undone', () => {
    const { appState, remove } = fakeAppState();
    const undo = followAppState(appState);
    undo();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('followConnectivity (being back online refreshes what is on screen)', () => {
  it('refetches out-of-date queries once the server answers again', async () => {
    const client = mounted();
    const connectivity = createConnectivity();
    followConnectivity(connectivity);
    const { queryFn } = watch(client, 'mine', { staleTime: 0 });
    await tick();
    connectivity.unreachable();
    expect(onlineManager.isOnline()).toBe(false);
    connectivity.reachable();
    await tick();
    expect(onlineManager.isOnline()).toBe(true);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('starts from what the app already knows', () => {
    const connectivity = createConnectivity();
    connectivity.unreachable();
    followConnectivity(connectivity);
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('stops following when undone', () => {
    const connectivity = createConnectivity();
    const undo = followConnectivity(connectivity);
    undo();
    connectivity.unreachable();
    expect(onlineManager.isOnline()).toBe(true);
  });
});
