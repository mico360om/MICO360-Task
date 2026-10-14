import { describe, it, expect, beforeEach } from 'vitest';
import { claimChime, shouldChime, setViewingConversation, viewingConversation } from './chat-sound';

describe('shouldChime', () => {
  const base = { authorId: 'u2', myId: 'me', conversationId: 'c1', soundOff: false, mutedIds: new Set<string>(), viewing: null as string | null, pageVisible: true };
  it('chimes for someone else’s message in a conversation you aren’t looking at', () => {
    expect(shouldChime(base)).toBe(true);
    expect(shouldChime({ ...base, viewing: 'c2' })).toBe(true);
  });
  it('stays quiet for your own messages, with the sound off, in a muted conversation, or the one open in front of you', () => {
    expect(shouldChime({ ...base, authorId: 'me' })).toBe(false);
    expect(shouldChime({ ...base, soundOff: true })).toBe(false);
    expect(shouldChime({ ...base, mutedIds: new Set(['c1']) })).toBe(false);
    expect(shouldChime({ ...base, viewing: 'c1' })).toBe(false);
  });
  it('still chimes for the open conversation when the tab is in the background', () => {
    expect(shouldChime({ ...base, viewing: 'c1', pageVisible: false })).toBe(true);
  });
});

describe('claimChime — one chime per message, however many tabs are open', () => {
  beforeEach(() => localStorage.clear());
  it('lets only the first tab (or the first time) play a message’s chime', () => {
    expect(claimChime('m1', 1000)).toBe(true);
    expect(claimChime('m1', 1001)).toBe(false); // another tab, same message
    expect(claimChime('m2', 1002)).toBe(true);
  });
  it('forgets old claims so storage doesn’t fill up', () => {
    claimChime('m1', 1000);
    claimChime('m2', 1000 + 5 * 60_000);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mico360.chat.chimed.')).length).toBe(1);
  });
});

describe('viewing conversation', () => {
  it('remembers which conversation the chat page has open', () => {
    setViewingConversation('c9');
    expect(viewingConversation()).toBe('c9');
    setViewingConversation(null);
    expect(viewingConversation()).toBeNull();
  });
});
