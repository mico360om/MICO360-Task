import { describe, it, expect } from 'vitest';
import { CHAT_EVENTS, applyReaction, chatEventPlan } from './chat-realtime';
import type { ApiChatMessage } from './types';

const msg = (over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id: 'm1',
  conversationId: 'c1',
  userId: 'u2',
  body: 'hi',
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-10-21T08:00:00.000Z',
  reactions: [{ emoji: '👍', userIds: ['u3'] }],
  attachments: [],
  ...over,
});
const INBOX = { queryKey: ['chat', 'conversations'] };

describe('CHAT_EVENTS', () => {
  it('matches the server/web event names', () => {
    expect([...CHAT_EVENTS]).toEqual(['chat:message', 'chat:message:edited', 'chat:message:deleted', 'chat:reaction', 'chat:read', 'chat:delivered']);
  });
});

describe('chatEventPlan (a live event changes the thread in place; the history is not fetched again, 3a)', () => {
  it('a new message is put into its thread (once, by id) and the inbox is refreshed', () => {
    const m = msg({ id: 'm9', clientId: 'k9' });
    const plan = chatEventPlan('chat:message', { conversationId: 'c1', message: m }, 'me');
    expect(plan.put).toEqual({ conversationId: 'c1', message: m });
    expect(plan.refresh).toEqual([INBOX]);
  });

  it('an edit changes the text where the message is, keeping its reactions and files', () => {
    const plan = chatEventPlan('chat:message:edited', { conversationId: 'c1', message: { ...msg(), body: 'fixed', editedAt: 'now' } }, 'me');
    expect(plan.patch?.id).toBe('m1');
    expect(plan.patch!.change(msg())).toEqual({ ...msg(), body: 'fixed', editedAt: 'now' });
    expect(plan.refresh).toEqual([INBOX]);
  });

  it('a deletion leaves a tombstone: no text, files or reactions', () => {
    const plan = chatEventPlan('chat:message:deleted', { conversationId: 'c1', id: 'm1' }, 'me');
    const after = plan.patch!.change(msg({ attachments: [{ id: 'a1' } as never] }));
    expect(after).toMatchObject({ id: 'm1', body: '', attachments: [], reactions: [] });
    expect(after.deletedAt).toBeTruthy();
    expect(plan.refresh).toEqual([INBOX]);
  });

  it('a reaction is added or taken back on its message; the inbox doesn’t change', () => {
    const add = chatEventPlan('chat:reaction', { conversationId: 'c1', messageId: 'm1', userId: 'u4', emoji: '👍', op: 'add' }, 'me');
    expect(add.patch!.change(msg()).reactions).toEqual([{ emoji: '👍', userIds: ['u3', 'u4'] }]);
    const remove = chatEventPlan('chat:reaction', { conversationId: 'c1', messageId: 'm1', userId: 'u3', emoji: '👍', op: 'remove' }, 'me');
    expect(remove.patch!.change(msg()).reactions).toEqual([]);
    expect(add.refresh).toEqual([]);
  });

  it('reading — mine on another device, or someone else’s — refreshes the list: the unread numbers and the receipts (3b)', () => {
    expect(chatEventPlan('chat:read', { conversationId: 'c1', userId: 'me' }, 'me')).toEqual({ refresh: [INBOX] });
    // Someone else read: my messages show "Read" / "Seen by N" (from the list's participants).
    expect(chatEventPlan('chat:read', { conversationId: 'c1', userId: 'u2' }, 'me')).toEqual({ refresh: [INBOX] });
  });

  it('their app received my message: the list is fetched again, so it shows "Delivered" (3b)', () => {
    expect(chatEventPlan('chat:delivered', { conversationId: 'c1', userId: 'u2' }, 'me')).toEqual({ refresh: [INBOX] });
    // My own phone saying so changes nothing I see.
    expect(chatEventPlan('chat:delivered', { conversationId: 'c1', userId: 'me' }, 'me')).toEqual({ refresh: [] });
  });

  it('an event it can’t read refreshes what it names, as before', () => {
    expect(chatEventPlan('chat:message', { conversationId: 'c1' }, 'me')).toEqual({ refresh: [INBOX, { queryKey: ['chat', 'messages', 'c1'] }] });
    expect(chatEventPlan('chat:message', undefined, 'me')).toEqual({ refresh: [{ queryKey: ['chat'] }] });
    expect(chatEventPlan('chat:message:deleted', { conversationId: 42 }, 'me')).toEqual({ refresh: [{ queryKey: ['chat'] }] });
  });
});

describe('applyReaction', () => {
  it('adds once, removes the person, and drops an emoji nobody uses', () => {
    const groups = [{ emoji: '👍', userIds: ['u1'] }];
    expect(applyReaction(groups, '👍', 'u1', true)).toEqual(groups);
    expect(applyReaction(groups, '🎉', 'u2', true)).toEqual([{ emoji: '👍', userIds: ['u1'] }, { emoji: '🎉', userIds: ['u2'] }]);
    expect(applyReaction(groups, '👍', 'u1', false)).toEqual([]);
    expect(groups).toEqual([{ emoji: '👍', userIds: ['u1'] }]);
  });
});
