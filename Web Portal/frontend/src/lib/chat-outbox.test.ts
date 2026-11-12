import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BUSY_ELSEWHERE, dropFromOutbox, holdTab, keepInOutbox, loadOutbox, orphanedOutbox, outboxClientId, readOutboxEntry, withSendClaim } from './chat-outbox';
import type { PendingMessage } from './chat-model';

const pending = (over: Partial<PendingMessage>): PendingMessage => ({
  clientId: 'k1', conversationId: 'c1', body: 'later', createdAt: '2026-10-10T08:00:00.000Z', state: 'queued', replyTo: null, files: [], ...over,
});
const ids = (list: PendingMessage[]) => list.map((p) => p.clientId);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { locks?: unknown }).locks;
});

describe('chat outbox — messages not sent yet survive leaving the page', () => {
  it('keeps text messages that are waiting, sending or failed — per person — and comes back with them waiting, oldest first', () => {
    expect(keepInOutbox('me', pending({ clientId: 'b', state: 'failed', error: 'Too long.', createdAt: '2026-10-10T08:01:00.000Z' }))).toBe(true);
    expect(keepInOutbox('me', pending({ clientId: 'a', state: 'sending' }))).toBe(true);
    expect(keepInOutbox('me', pending({ clientId: 'c', files: [{ name: 'x.png', size: 1, type: 'image/png', progress: 0 }] }))).toBe(false);
    const back = loadOutbox('me');
    expect(back.map((p) => [p.clientId, p.state, p.error])).toEqual([['a', 'queued', undefined], ['b', 'failed', 'Too long.']]);
    expect(back.every((p) => p.files.length === 0)).toBe(true);
    expect(loadOutbox('someone-else')).toEqual([]);
  });

  it('two tabs of one person never undo each other: each keeps its own entry and removes only the one it finished', () => {
    // Tab A and tab B each hold their own copy of the outbox in memory; storage is shared.
    keepInOutbox('me', pending({ clientId: 'from-a', body: 'from tab A' }));
    keepInOutbox('me', pending({ clientId: 'from-b', body: 'from tab B', createdAt: '2026-10-10T08:00:01.000Z' }));
    dropFromOutbox('me', 'from-a'); // tab A's message reached the server
    expect(ids(loadOutbox('me'))).toEqual(['from-b']);
    // Tab A writing its next message doesn't touch tab B's either.
    keepInOutbox('me', pending({ clientId: 'next-a', createdAt: '2026-10-10T08:00:02.000Z' }));
    expect(ids(loadOutbox('me'))).toEqual(['from-b', 'next-a']);
  });

  it('says whether a message is still waiting (null once another tab finished it; undefined when storage cannot be read)', () => {
    keepInOutbox('me', pending({ clientId: 'x', state: 'failed', error: 'Nope.' }));
    expect(readOutboxEntry('me', 'x')).toMatchObject({ clientId: 'x', state: 'failed', error: 'Nope.' });
    dropFromOutbox('me', 'x');
    expect(readOutboxEntry('me', 'x')).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readOutboxEntry('me', 'x')).toBeUndefined();
  });

  it('tells its own storage entries apart from everything else', () => {
    keepInOutbox('me', pending({ clientId: 'x' }));
    const key = Object.keys(localStorage)[0]!;
    expect(outboxClientId('me', key)).toBe('x');
    expect(outboxClientId('someone-else', key)).toBeNull();
    expect(outboxClientId('me', 'mico360.chat.outbox.me')).toBeNull(); // the older one-list-per-person entry
    expect(outboxClientId('me', 'mico360.chat.draft.c1')).toBeNull();
    expect(outboxClientId('me', null)).toBeNull();
  });

  it('reads and moves over what an older version kept (one list per person), skips anything unreadable', () => {
    localStorage.setItem('mico360.chat.outbox.me', JSON.stringify([
      pending({ clientId: 'old-2', createdAt: '2026-10-10T08:05:00.000Z', state: 'sending' }),
      pending({ clientId: 'old-1', state: 'failed', error: 'Too long.' }),
      { clientId: 7, body: 'no id' },
      null,
    ]));
    keepInOutbox('me', pending({ clientId: 'new-1', createdAt: '2026-10-10T08:03:00.000Z' }));
    expect(loadOutbox('me').map((p) => [p.clientId, p.state])).toEqual([['old-1', 'failed'], ['new-1', 'queued'], ['old-2', 'queued']]);
    expect(localStorage.getItem('mico360.chat.outbox.me')).toBeNull();
    expect(loadOutbox('me')).toHaveLength(3); // moved, not lost
    dropFromOutbox('me', 'old-1');
    expect(ids(loadOutbox('me'))).toEqual(['new-1', 'old-2']);

    localStorage.clear();
    localStorage.setItem('mico360.chat.outbox.me', '{not json');
    expect(loadOutbox('me')).toEqual([]);
  });

  it('when the old list cannot be moved (storage full), still reads it and finishes its messages there', () => {
    localStorage.setItem('mico360.chat.outbox.me', JSON.stringify([pending({ clientId: 'old-1' }), pending({ clientId: 'old-2', createdAt: '2026-10-10T08:01:00.000Z' })]));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(ids(loadOutbox('me'))).toEqual(['old-1', 'old-2']);
    expect(readOutboxEntry('me', 'old-2')).toMatchObject({ clientId: 'old-2' });
    setItem.mockRestore();
    dropFromOutbox('me', 'old-1');
    expect(ids(loadOutbox('me'))).toEqual(['old-2']);
    dropFromOutbox('me', 'old-2');
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('without storage it keeps nothing and loses nothing it had', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(keepInOutbox('me', pending({}))).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadOutbox('me')).toEqual([]);
    expect(() => dropFromOutbox('me', 'k1')).not.toThrow();
  });
});

