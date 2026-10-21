import { describe, it, expect, vi } from 'vitest';
import {
  CHAT_DELETE,
  CHAT_EDIT,
  CHAT_REACT,
  deleteDialog,
  editProblem,
  messageActions,
  reactionLabel,
  replyQuoteOf,
  withQueuedChatChanges,
} from './chat-actions';
import { performMutation, describeMutation, refreshesAfterReplay } from './perform-mutation';
import { replayLane, writeTarget } from './write-order';
import type { ResourcesApi } from './resources';
import type { QueuedMutation } from './sync-queue';
import type { ApiChatMessage } from './types';

const msg = (id: string, over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id,
  conversationId: 'c1',
  userId: 'me',
  body: `text ${id}`,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-10-21T08:00:00.000Z',
  reactions: [],
  attachments: [],
  ...over,
});
const queued = (kind: string, payload: unknown, id = 'q'): QueuedMutation => ({ id, kind, payload, createdAt: 0, userId: 'me', idempotencyKey: 'k', attempts: 0, status: 'pending' });
const nameOf = (id: string) => (id === 'me' ? 'You' : ({ u2: 'Sara Ali', u3: 'Omar Said' })[id] ?? 'Someone');

describe('what can be done with a message (the website’s rules, 3b)', () => {
  it('mine: react, reply, copy, edit and delete; someone else’s: no edit, and delete only for an admin', () => {
    expect(messageActions(msg('a'), { myId: 'me', isAdmin: false })).toEqual({ react: true, reply: true, copy: true, edit: true, remove: true });
    expect(messageActions(msg('b', { userId: 'u2' }), { myId: 'me', isAdmin: false })).toEqual({ react: true, reply: true, copy: true, edit: false, remove: false });
    expect(messageActions(msg('b', { userId: 'u2' }), { myId: 'me', isAdmin: true })).toMatchObject({ edit: false, remove: true });
  });
  it('a deleted message: nothing; a file without words: no copy or edit; one still on its way: nothing', () => {
    expect(messageActions(msg('a', { deletedAt: 'x', body: '' }), { myId: 'me', isAdmin: true })).toEqual({ react: false, reply: false, copy: false, edit: false, remove: false });
    expect(messageActions(msg('a', { body: ' ' }), { myId: 'me', isAdmin: false })).toEqual({ react: true, reply: true, copy: false, edit: false, remove: true });
    expect(messageActions({ ...msg('a'), pending: 'sending' }, { myId: 'me', isAdmin: false })).toEqual({ react: false, reply: false, copy: false, edit: false, remove: false });
  });
  it('an edit needs words, within the limit — an empty one is a delete', () => {
    expect(editProblem('   ')).toBe('A message can’t be empty — delete it instead.');
    expect(editProblem('x'.repeat(4001))).toBe('Messages can be up to 4,000 characters. This one has 4,001.');
    expect(editProblem(' fine ')).toBeNull();
  });
  it('asks before deleting, in the website’s words', () => {
    expect(deleteDialog(msg('a'), 'me', nameOf)).toEqual({
      title: 'Delete this message?',
      message: 'It will be removed for everyone in the conversation. This can’t be undone.',
      confirm: 'Yes, delete',
      keep: 'Keep',
    });
    expect(deleteDialog(msg('a', { userId: 'u2' }), 'me', nameOf).message).toBe('Sara Ali’s message will be removed for everyone. This can’t be undone.');
  });
  it('reads a reaction to TalkBack: the emoji, how many, who, and what a tap does', () => {
    expect(reactionLabel({ emoji: '👍', userIds: ['me', 'u2', 'u3'] }, 'me', nameOf)).toBe('👍 3: You, Sara Ali and Omar Said. Tap to take back your reaction.');
    expect(reactionLabel({ emoji: '🎉', userIds: ['u2'] }, 'me', nameOf)).toBe('🎉 1: Sara Ali. Tap to react with 🎉 too.');
  });
  it('quotes the message answered (up to 200 characters, as the server does)', () => {
    expect(replyQuoteOf(msg('a', { userId: 'u2', body: 'y'.repeat(250) }))).toEqual({ id: 'a', userId: 'u2', body: 'y'.repeat(200), deleted: false });
  });
});

