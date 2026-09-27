import { describe, it, expect } from 'vitest';
import {
  unreadTotal, describeConversations, badgeText, messagePreview, sanitizeMessage, sanitizeMessages, sanitizeSummaries, DELETED_PREVIEW,
} from './chat.js';

const summary = (over = {}) => ({
  conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' },
  participants: [],
  unread: 0,
  lastMessage: null,
  ...over,
});

describe('unreadTotal', () => {
  it('sums unread across conversations', () => {
    expect(unreadTotal([summary({ unread: 3 }), summary({ unread: 2 })])).toBe(5);
  });
  it('handles empty / missing input', () => {
    expect(unreadTotal([])).toBe(0);
    expect(unreadTotal(undefined)).toBe(0);
  });
});

describe('describeConversations', () => {
  const directory = [{ id: 'u2', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }];
  const projectNames = { p1: 'Mobile App' };

  it('titles a project channel from the project name and a DM from the other participant', () => {
    const rows = describeConversations(
      [
        summary({ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, unread: 1, lastMessage: { body: 'hi channel' } }),
        summary({ conversation: { id: 'c2', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [{ userId: 'me' }, { userId: 'u2' }], unread: 4, lastMessage: { body: 'dm hi' } }),
      ],
      { directory, myId: 'me', projectNames },
    );
    // sorted most-unread first: the DM (4) before the channel (1)
    expect(rows[0].title).toBe('Ada Lovelace');
    expect(rows[0].preview).toBe('dm hi');
    expect(rows[1].title).toBe('Mobile App');
    expect(rows[1].unread).toBe(1);
  });

  it('falls back gracefully when names are unknown', () => {
    const rows = describeConversations([summary({ conversation: { id: 'c3', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [{ userId: 'me' }, { userId: 'zzz' }] })], { myId: 'me' });
    expect(rows[0].title).toBe('Direct message');
  });
});

describe('deleted messages (CHAT-01)', () => {
  const deleted = { id: 'm1', body: 'my password is hunter2', deletedAt: '2026-09-26T10:00:00Z', attachments: [{ name: 'secret.pdf' }] };

  it('the inbox preview never shows a deleted message’s text', () => {
    const rows = describeConversations([summary({ lastMessage: deleted })], { projectNames: { p1: 'Ops' } });
    expect(rows[0].preview).toBe(DELETED_PREVIEW);
    expect(messagePreview(deleted)).toBe(DELETED_PREVIEW);
    expect(messagePreview({ body: 'hello' })).toBe('hello');
    expect(messagePreview(null)).toBe('');
  });

  it('sanitizes messages and inbox summaries before they are cached', () => {
    expect(sanitizeMessage(deleted)).toMatchObject({ id: 'm1', body: '', attachments: [], deletedAt: deleted.deletedAt });
    expect(sanitizeMessage({ id: 'm2', body: 'ok' })).toEqual({ id: 'm2', body: 'ok' });
    expect(sanitizeMessages([deleted])[0].body).toBe('');
    expect(sanitizeSummaries([summary({ lastMessage: deleted }), summary()])[0].lastMessage.body).toBe('');
    expect(sanitizeMessages(undefined)).toBeUndefined();
  });
});

describe('badgeText', () => {
  it('renders 0 as empty, caps at 9+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(5)).toBe('5');
    expect(badgeText(12)).toBe('9+');
  });
});
