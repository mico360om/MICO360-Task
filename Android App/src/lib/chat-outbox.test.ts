import { describe, it, expect, vi } from 'vitest';
import {
  CHAT_SEND,
  connectionNote,
  enqueueChatMessage,
  notSentReason,
  outboxFor,
  outboxLabel,
  settledByServer,
  type OutboxEntry,
} from './chat-outbox';
import { createSyncQueue, NO_ANSWER_TEXT, type QueuedMutation } from './sync-queue';
import { createMemoryStore } from './storage';
import { ApiError, NetworkError } from './api-client';

const queued = (over: Partial<QueuedMutation> & { payload: unknown }): QueuedMutation => ({
  id: 'q1',
  kind: CHAT_SEND,
  createdAt: Date.parse('2026-10-21T08:00:00.000Z'),
  userId: 'u1',
  idempotencyKey: 'k1',
  attempts: 0,
  status: 'pending',
  ...over,
});
const p = (conversationId: string, body: string, clientId?: string) => ({ conversationId, body, ...(clientId ? { clientId } : {}) });

describe('enqueueChatMessage (every message is kept on the phone until the server has it)', () => {
  function deps() {
    const queue = createSyncQueue({ store: createMemoryStore(), perform: async () => undefined });
    const sync = vi.fn();
    return { queue, sync, userId: () => 'u1' as string | null, newKey: () => 'key-1' };
  }

  it('keeps the message with its client id (= its key) and starts sending it', async () => {
    const d = deps();
    const result = await enqueueChatMessage(d, 'c1', '  Hello team  ');
    expect(result).toEqual({ ok: true });
    const [m] = d.queue.pendingFor('u1');
    expect(m).toMatchObject({ kind: 'chat.send', payload: { conversationId: 'c1', body: 'Hello team', clientId: 'key-1' }, idempotencyKey: 'key-1', userId: 'u1' });
    expect(d.sync).toHaveBeenCalledTimes(1);
  });

  it('keeps several in the order they were written', async () => {
    const d = deps();
    let n = 0;
    d.newKey = () => `key-${++n}`;
    await enqueueChatMessage(d, 'c1', 'one');
    await enqueueChatMessage(d, 'c1', 'two');
    expect(d.queue.pendingFor('u1').map((m) => (m.payload as { body: string }).body)).toEqual(['one', 'two']);
  });

  it('a reply keeps the message it answers: its id is sent, its quote shows meanwhile (3b)', async () => {
    const d = deps();
    const quote = { id: 'm9', userId: 'u2', body: 'Can you check?', deleted: false };
    await enqueueChatMessage(d, 'c1', 'On it', quote);
    const [m] = d.queue.pendingFor('u1');
    expect(m!.payload).toEqual({ conversationId: 'c1', body: 'On it', clientId: 'key-1', replyToId: 'm9', replyTo: quote });
    const [entry] = outboxFor('c1', { pending: d.queue.pendingFor('u1'), failed: [] }, { online: true, confirmed: new Set() });
    expect(entry!.replyTo).toEqual(quote);
  });

  it('refuses an empty message, one over the server’s limit, and one while signed out', async () => {
    const d = deps();
    expect(await enqueueChatMessage(d, 'c1', '   ')).toEqual({ ok: false, error: 'Type a message first.' });
    expect(await enqueueChatMessage(d, 'c1', 'x'.repeat(4001))).toEqual({
      ok: false,
      error: 'Messages can be up to 4,000 characters. This one has 4,001.',
    });
    d.userId = () => null;
    expect(await enqueueChatMessage(d, 'c1', 'hi')).toEqual({ ok: false, error: 'You’re signed out. Sign in again to send messages.' });
    expect(d.queue.pendingFor('u1')).toEqual([]);
    expect(d.sync).not.toHaveBeenCalled();
  });
});

