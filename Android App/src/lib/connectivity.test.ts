import { describe, it, expect, vi } from 'vitest';
import { createConnectivity, isConnectionDrop } from './connectivity';

describe('createConnectivity (online / offline from the app’s own requests and sockets)', () => {
  it('starts online', () => {
    expect(createConnectivity().isOnline()).toBe(true);
  });

  it('goes offline when a request gets no answer, and online again on the next answer', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    c.subscribe(heard);
    c.unreachable();
    expect(c.isOnline()).toBe(false);
    c.reachable();
    expect(c.isOnline()).toBe(true);
    expect(heard.mock.calls).toEqual([[false], [true]]);
  });

  it('tells listeners only about changes, not every request', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    c.subscribe(heard);
    c.reachable();
    c.reachable();
    c.unreachable();
    c.unreachable();
    expect(heard.mock.calls).toEqual([[false]]);
  });

  it('stops telling a listener once it unsubscribes', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    const stop = c.subscribe(heard);
    stop();
    c.unreachable();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('isConnectionDrop (a live socket closing because the connection went)', () => {
  it('counts a lost connection or a missed heartbeat', () => {
    expect(isConnectionDrop('transport close')).toBe(true);
    expect(isConnectionDrop('transport error')).toBe(true);
    expect(isConnectionDrop('ping timeout')).toBe(true);
  });

  it('does not count a socket closed on purpose (by the app or the server)', () => {
    expect(isConnectionDrop('io client disconnect')).toBe(false);
    expect(isConnectionDrop('io server disconnect')).toBe(false);
    expect(isConnectionDrop('parse error')).toBe(false);
  });
});
