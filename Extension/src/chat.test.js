import { describe, it, expect } from 'vitest';
import { unreadTotal, describeConversations, badgeText } from './chat.js';

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

describe('badgeText', () => {
  it('renders 0 as empty, caps at 9+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(5)).toBe('5');
    expect(badgeText(12)).toBe('9+');
  });
});