describe('outboxFor (the messages of this conversation still on this phone, shown in the thread)', () => {
  const pending = [
    queued({ id: 'q2', createdAt: Date.parse('2026-10-21T08:02:00.000Z'), payload: p('c1', 'second', 'k2'), idempotencyKey: 'k2' }),
    queued({ id: 'q1', createdAt: Date.parse('2026-10-21T08:01:00.000Z'), payload: p('c1', 'first', 'k1') }),
    queued({ id: 'q9', payload: p('c2', 'elsewhere', 'k9') }),
    queued({ id: 't1', kind: 'task.update', payload: { id: 't1', conversationId: 'c1' } }),
  ];
  const failed = [
    queued({ id: 'q3', status: 'failed', refused: true, lastError: 'You do not have access to this conversation.', createdAt: Date.parse('2026-10-21T08:03:00.000Z'), payload: p('c1', 'third', 'k3') }),
  ];

  it('lists only this conversation’s messages, oldest first, each with where it stands', () => {
    const entries = outboxFor('c1', { pending, failed }, { online: true, confirmed: new Set() });
    expect(entries.map((e) => [e.queueId, e.body, e.state])).toEqual([
      ['q1', 'first', 'sending'],
      ['q2', 'second', 'sending'],
      ['q3', 'third', 'failed'],
    ]);
    expect(entries[2]).toMatchObject({ clientId: 'k3', reason: 'You do not have access to this conversation.', createdAt: '2026-10-21T08:03:00.000Z' });
  });

  it('says a message waits for the connection while the phone is offline', () => {
    const entries = outboxFor('c1', { pending, failed: [] }, { online: false, confirmed: new Set() });
    expect(entries.map((e) => e.state)).toEqual(['waiting', 'waiting']);
  });

  it('drops one whose saved copy is already in the thread (the live event came before the answer)', () => {
    const entries = outboxFor('c1', { pending, failed }, { online: true, confirmed: new Set(['k1', 'k3']) });
    expect(entries.map((e) => e.queueId)).toEqual(['q2']);
  });

  it('shows a message kept by an older version (no client id) too', () => {
    const old = [queued({ id: 'q7', payload: p('c1', 'old one') })];
    expect(outboxFor('c1', { pending: old, failed: [] }, { online: true, confirmed: new Set(), now: Date.parse('2026-10-21T08:01:00.000Z') })).toEqual([
      { queueId: 'q7', clientId: null, conversationId: 'c1', body: 'old one', createdAt: '2026-10-21T08:00:00.000Z', state: 'sending' },
    ]);
  });
});

describe('settledByServer', () => {
  it('names the refused messages the server has after all (their saved copy is in the thread)', () => {
    const failed = [
      queued({ id: 'q3', status: 'failed', payload: p('c1', 'a', 'k3') }),
      queued({ id: 'q4', status: 'failed', payload: p('c1', 'b', 'k4') }),
    ];
    expect(settledByServer(failed, new Set(['k4']))).toEqual(['q4']);
  });
});

describe('notSentReason (why a message was not sent, in the website’s words — 3a review fix 13)', () => {
  it('passes on what the server said only when it refused the message', () => {
    expect(notSentReason({ refused: true, lastError: 'You do not have access to this conversation.' })).toBe('You do not have access to this conversation.');
    expect(notSentReason({ refused: true, lastError: new ApiError(403, 'FORBIDDEN', 'No access.').message })).toBe('No access.');
    expect(notSentReason({ refused: true, lastError: 'Request failed (400)' })).toBe('The server had a problem.');
  });
  it('says the server had a problem after its own failures — never their raw text', () => {
    expect(notSentReason({ lastError: 'Something went wrong.' })).toBe('The server had a problem.');
    expect(notSentReason({ lastError: 'The original request is still being processed. Retry shortly.' })).toBe('The server had a problem.');
    expect(notSentReason({ lastError: 'Request failed (503)' })).toBe('The server had a problem.');
    expect(notSentReason({})).toBe('The server had a problem.');
  });
  it('says the server couldn’t be reached when it never answered', () => {
    expect(notSentReason({ lastError: NO_ANSWER_TEXT, timeouts: 3 })).toBe('Couldn’t reach the server.');
  });
});

describe('a message the server hasn’t answered (2c review fix 4: the outbox follows the queue’s rules)', () => {
  it('says so and can be discarded, like a change waiting too long in the sync list', () => {
    const now = Date.parse('2026-10-21T08:05:00.000Z');
    const pending = [
      queued({ id: 'q1', payload: p('c1', 'stuck', 'k1'), timeouts: 1, createdAt: now - 60_000 }),
      queued({ id: 'q2', payload: p('c1', 'fresh', 'k2'), createdAt: now - 60_000 }),
      queued({ id: 'q3', payload: p('c1', 'old', 'k3'), createdAt: now - 20 * 60_000 }),
    ];
    const entries = outboxFor('c1', { pending, failed: [] }, { online: true, confirmed: new Set(), now });
    expect(entries.map((e) => [e.body, e.state, !!e.canDiscard])).toEqual([
      ['old', 'sending', true],
      ['stuck', 'unanswered', true],
      ['fresh', 'sending', false],
    ]);
    expect(outboxLabel(entries[1]!)).toBe('You: stuck. The server hasn’t answered yet. It will be tried again.');
  });
});

