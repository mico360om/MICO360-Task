import { describe, it, expect } from 'vitest';
import { CHAT_EVENTS, chatInvalidationKeys } from './chat-realtime';

describe('CHAT_EVENTS', () => {
  it('matches the server/web event names', () => {
    expect([...CHAT_EVENTS]).toEqual([
      'chat:message',
      'chat:message:edited',
      'chat:message:deleted',
      'chat:reaction',
      'chat:read',
    ]);
  });
});

describe('chatInvalidationKeys', () => {
  it('always invalidates the conversation inbox', () => {
    expect(chatInvalidationKeys(undefined)).toEqual([['chat', 'conversations']]);
    expect(chatInvalidationKeys({})).toEqual([['chat', 'conversations']]);
  });

  it('also invalidates the affected thread when the payload names a conversation', () => {
    expect(chatInvalidationKeys({ conversationId: 'c1' })).toEqual([
      ['chat', 'conversations'],
      ['chat', 'messages', 'c1'],
    ]);
  });

  it('ignores a non-string conversationId', () => {
    expect(chatInvalidationKeys({ conversationId: 42 as unknown as string })).toEqual([['chat', 'conversations']]);
  });
});
