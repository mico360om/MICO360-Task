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


// ── 3a: read state, the badge, titles and who can be mentioned ──────────────────
import {
  chatBadgeCount,
  chatMemberIds,
  conversationForProject,
  conversationTitle,
  mentionPeopleFor,
  shouldMarkRead,
  withConversationRead,
} from './chat';
import type { ApiDirectoryUser } from './types';

const summary = (id: string, over: Partial<ApiConversationSummary> = {}): ApiConversationSummary => ({
  conversation: { id, kind: 'DIRECT', projectId: null, createdAt: '' },
  participants: [
    { conversationId: id, userId: 'me', lastReadAt: null, addedAt: '' },
    { conversationId: id, userId: 'u2', lastReadAt: null, addedAt: '' },
  ],
  unread: 0,
  lastMessage: null,
  ...over,
});
const channel = (id: string, projectId: string, over: Partial<ApiConversationSummary> = {}) =>
  summary(id, { conversation: { id, kind: 'PROJECT', projectId, createdAt: '' }, participants: [], ...over });
const person = (id: string, username: string, firstName = '', lastName = ''): ApiDirectoryUser =>
  ({ id, username, firstName, lastName }) as ApiDirectoryUser;

describe('chatBadgeCount (the Chat tab’s number)', () => {
  it('adds up the unread messages', () => {
    expect(chatBadgeCount([summary('c1', { unread: 2 }), channel('c2', 'p1', { unread: 3 })], { viewing: null })).toBe(5);
  });
  it('leaves out muted conversations and the one open on screen (it is being read)', () => {
    const inbox = [
      summary('c1', { unread: 2, prefs: { favorite: false, archived: false, muted: true } }),
      channel('c2', 'p1', { unread: 3 }),
      summary('c3', { unread: 4 }),
    ];
    expect(chatBadgeCount(inbox, { viewing: 'c3' })).toBe(3);
  });
  it('is 0 with nothing loaded', () => {
    expect(chatBadgeCount(undefined, { viewing: null })).toBe(0);
  });
});

describe('withConversationRead (the inbox right after a conversation was read)', () => {
  it('sets that conversation’s unread to 0 and leaves the rest', () => {
    const inbox = [summary('c1', { unread: 2 }), summary('c2', { unread: 1 })];
    const next = withConversationRead(inbox, 'c1')!;
    expect(next.map((s) => s.unread)).toEqual([0, 1]);
    expect(next[1]).toBe(inbox[1]);
  });
  it('returns the same list when there is nothing to change', () => {
    const inbox = [summary('c1', { unread: 0 })];
    expect(withConversationRead(inbox, 'c1')).toBe(inbox);
    expect(withConversationRead(undefined, 'c1')).toBeUndefined();
  });
});

describe('conversationForProject (open a project’s channel without asking the server)', () => {
  it('finds the channel the inbox already has', () => {
    expect(conversationForProject([summary('c1'), channel('c2', 'p1')], 'p1')).toBe('c2');
  });
  it('is null for a channel nobody has opened yet', () => {
    expect(conversationForProject([channel('c2', 'p1')], 'p9')).toBeNull();
    expect(conversationForProject(undefined, 'p1')).toBeNull();
  });
});

describe('conversationTitle (a thread opened from a notification knows only its id)', () => {
  const nameOf = (id: string) => (id === 'u2' ? 'Sara Ali' : 'Someone');
  it('names a channel after its project, and a direct conversation after the other person', () => {
    expect(conversationTitle({ summary: channel('c2', 'p1'), projects: [{ id: 'p1', name: 'Tower A' }], nameOf, myId: 'me' })).toBe('Tower A');
    expect(conversationTitle({ summary: summary('c1'), projects: [], nameOf, myId: 'me' })).toBe('Sara Ali');
  });
  it('falls back to plain words, or to the title it was opened with', () => {
    expect(conversationTitle({ summary: channel('c2', 'p1'), projects: [], nameOf, myId: 'me' })).toBe('Project channel');
    expect(conversationTitle({ summary: undefined, projects: [], nameOf, myId: 'me', fallback: 'Tower A' })).toBe('Tower A');
    expect(conversationTitle({ summary: undefined, projects: [], nameOf, myId: 'me' })).toBe('Chat');
  });
});

