import { describe, it, expect } from 'vitest';
import { notificationTarget } from './notification-links';

describe('notificationTarget', () => {
  it('opens the related task (entity type in any case)', () => {
    expect(notificationTarget({ entityType: 'task', entityId: 't1' })).toEqual({ kind: 'task', taskId: 't1' });
    expect(notificationTarget({ entityType: 'TASK', entityId: 't2' })).toEqual({ kind: 'task', taskId: 't2' });
  });

  it('opens the conversation a chat notification is about (not just the Chat page)', () => {
    expect(notificationTarget({ entityType: 'conversation', entityId: 'c1' })).toEqual({ kind: 'path', to: '/chat?conversation=c1' });
    expect(notificationTarget({ entityType: 'conversation', entityId: null })).toEqual({ kind: 'path', to: '/chat' });
  });

  it('ignores notifications with nothing to open', () => {
    expect(notificationTarget({ entityType: 'digest', entityId: null })).toBeNull();
    expect(notificationTarget({ entityType: null, entityId: null })).toBeNull();
  });
});
