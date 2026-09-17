import { describe, it, expect } from 'vitest';
import { applyChatEvent, unreadTotal, type ChatEvent } from './chat';
import type { ApiChatMessage, ApiConversationSummary } from './types';

const msg = (over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id: 'm1', conversationId: 'c1', userId: 'u1', body: 'hi',
  editedAt: null, deletedAt: null, createdAt: '2026-09-10T00:00:00Z', reactions: [], attachments: [], ...over,
});

describe('applyChatEvent', () => {
  it('ignores events for a different conversation', () => {
    const list = [msg()];
    const event: ChatEvent = { type: 'chat:message', payload: { conversationId: 'other', message: msg({ id: 'm2' }) } };
    expect(applyChatEvent('c1', list, event)).toBe(list); // same reference, untouched
  });

  it('appends a new message and upserts a duplicate id (idempotent)', () => {
    const list = [msg({ id: 'm1' })];
    const added = applyChatEvent('c1', list, { type: 'chat:message', payload: { conversationId: 'c1', message: msg({ id: 'm2', body: 'second' }) } });
    expect(added.map((m) => m.id)).toEqual(['m1', 'm2']);
    const dup = applyChatEvent('c1', added, { type: 'chat:message', payload: { conversationId: 'c1', message: msg({ id: 'm2', body: 'second-again' }) } });
    expect(dup).toHaveLength(2);
    expect(dup.find((m) => m.id === 'm2')?.body).toBe('second-again');
  });

  it('replaces the body on an edit event', () => {
    const list = [msg({ id: 'm1', body: 'typo' })];
    const edited = applyChatEvent('c1', list, { type: 'chat:message:edited', payload: { conversationId: 'c1', message: msg({ id: 'm1', body: 'fixed', editedAt: '2026-09-10T01:00:00Z' }) } });
    expect(edited[0]!.body).toBe('fixed');
    expect(edited[0]!.editedAt).not.toBeNull();
  });

  it('tombstones a deleted message', () => {
    const list = [msg({ id: 'm1' })];
    const deleted = applyChatEvent('c1', list, { type: 'chat:message:deleted', payload: { conversationId: 'c1', id: 'm1' } });
    expect(deleted[0]!.deletedAt).not.toBeNull();
  });
});

describe('unreadTotal', () => {
  it('sums unread counts across conversations', () => {
    const summaries = [
      { conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 3, lastMessage: null },
      { conversation: { id: 'c2', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [], unread: 2, lastMessage: null },
    ] as ApiConversationSummary[];
    expect(unreadTotal(summaries)).toBe(5);
  });
});