describe('chatMemberIds (who is in the conversation)', () => {
  it('a direct conversation: its two people, from the inbox', () => {
    expect(chatMemberIds({ summary: summary('c1'), members: undefined })).toEqual(['me', 'u2']);
  });
  it('a channel: the project’s people, from the server', () => {
    expect(chatMemberIds({ summary: channel('c2', 'p1'), members: ['me', 'u3'] })).toEqual(['me', 'u3']);
  });
  it('unknown until the conversation (or its members) has loaded', () => {
    expect(chatMemberIds({ summary: channel('c2', 'p1'), members: undefined })).toBeNull();
    expect(chatMemberIds({ summary: undefined, members: undefined })).toBeNull();
    expect(chatMemberIds({ summary: undefined, members: ['me', 'u3'] })).toEqual(['me', 'u3']);
  });
});

describe('mentionPeopleFor (only the conversation’s members can be mentioned)', () => {
  const directory = [person('me', 'me.user', 'Me'), person('u2', 'sara', 'Sara', 'Ali'), person('u3', 'omar', 'Omar'), person('u4', 'layla')];
  it('offers the members, never yourself, never anyone outside the conversation', () => {
    expect(mentionPeopleFor(['me', 'u2', 'u3'], directory, 'me')).toEqual([
      { id: 'u2', username: 'sara', name: 'Sara Ali' },
      { id: 'u3', username: 'omar', name: 'Omar' },
    ]);
  });
  it('offers no one while the members are unknown', () => {
    expect(mentionPeopleFor(null, directory, 'me')).toEqual([]);
  });
  it('skips a member the directory doesn’t list, or whose account is no longer active', () => {
    const withInactive = [...directory, { ...person('u5', 'old.hand'), active: false }];
    expect(mentionPeopleFor(['u2', 'gone', 'u5'], withInactive, 'me').map((p) => p.id)).toEqual(['u2']);
  });
});

describe('shouldMarkRead (messages arriving while the thread is open are read)', () => {
  it('marks read while the thread is on screen and the app is in front, when something is unread', () => {
    expect(shouldMarkRead({ focused: true, appActive: true, unread: 2 })).toBe(true);
  });
  it('not while the thread is covered or the app is in the background, or when nothing is unread', () => {
    expect(shouldMarkRead({ focused: false, appActive: true, unread: 2 })).toBe(false);
    expect(shouldMarkRead({ focused: true, appActive: false, unread: 2 })).toBe(false);
    expect(shouldMarkRead({ focused: true, appActive: true, unread: 0 })).toBe(false);
  });
});

import { chatTabBadge, chatTabLabel, openChannelError, threadLoadError } from './chat';
import { ApiError as ChatApiError, NetworkError as ChatNetworkError } from './api-client';

describe('chatTabBadge / chatTabLabel (the Chat tab)', () => {
  it('shows the number, capped, and nothing at 0', () => {
    expect(chatTabBadge(0)).toBeUndefined();
    expect(chatTabBadge(7)).toBe(7);
    expect(chatTabBadge(120)).toBe('99+');
  });
  it('says it to TalkBack', () => {
    expect(chatTabLabel(0)).toBe('Chat');
    expect(chatTabLabel(1)).toBe('Chat, 1 unread message');
    expect(chatTabLabel(5)).toBe('Chat, 5 unread messages');
  });
});

describe('openChannelError (opening a project’s channel the server must create first)', () => {
  it('says why, in plain words', () => {
    expect(openChannelError(new ChatNetworkError('offline'), 'Tower A')).toBe('Couldn’t open #Tower A — you’re offline. Try again when connected.');
    expect(openChannelError(new ChatApiError(403, 'FORBIDDEN', 'No.'), 'Tower A')).toBe(
      'You can’t open #Tower A because you aren’t a member of this project. Ask the project’s manager to add you to the team.',
    );
    expect(openChannelError(new ChatApiError(404, 'NOT_FOUND', 'Project not found.'), 'Tower A')).toBe('Project not found.');
    expect(openChannelError(new Error('?'), 'Tower A')).toBe('Couldn’t open #Tower A. Please try again.');
  });
});

describe('threadLoadError (a conversation that didn’t load)', () => {
  it('passes on the server’s reason for a refusal, else asks to check the connection', () => {
    expect(threadLoadError(new ChatApiError(403, 'FORBIDDEN', 'You do not have access to this conversation.'))).toBe('You do not have access to this conversation.');
    expect(threadLoadError(new ChatNetworkError('offline'))).toBe('Couldn’t load this conversation. Check your connection and try again.');
    expect(threadLoadError(new ChatApiError(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t load this conversation. Check your connection and try again.');
  });
});
