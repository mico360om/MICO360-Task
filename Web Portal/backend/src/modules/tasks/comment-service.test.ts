import { describe, it, expect } from 'vitest';
import { parseMentions, createCommentService } from './comment-service';
import type { CommentRecord, CommentRepository } from './comment-repository';
import type { TaskLookup } from './assignee-repository';
import { ForbiddenError, NotFoundError } from '../../lib/http-errors';

describe('parseMentions', () => {
  it('extracts @usernames', () => {
    expect(parseMentions('hey @ada and @omar, look at this')).toEqual(['ada', 'omar']);
  });
  it('de-duplicates mentions', () => {
    expect(parseMentions('@ada @ada @ada')).toEqual(['ada']);
  });
  it('returns an empty array when there are no mentions', () => {
    expect(parseMentions('no mentions here')).toEqual([]);
  });
});

function inMemory(tasks: string[]) {
  const rows = new Map<string, CommentRecord>();
  let seq = 0;
  const repo: CommentRepository = {
    async create(taskId, userId, body, parentId) {
      const rec: CommentRecord = { id: `c${seq++}`, taskId, userId, body, parentId: parentId ?? null, editedAt: null, createdAt: new Date() };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list(taskId) {
      return [...rows.values()].filter((c) => c.taskId === taskId);
    },
    async update(id, body) {
      const rec = { ...rows.get(id)!, body, editedAt: new Date() };
      rows.set(id, rec);
      return rec;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return tasks.includes(id); } };
  return { repo, taskLookup };
}

describe('CommentService', () => {
  it('adds a comment and lists it', async () => {
    const svc = createCommentService(inMemory(['t1']));
    await svc.addComment('t1', 'u1', 'first!');
    const list = await svc.listComments('t1');
    expect(list).toHaveLength(1);
    expect(list[0]!.body).toBe('first!');
  });

  it('throws NotFound when commenting on an unknown task', async () => {
    const svc = createCommentService(inMemory(['t1']));
    await expect(svc.addComment('ghost', 'u1', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets the author edit their comment', async () => {
    const svc = createCommentService(inMemory(['t1']));
    const c = await svc.addComment('t1', 'u1', 'typo');
    const updated = await svc.editComment(c.id, 'u1', 'fixed');
    expect(updated.body).toBe('fixed');
    expect(updated.editedAt).not.toBeNull();
  });

  it('forbids a different user from editing a comment', async () => {
    const svc = createCommentService(inMemory(['t1']));
    const c = await svc.addComment('t1', 'u1', 'mine');
    await expect(svc.editComment(c.id, 'u2', 'hacked')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets an admin delete anyone’s comment but forbids other users', async () => {
    const svc = createCommentService(inMemory(['t1']));
    const c = await svc.addComment('t1', 'u1', 'mine');
    await expect(svc.deleteComment(c.id, 'u2', false)).rejects.toBeInstanceOf(ForbiddenError);
    await svc.deleteComment(c.id, 'u2', true); // admin
    expect(await svc.listComments('t1')).toHaveLength(0);
  });

  it('fires onMention with the task, author, and mentioned usernames', async () => {
    const calls: { taskId: string; authorId: string; usernames: string[] }[] = [];
    const svc = createCommentService({
      ...inMemory(['t1']),
      onMention: (taskId, authorId, usernames) => { calls.push({ taskId, authorId, usernames }); },
    });
    await svc.addComment('t1', 'u1', 'ping @ada and @omar');
    expect(calls).toEqual([{ taskId: 't1', authorId: 'u1', usernames: ['ada', 'omar'] }]);
  });

  it('does not fire onMention when there are no mentions', async () => {
    let fired = false;
    const svc = createCommentService({ ...inMemory(['t1']), onMention: () => { fired = true; } });
    await svc.addComment('t1', 'u1', 'no mentions here');
    expect(fired).toBe(false);
  });

  it('creates a threaded reply and rejects a reply to a non-existent/other-task parent', async () => {
    const svc = createCommentService(inMemory(['t1', 't2']));
    const parent = await svc.addComment('t1', 'u1', 'top-level');
    const reply = await svc.addComment('t1', 'u2', 'a reply', parent.id);
    expect(reply.parentId).toBe(parent.id);

    await expect(svc.addComment('t1', 'u1', 'bad', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    // parent belongs to t1, so replying under t2 must fail
    await expect(svc.addComment('t2', 'u1', 'wrong task', parent.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fires onComment on every comment (used to notify the task assignees)', async () => {
    const calls: { taskId: string; authorId: string; commentId: string }[] = [];
    const svc = createCommentService({
      ...inMemory(['t1']),
      onComment: (taskId, authorId, commentId) => { calls.push({ taskId, authorId, commentId }); },
    });
    const c = await svc.addComment('t1', 'u1', 'no mentions, still notifies assignees');
    expect(calls).toEqual([{ taskId: 't1', authorId: 'u1', commentId: c.id }]);
  });
});
