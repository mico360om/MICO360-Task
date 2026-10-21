import { describe, it, expect } from 'vitest';
import { threadComments } from './comment-thread.js';

const c = (id, minute, parentId = null, extra = {}) => ({ id, userId: 'u1', body: id, parentId, createdAt: `2026-10-21T09:${String(minute).padStart(2, '0')}:00.000Z`, ...extra });
const shape = (threads) => threads.map((t) => [t.comment.id, t.replies.map((r) => (r.replyTo ? `${r.comment.id}>${r.replyTo.id}` : r.comment.id))]);

describe('threadComments — comments with their replies under them', () => {
  it('top-level comments oldest first, each with its replies oldest first', () => {
    const list = [c('b', 5), c('a', 1), c('a2', 7, 'a'), c('a1', 3, 'a'), c('b1', 6, 'b')];
    expect(shape(threadComments(list))).toEqual([['a', ['a1', 'a2']], ['b', ['b1']]]);
  });

  it('a reply to a reply stays in the same thread and says whom it answers', () => {
    const list = [c('a', 1), c('a1', 2, 'a'), c('a1x', 3, 'a1'), c('a1xy', 4, 'a1x')];
    expect(shape(threadComments(list))).toEqual([['a', ['a1', 'a1x>a1', 'a1xy>a1x']]]);
  });

  it('a reply whose comment was deleted is shown on its own, not lost', () => {
    const list = [c('a', 1), c('orphan', 2, 'gone'), c('o1', 3, 'orphan')];
    expect(shape(threadComments(list))).toEqual([['a', []], ['orphan', ['o1']]]);
  });

  it('a reply still waiting to sync joins its thread; nothing loops forever on bad data', () => {
    const list = [c('a', 1), c('tmp-q1', 9, 'a', { pending: true }), c('x', 2, 'y'), c('y', 3, 'x'), c('self', 4, 'self')];
    const out = threadComments(list);
    expect(out.find((t) => t.comment.id === 'a').replies.map((r) => r.comment.id)).toEqual(['tmp-q1']);
    expect(out.flatMap((t) => [t.comment.id, ...t.replies.map((r) => r.comment.id)]).sort()).toEqual(['a', 'self', 'tmp-q1', 'x', 'y']);
  });

  it('same-time comments keep the server’s order; no comments, no threads', () => {
    expect(shape(threadComments([c('first', 1), c('second', 1)]))).toEqual([['first', []], ['second', []]]);
    expect(threadComments([])).toEqual([]);
    expect(threadComments(undefined)).toEqual([]);
  });
});
