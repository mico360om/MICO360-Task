import { describe, it, expect, vi } from 'vitest';
import {
  notificationsAbout,
  pushPresentation,
  setViewingConversation,
  subscribeViewing,
  viewingConversation,
} from './chat-viewing';

describe('the conversation on screen (3a)', () => {
  it('is remembered while its thread is open, and forgotten after', () => {
    setViewingConversation('c1');
    expect(viewingConversation()).toBe('c1');
    setViewingConversation(null);
    expect(viewingConversation()).toBeNull();
  });
  it('tells listeners when it changes (the Chat tab’s number leaves it out)', () => {
    const heard = vi.fn();
    const stop = subscribeViewing(heard);
    setViewingConversation('c2');
    setViewingConversation('c2');
    setViewingConversation(null);
    stop();
    setViewingConversation('c3');
    expect(heard).toHaveBeenCalledTimes(2);
    setViewingConversation(null);
  });
});

describe('pushPresentation (a push that arrives while the app is open)', () => {
  const shown = { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false };
  const quiet = { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
  it('is quiet for the conversation you are reading: its messages are already on screen', () => {
    expect(pushPresentation({ entityType: 'conversation', entityId: 'c1' }, 'c1')).toEqual(quiet);
    expect(pushPresentation({ entityType: 'Conversation', entityId: 'c1' }, 'c1')).toEqual(quiet);
  });
  it('shows anything else: another conversation, a task, or when no thread is open', () => {
    expect(pushPresentation({ entityType: 'conversation', entityId: 'c2' }, 'c1')).toEqual(shown);
    expect(pushPresentation({ entityType: 'task', entityId: 'c1' }, 'c1')).toEqual(shown);
    expect(pushPresentation({ entityType: 'conversation', entityId: 'c1' }, null)).toEqual(shown);
    expect(pushPresentation(undefined, 'c1')).toEqual(shown);
  });
});

describe('notificationsAbout (the phone’s notifications to clear once a conversation is read)', () => {
  const n = (identifier: string, data: Record<string, unknown> | null) => ({ request: { identifier, content: { data } } });
  it('picks the ones about that conversation', () => {
    const presented = [
      n('a', { entityType: 'conversation', entityId: 'c1' }),
      n('b', { entityType: 'conversation', entityId: 'c2' }),
      n('c', { entityType: 'task', entityId: 'c1' }),
      n('d', null),
      n('e', { entityType: 'CONVERSATION', entityId: 'c1' }),
    ];
    expect(notificationsAbout(presented, 'conversation', 'c1')).toEqual(['a', 'e']);
  });
});