describe('outboxLabel (what TalkBack reads for a message still on the phone)', () => {
  const e = (over: Partial<OutboxEntry>): OutboxEntry => ({
    queueId: 'q1',
    clientId: 'k1',
    conversationId: 'c1',
    body: 'See you at 10',
    createdAt: '2026-10-21T08:00:00.000Z',
    state: 'sending',
    ...over,
  });
  it('says each state', () => {
    expect(outboxLabel(e({}))).toBe('You: See you at 10. Sending.');
    expect(outboxLabel(e({ state: 'waiting' }))).toBe('You: See you at 10. Waiting for connection. It will be sent when you’re back online.');
    expect(outboxLabel(e({ state: 'failed', reason: 'The server had a problem.' }))).toBe('You: See you at 10. Not sent. The server had a problem.');
  });
});

describe('connectionNote (said above the thread only while something is wrong)', () => {
  it('says nothing while online', () => {
    expect(connectionNote({ online: true, waiting: 2 })).toBeNull();
  });
  it('says the phone is offline, and how many messages wait', () => {
    expect(connectionNote({ online: false, waiting: 0 })).toBe('You’re offline. Messages you send will go out when you’re back online.');
    expect(connectionNote({ online: false, waiting: 1 })).toBe(
      'You’re offline. Messages you send will go out when you’re back online. 1 message is waiting to be sent.',
    );
    expect(connectionNote({ online: false, waiting: 3 })).toBe(
      'You’re offline. Messages you send will go out when you’re back online. 3 messages are waiting to be sent.',
    );
  });
});

describe('the outbox with the real queue: in order, the same client id on every try (3a)', () => {
  async function setup(answers: Array<'offline' | 'refused' | 'ok'>) {
    const { performMutation } = await import('./perform-mutation');
    const sends: Array<{ body: string; clientId?: string; key?: string }> = [];
    const resources = {
      chat: {
        send: vi.fn(async (_cid: string, body: string, opts: { idempotencyKey?: string; clientId?: string }) => {
          sends.push({ body, clientId: opts.clientId, key: opts.idempotencyKey });
          const answer = answers.shift() ?? 'ok';
          if (answer === 'offline') throw new NetworkError('No connection');
          if (answer === 'refused') throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this conversation.');
          return { id: `m-${body}`, conversationId: 'c1', body, clientId: opts.clientId };
        }),
      },
    };
    const queue = createSyncQueue({ store: createMemoryStore(), perform: (m) => performMutation(resources as never, m) });
    let n = 0;
    const d = { queue, sync: () => {}, userId: () => 'u1' as string | null, newKey: () => `key-${++n}` };
    return { queue, sends, d };
  }

  it('written offline, sent in the order written once the connection is back', async () => {
    const { queue, sends, d } = await setup(['offline']);
    await enqueueChatMessage(d, 'c1', 'one');
    await enqueueChatMessage(d, 'c1', 'two');
    expect((await queue.flush('u1')).pausedBy).toBe('offline');
    expect(outboxFor('c1', { pending: queue.pendingFor('u1'), failed: [] }, { online: false, confirmed: new Set() }).map((e) => e.body)).toEqual(['one', 'two']);
    await queue.flush('u1');
    expect(sends.map((s) => [s.body, s.clientId])).toEqual([
      ['one', 'key-1'],
      ['one', 'key-1'],
      ['two', 'key-2'],
    ]);
    expect(queue.pendingFor('u1')).toEqual([]);
  });

  it('refused: shown as not sent with the reason; Retry sends it again under the same id, with a new key (3a review fix 7)', async () => {
    const { queue, sends, d } = await setup(['refused', 'ok']);
    await enqueueChatMessage(d, 'c1', 'hello');
    await queue.flush('u1');
    const [entry] = outboxFor('c1', { pending: queue.pendingFor('u1'), failed: queue.failedFor('u1') }, { online: true, confirmed: new Set() });
    expect(entry).toMatchObject({ state: 'failed', reason: 'You do not have access to this conversation.' });
    await queue.retry(entry!.queueId);
    await queue.flush('u1');
    // The same client id (never stored twice), but a new Idempotency-Key: the server kept its refusal under the first.
    expect(sends.map((s) => s.clientId)).toEqual(['key-1', 'key-1']);
    expect(sends[0]!.key).toBe('key-1');
    expect(sends[1]!.key).not.toBe('key-1');
    expect(queue.failedFor('u1')).toEqual([]);
  });
});
