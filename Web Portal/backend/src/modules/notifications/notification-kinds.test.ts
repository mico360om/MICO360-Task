import { describe, it, expect } from 'vitest';
import { NOTIFICATION_KINDS, KIND_KEYS, typesOfKinds, kindOfType, unreadByKind, encodeNotificationCursor, decodeNotificationCursor } from './notification-kinds';
import { ValidationError } from '../../lib/http-errors';

describe('the Notifications page’s type chips (1.22)', () => {
  it('six chips, in the page’s order, each made of the notification types the server sends', () => {
    expect(KIND_KEYS).toEqual(['mentions', 'assigned', 'due', 'comments', 'approvals', 'meetings']);
    expect(NOTIFICATION_KINDS).toEqual({
      mentions: ['MENTION', 'CHAT_MENTION'],
      assigned: ['TASK_ASSIGNED'],
      due: ['TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_ESCALATION'],
      comments: ['TASK_COMMENT'],
      approvals: ['TASK_APPROVAL'],
      meetings: ['MEETING_REMINDER'],
    });
  });

  it('no type is in two chips (the chips’ counts add up)', () => {
    const all = Object.values(NOTIFICATION_KINDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('chips → their types, in order, once each; none = every type', () => {
    expect(typesOfKinds(['due', 'mentions'])).toEqual(['MENTION', 'CHAT_MENTION', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_ESCALATION']);
    expect(typesOfKinds(['comments', 'comments'])).toEqual(['TASK_COMMENT']);
    expect(typesOfKinds([])).toBeUndefined();
    expect(typesOfKinds(undefined)).toBeUndefined();
  });

  it('a type → its chip; the types in no chip (status changes, direct messages, “added to a project”, the digest) → none', () => {
    expect(kindOfType('CHAT_MENTION')).toBe('mentions');
    expect(kindOfType('TASK_ESCALATION')).toBe('due');
    for (const t of ['TASK_STATUS', 'CHAT_MESSAGE', 'PROJECT_ADDED', 'TASK_DIGEST', 'SOMETHING_NEW']) expect(kindOfType(t)).toBeNull();
  });

  it('unread counts per type → per chip, and the total over every type', () => {
    expect(unreadByKind({ MENTION: 2, CHAT_MENTION: 1, TASK_OVERDUE: 4, TASK_STATUS: 5, MEETING_REMINDER: 1 })).toEqual({
      unread: 13,
      kinds: { mentions: 3, assigned: 0, due: 4, comments: 0, approvals: 0, meetings: 1 },
    });
    expect(unreadByKind({})).toEqual({ unread: 0, kinds: { mentions: 0, assigned: 0, due: 0, comments: 0, approvals: 0, meetings: 0 } });
  });
});

describe('the list’s cursor: the last row shown (its time and id), opaque to the apps', () => {
  it('round-trips, and differs for two rows of the same moment', () => {
    const at = new Date('2026-11-03T09:05:00.123Z');
    const a = encodeNotificationCursor({ createdAt: at, id: 'ckaaa' });
    const b = encodeNotificationCursor({ createdAt: at, id: 'ckbbb' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeNotificationCursor(a)).toEqual({ createdAt: at, id: 'ckaaa' });
  });

  it('none → from the newest; anything else that isn’t one → 400', () => {
    expect(decodeNotificationCursor(undefined)).toBeUndefined();
    expect(decodeNotificationCursor('')).toBeUndefined();
    for (const bad of ['nonsense', Buffer.from('n:not-a-date|x').toString('base64url'), Buffer.from('n:2026-11-03T09:05:00.000Z|').toString('base64url'), Buffer.from('o:20').toString('base64url')]) {
      expect(() => decodeNotificationCursor(bad), bad).toThrow(ValidationError);
    }
  });
});
