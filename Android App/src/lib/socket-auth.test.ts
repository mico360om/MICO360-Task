import { describe, it, expect, vi } from 'vitest';
import { createSocketAuthHandler, currentTokenAuth } from './socket-auth';
import type { RefreshOutcome } from './api-client';

function setup(outcomes: RefreshOutcome[]) {
  const scheduled: { fn: () => void; ms: number }[] = [];
  const refresh = vi.fn(async () => outcomes.shift() ?? 'ok');
  const reconnect = vi.fn();
  const onSessionEnded = vi.fn();
  const h = createSocketAuthHandler({
    refresh,
    reconnect,
    onSessionEnded,
    maxAuthRetries: 2,
    baseDelayMs: 1000,
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });
  return { h, refresh, reconnect, onSessionEnded, scheduled };
}

const UNAUTHORIZED = { message: 'unauthorized' };

describe('createSocketAuthHandler (XP-05)', () => {
  it('refreshes the session and reconnects after an auth rejection', async () => {
    const s = setup(['ok']);
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.refresh).toHaveBeenCalledOnce();
    expect(s.reconnect).toHaveBeenCalledOnce();
  });

  it('leaves ordinary reconnects to socket.io while the socket is still active', async () => {
    const s = setup(['ok']);
    await s.h.onConnectError({ message: 'xhr poll error' }, true);
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('retries later (with back-off) when the refresh could not reach the server', async () => {
    const s = setup(['transient', 'transient']);
    await s.h.onConnectError(UNAUTHORIZED, false);
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.scheduled.map((x) => x.ms)).toEqual([1000, 2000]);
    expect(s.reconnect).not.toHaveBeenCalled();
    s.scheduled[0]!.fn();
    expect(s.reconnect).toHaveBeenCalledOnce();
  });

  it('ends the session when the refresh token is rejected', async () => {
    const s = setup(['invalid']);
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.onSessionEnded).toHaveBeenCalledOnce();
    expect(s.reconnect).not.toHaveBeenCalled();
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.refresh).toHaveBeenCalledOnce(); // stopped
  });

  it('stops hammering when fresh tokens keep being rejected, and resets after a good connect', async () => {
    const s = setup(['ok', 'ok', 'ok', 'ok']);
    await s.h.onConnectError(UNAUTHORIZED, false);
    await s.h.onConnectError(UNAUTHORIZED, false);
    await s.h.onConnectError(UNAUTHORIZED, false); // cap (2) reached
    expect(s.refresh).toHaveBeenCalledTimes(2);
    s.h.onConnect();
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.refresh).toHaveBeenCalledTimes(3);
  });

  it('refreshes and reconnects when the SERVER closes the socket (token expired / session revoked)', async () => {
    const s = setup(['ok']);
    await s.h.onDisconnect('io server disconnect');
    expect(s.refresh).toHaveBeenCalledOnce();
    expect(s.reconnect).toHaveBeenCalledOnce();
  });

  it('ignores transport drops (socket.io retries) and our own disconnect', async () => {
    const s = setup(['ok']);
    await s.h.onDisconnect('transport close');
    await s.h.onDisconnect('ping timeout');
    await s.h.onDisconnect('io client disconnect');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('ends the session when the server closed the socket because the session was revoked', async () => {
    const s = setup(['invalid']);
    await s.h.onDisconnect('io server disconnect');
    expect(s.onSessionEnded).toHaveBeenCalledOnce();
  });

  it('reports reconnects so callers refetch what they missed', () => {
    const s = setup([]);
    expect(s.h.onConnect()).toBe(false); // first connect
    expect(s.h.onConnect()).toBe(true); // reconnect
  });

  it('does nothing after stop()', async () => {
    const s = setup(['ok']);
    s.h.stop();
    await s.h.onConnectError(UNAUTHORIZED, false);
    expect(s.refresh).not.toHaveBeenCalled();
  });
});

describe('currentTokenAuth', () => {
  it('reads the token at handshake time, not when the socket was created', () => {
    let token = 'old';
    const auth = currentTokenAuth(() => token);
    token = 'fresh';
    const cb = vi.fn();
    auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'fresh' });
  });
});
