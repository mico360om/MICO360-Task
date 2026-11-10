import { describe, it, expect } from 'vitest';
import { createCommentNotifier, type CommentNotice } from './comment-notifier';

function world(opts: { followers?: string[]; canOpen?: string[] } = {}) {
  const sent: CommentNotice[] = [];
  const canOpen = new Set(opts.canOpen ?? ['u1', 'u2', 'u3', 'u4']);
  const notifier = createCommentNotifier({
    recipients: async (_taskId, authorId) => (opts.followers ?? ['u2', 'u3']).filter((id) => id !== authorId && canOpen.has(id)),
    visibleRecipients: async (_taskId, ids, authorId) => ids.filter((id) => id !== authorId && canOpen.has(id)),
    userIdsByUsername: async (names) => names.map((n) => ({ sara: 'u2', omar: 'u3', ada: 'u1' })[n]).filter((x): x is string => Boolean(x)),
    taskNotice: async () => 'MICO-7 Fix the valve',
    authorName: async (id) => ({ u1: 'Ada Lovelace', u2: 'Sara Ali', u4: 'Khalid Said' })[id] ?? 'A teammate',
    notify: async (n) => void sent.push(n),
  });
  return { notifier, sent };
}

describe('comment notices (owner, 10 Nov 2026: the person replied to gets a notice)', () => {
  it('a plain comment: its followers hear "New comment on your task", as before', async () => {
    const { notifier, sent } = world();
    await notifier('t1', 'u1', 'c1', { repliedToUserId: null, mentioned: [] });
    expect(sent.map((n) => [n.userId, n.type, n.title])).toEqual([
      ['u2', 'TASK_COMMENT', 'New comment on your task'],
      ['u3', 'TASK_COMMENT', 'New comment on your task'],
    ]);
    expect(sent[0]).toMatchObject({ body: 'MICO-7 Fix the valve', entityType: 'task', entityId: 't1' });
  });

  it('a reply: the person answered hears "<name> replied to your comment" — once (not also the follower notice)', async () => {
    const { notifier, sent } = world();
    await notifier('t1', 'u4', 'c2', { repliedToUserId: 'u2', mentioned: [] });
    expect(sent.map((n) => [n.userId, n.title])).toEqual([
      ['u2', 'Khalid Said replied to your comment'],
      ['u3', 'New comment on your task'],
    ]);
    expect(sent[0]!.type).toBe('TASK_COMMENT');
  });

  it('someone answered who isn’t following the task still hears it, while they can open the task', async () => {
    const { notifier, sent } = world({ followers: ['u3'] });
    await notifier('t1', 'u4', 'c2', { repliedToUserId: 'u1', mentioned: [] });
    expect(sent.map((n) => n.userId)).toEqual(['u1', 'u3']);
    const off = world({ followers: [], canOpen: ['u4'] });
    await off.notifier('t1', 'u4', 'c2', { repliedToUserId: 'u1', mentioned: [] });
    expect(off.sent).toEqual([]);
  });

  it('answered and @mentioned in the reply: the mention notice says it — no second notice', async () => {
    const { notifier, sent } = world();
    await notifier('t1', 'u4', 'c2', { repliedToUserId: 'u2', mentioned: ['sara'] });
    expect(sent.map((n) => [n.userId, n.title])).toEqual([['u3', 'New comment on your task']]);
  });

  it('never tells the writer', async () => {
    const { notifier, sent } = world({ followers: ['u2'] });
    await notifier('t1', 'u2', 'c2', { repliedToUserId: 'u2', mentioned: [] });
    expect(sent).toEqual([]);
  });

  it('an older caller without the reply facts: followers only', async () => {
    const { notifier, sent } = world();
    await notifier('t1', 'u1', 'c1');
    expect(sent.map((n) => n.userId)).toEqual(['u2', 'u3']);
  });
});