describe('withSendClaim — one tab at a time sends a given message', () => {
  it('runs alone when the browser has no Web Locks', async () => {
    await expect(withSendClaim('k1', async () => 'sent')).resolves.toBe('sent');
  });

  it('holds the message’s lock while sending: a second tab waits for the first to finish', async () => {
    const names: string[] = [];
    let tail: Promise<unknown> = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: (name: string, a: unknown, b?: unknown) => { names.push(name); const run = tail.then((typeof a === 'function' ? a : b) as () => Promise<unknown>); tail = run.catch(() => undefined); return run; } },
    });
    const order: string[] = [];
    let finishFirst: () => void = () => {};
    const first = withSendClaim('k1', () => new Promise<void>((r) => { order.push('A starts'); finishFirst = () => { order.push('A done'); r(); }; }));
    const second = withSendClaim('k1', async () => { order.push('B starts'); });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['A starts']);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['A starts', 'A done', 'B starts']);
    expect(new Set(names)).toEqual(new Set(['mico360.chat.send.k1']));
  });

  it('passes on a failed send, and still sends when the lock itself is refused', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_n: string, _o: unknown, cb: () => Promise<unknown>) => cb() } });
    await expect(withSendClaim('k1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => Promise.reject(new DOMException('no', 'SecurityError')) } });
    await expect(withSendClaim('k1', async () => 'sent anyway')).resolves.toBe('sent anyway');
  });
});

/** Web Locks as a browser has them for one site: shared by its tabs, one holder per name, a wait can be given up. */
function installLocks() {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  const grant = (name: string) => queues.get(name)?.shift()?.();
  const locks = {
    request(name: string, a: unknown, b?: unknown) {
      const cb = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
      const signal = (typeof a === 'object' && a ? (a as { signal?: AbortSignal }).signal : undefined);
      return new Promise((resolve, reject) => {
        const start = () => {
          held.add(name);
          Promise.resolve().then(cb).then(resolve, reject).finally(() => { held.delete(name); grant(name); });
        };
        if (!held.has(name) && !(queues.get(name)?.length)) return start();
        const q = queues.get(name) ?? [];
        queues.set(name, q);
        q.push(start);
        signal?.addEventListener('abort', () => {
          const i = q.indexOf(start);
          if (i >= 0) { q.splice(i, 1); reject(signal.reason); }
        });
      });
    },
    query: async () => ({ held: [...held].map((name) => ({ name })), pending: [] }),
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
}

describe('only messages of tabs that are gone are picked up by another tab', () => {
  it('stamps each kept message with the tab that wrote it', () => {
    keepInOutbox('me', pending({ clientId: 'x' }), 'tab-1');
    expect(readOutboxEntry('me', 'x')).toMatchObject({ clientId: 'x', owner: 'tab-1' });
  });

  it('leaves a message to its tab while that tab is open, and picks it up once the tab is closed', async () => {
    installLocks();
    const releaseA = holdTab('tab-a');
    await Promise.resolve();
    keepInOutbox('me', pending({ clientId: 'from-a' }), 'tab-a');
    keepInOutbox('me', pending({ clientId: 'from-closed', createdAt: '2026-10-10T08:01:00.000Z' }), 'tab-gone');
    keepInOutbox('me', pending({ clientId: 'mine', createdAt: '2026-10-10T08:02:00.000Z' }), 'tab-b');
    localStorage.setItem('mico360.chat.outbox.me.legacy-like', JSON.stringify(pending({ clientId: 'legacy-like', createdAt: '2026-10-10T08:03:00.000Z' })));
    // Tab B: its own are already on its page; tab A is open; tab-gone was closed; one without a writer (older version).
    expect(ids(await orphanedOutbox('me', 'tab-b'))).toEqual(['from-closed', 'legacy-like']);
    releaseA();
    await new Promise((r) => setTimeout(r, 0));
    expect(ids(await orphanedOutbox('me', 'tab-b'))).toEqual(['from-a', 'from-closed', 'legacy-like']);
  });

  it('without Web Locks it can’t tell, and picks up every message not its own (the server keeps each once)', async () => {
    keepInOutbox('me', pending({ clientId: 'from-a' }), 'tab-a');
    keepInOutbox('me', pending({ clientId: 'mine', createdAt: '2026-10-10T08:02:00.000Z' }), 'tab-b');
    expect(ids(await orphanedOutbox('me', 'tab-b'))).toEqual(['from-a']);
  });

  it('a tab waits only so long for another tab sending the same message, then leaves it to that tab', async () => {
    installLocks();
    let finish: () => void = () => {};
    const first = withSendClaim('k1', () => new Promise<string>((r) => { finish = () => r('sent by A'); }));
    await Promise.resolve();
    await expect(withSendClaim('k1', async () => 'sent by B', 50)).resolves.toBe(BUSY_ELSEWHERE);
    finish();
    await expect(first).resolves.toBe('sent by A');
    await expect(withSendClaim('k1', async () => 'sent later', 50)).resolves.toBe('sent later');
  });
});