describe('edits, deletions and reactions kept on the phone (offline, 3b)', () => {
  it('go in order per message, apart from other messages and from sending', () => {
    const edit = queued(CHAT_EDIT, { conversationId: 'c1', messageId: 'm1', body: 'new' });
    const del = queued(CHAT_DELETE, { conversationId: 'c1', messageId: 'm1' });
    const react = queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm1', emoji: '👍', add: true });
    expect(writeTarget(edit.kind, edit.payload)).toBe('chatmsg:m1');
    expect(writeTarget(del.kind, del.payload)).toBe('chatmsg:m1');
    expect(writeTarget(react.kind, react.payload)).toBe('chatmsg:m1');
    expect(writeTarget(CHAT_EDIT, { messageId: 'm2' })).toBe('chatmsg:m2');
    expect(replayLane(edit)).not.toBe(replayLane(queued('chat.send', { conversationId: 'c1' })));
  });

  it('are shown at once over the loaded messages: the new words, the deletion, the reaction', () => {
    const shown = withQueuedChatChanges(
      [msg('m1'), msg('m2', { reactions: [{ emoji: '👍', userIds: ['u2'] }] }), msg('m3')],
      [
        queued(CHAT_EDIT, { conversationId: 'c1', messageId: 'm1', body: 'fixed words' }),
        queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm2', emoji: '👍', add: true }),
        queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm2', emoji: '🎉', add: true }),
        queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm2', emoji: '🎉', add: false }),
        queued(CHAT_DELETE, { conversationId: 'c1', messageId: 'm3' }),
      ],
      'me',
    );
    expect(shown[0]).toMatchObject({ body: 'fixed words' });
    expect(shown[0]!.editedAt).not.toBeNull();
    expect(shown[1]!.reactions).toEqual([{ emoji: '👍', userIds: ['u2', 'me'] }]);
    expect(shown[2]).toMatchObject({ body: '', reactions: [], attachments: [] });
    expect(shown[2]!.deletedAt).not.toBeNull();
    // Nothing waiting: the same list back.
    const list = [msg('m1')];
    expect(withQueuedChatChanges(list, [], 'me')).toBe(list);
  });

  it('replay against the server, and are described in the sync list', async () => {
    const chat = { edit: vi.fn(async () => msg('m1', { body: 'new', editedAt: 'now' })), remove: vi.fn(async () => undefined), addReaction: vi.fn(async () => undefined), removeReaction: vi.fn(async () => undefined) };
    const resources = { chat } as unknown as ResourcesApi;
    await expect(performMutation(resources, queued(CHAT_EDIT, { conversationId: 'c1', messageId: 'm1', body: 'new' }))).resolves.toMatchObject({ body: 'new' });
    await performMutation(resources, queued(CHAT_DELETE, { conversationId: 'c1', messageId: 'm1' }));
    await performMutation(resources, queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm1', emoji: '👍', add: true }));
    await performMutation(resources, queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm1', emoji: '👍', add: false }));
    expect(chat.edit).toHaveBeenCalledWith('m1', 'new');
    expect(chat.remove).toHaveBeenCalledWith('m1');
    expect(chat.addReaction).toHaveBeenCalledWith('m1', '👍');
    expect(chat.removeReaction).toHaveBeenCalledWith('m1', '👍');
    expect(describeMutation(queued(CHAT_EDIT, { body: 'new words' }))).toBe('Edit a message: “new words”');
    expect(describeMutation(queued(CHAT_DELETE, {}))).toBe('Delete a message');
    expect(describeMutation(queued(CHAT_REACT, { emoji: '👍', add: true }))).toBe('React with 👍');
    expect(describeMutation(queued(CHAT_REACT, { emoji: '👍', add: false }))).toBe('Take back a 👍 reaction');
    // The thread gets the server's copy in place (chat-cache); the list's last message is fetched again.
    expect(refreshesAfterReplay(queued(CHAT_EDIT, { conversationId: 'c1', messageId: 'm1' }))).toEqual([{ queryKey: ['chat', 'conversations'] }]);
    // A reaction is shown at once; once sent (or refused) the thread is read again as the server has it.
    expect(refreshesAfterReplay(queued(CHAT_REACT, { conversationId: 'c1', messageId: 'm1' }))).toEqual([{ queryKey: ['chat', 'messages', 'c1'] }]);
  });
});
