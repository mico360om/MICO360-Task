import { describe, it, expect } from 'vitest';
import { chatBadgeCount, chatBadgeText, chatNavLabel, menuButtonLabel } from './chat-badge';
import type { ConversationSummary } from '../api/chat';

const summary = (id: string, unread: number, prefs: Partial<ConversationSummary['prefs']> = {}): ConversationSummary =>
  ({
    conversation: { id, kind: 'DIRECT', projectId: null, createdAt: '2026-10-25T00:00:00.000Z' },
    participants: [],
    unread,
    lastMessage: null,
    prefs: { favorite: false, archived: false, muted: false, ...prefs },
  }) as ConversationSummary;

// The same rule as the Android app's Chat tab (Android App/src/lib/chat.ts chatBadgeCount).
describe('chatBadgeCount', () => {
  it('adds up the unread messages of every conversation', () => {
    expect(chatBadgeCount([summary('a', 2), summary('b', 0), summary('c', 5)], { viewing: null })).toBe(7);
  });

  it('leaves out muted and archived conversations', () => {
    expect(chatBadgeCount([summary('a', 2), summary('m', 4, { muted: true }), summary('z', 3, { archived: true })], { viewing: null })).toBe(2);
  });

  it('leaves out the conversation open on screen (it is being read)', () => {
    expect(chatBadgeCount([summary('a', 2), summary('b', 3)], { viewing: 'b' })).toBe(2);
  });

  it('is 0 before the inbox has loaded, or when the answer is not a list', () => {
    expect(chatBadgeCount(undefined, { viewing: null })).toBe(0);
    expect(chatBadgeCount({ data: [] } as unknown as ConversationSummary[], { viewing: null })).toBe(0);
  });

  it('ignores a missing or broken count', () => {
    const broken = { ...summary('a', 0), unread: undefined } as unknown as ConversationSummary;
    expect(chatBadgeCount([broken, summary('b', 1)], { viewing: null })).toBe(1);
  });
});

describe('chatBadgeText', () => {
  it('is nothing at 0, the number up to 99, then 99+', () => {
    expect(chatBadgeText(0)).toBeNull();
    expect(chatBadgeText(7)).toBe('7');
    expect(chatBadgeText(99)).toBe('99');
    expect(chatBadgeText(100)).toBe('99+');
  });
});

describe('what screen readers hear', () => {
  it('the Chat link: "Chat", or "Chat, 3 unread messages"', () => {
    expect(chatNavLabel(0)).toBe('Chat');
    expect(chatNavLabel(1)).toBe('Chat, 1 unread message');
    expect(chatNavLabel(3)).toBe('Chat, 3 unread messages');
  });

  it('the phone’s menu button, which hides the sidebar: "Open menu, 3 unread chat messages"', () => {
    expect(menuButtonLabel(0)).toBe('Open menu');
    expect(menuButtonLabel(1)).toBe('Open menu, 1 unread chat message');
    expect(menuButtonLabel(3)).toBe('Open menu, 3 unread chat messages');
  });
});
