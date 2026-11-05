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
  it('reads whole dotted/hyphenated and Arabic names', () => {
    expect(parseMentions('@ahmed.ali @أحمد')).toEqual(['ahmed.ali', 'أحمد']);
  });
});

function inMemory(tasks: string[]) {
  const rows = new Map<string, CommentRecord>();
  let seq = 0;
  const repo: CommentRepository = {
    async create(taskId, userId, body, parentId, extra) {
      const rec: CommentRecord = { id: `c${seq++}`, taskId, userId, body, parentId: parentId ?? null, editedAt: null, createdAt: new Date(), fromClient: extra?.fromClient ?? false, clientVisible: extra?.clientVisible ?? false };
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

  it('gives the mention hook the comment’s text (for the email)', async () => {
    const bodies: string[] = [];
    const svc = createCommentService({
      ...inMemory(['t1']),
      onMention: (_taskId, _authorId, _usernames, body) => { bodies.push(body ?? ''); },
    });
    await svc.addComment('t1', 'u1', 'ping @ada please');
    expect(bodies).toEqual(['ping @ada please']);
  });

  it('matches mentions against the usernames of people who can open the task', async () => {
    const calls: string[][] = [];
    const mem = inMemory(['t1']);
    const svc = createCommentService({
      ...mem,
      // Who can open t1 — "zed" (not listed) has no access to the task's project.
      repo: { ...mem.repo, async listMentionableUsernames() { return ['ahmed', 'ahmed.ali', 'mico']; } },
      onMention: (_taskId, _authorId, usernames) => { calls.push(usernames); },
    });
    await svc.addComment('t1', 'u1', 'ping @ahmed.ali and @zed, mail sales@mico.om');
    expect(calls).toEqual([['ahmed.ali']]);
  });

  it('lists the people who can be mentioned on a task (the people an @mention would notify)', async () => {
    const mem = inMemory(['t1']);
    const people = [{ id: 'u2', username: 'ahmed.ali', firstName: 'Ahmed', lastName: 'Ali', avatarUrl: null }];
    const svc = createCommentService({ ...mem, repo: { ...mem.repo, async listMentionable() { return people; } } });
    expect(await svc.mentionable('t1')).toEqual(people);
    await expect(svc.mentionable('nope')).rejects.toThrow(/not found/i);
  });

  it('does not fire onMention when nobody with access is mentioned', async () => {
    let fired = false;
    const mem = inMemory(['t1']);
    const svc = createCommentService({
      ...mem,
      repo: { ...mem.repo, async listMentionableUsernames() { return ['ada']; } },
      onMention: () => { fired = true; },
    });
    await svc.addComment('t1', 'u1', 'hello @stranger');
    expect(fired).toBe(false);
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

describe('CommentService — the task search index follows its comments', () => {
  it('tells onChanged about the task after a comment is added, edited or deleted', async () => {
    const changed: string[] = [];
    const svc = createCommentService({ ...inMemory(['t1']), onChanged: (taskId) => void changed.push(taskId) });
    const c = await svc.addComment('t1', 'u1', 'scaffold');
    await svc.editComment(c.id, 'u1', 'scaffold permit');
    await svc.deleteComment(c.id, 'u1', false);
    expect(changed).toEqual(['t1', 't1', 't1']);
  });

  it('a refused change tells nothing', async () => {
    const changed: string[] = [];
    const svc = createCommentService({ ...inMemory(['t1']), onChanged: (taskId) => void changed.push(taskId) });
    const c = await svc.addComment('t1', 'u1', 'mine');
    await expect(svc.editComment(c.id, 'u2', 'not yours')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.deleteComment(c.id, 'u2', false)).rejects.toBeInstanceOf(ForbiddenError);
    expect(changed).toEqual(['t1']);
  });
});

// 1.23 Client accounts: a team reply the client may see ("Visible to client").
describe('CommentService — Visible to client', () => {
  it('only a reply to a client’s comment can be shown to the client (400 otherwise)', async () => {
    const { repo, taskLookup } = inMemory(['t1']);
    const replies: string[] = [];
    const svc = createCommentService({ repo, taskLookup, onClientReply: (c) => void replies.push(c.id) });
    const fromClient = await repo.create('t1', 'client-1', 'Is the pump in?', null, { fromClient: true });
    const staff = await svc.addComment('t1', 'omar', 'Internal note');
    await expect(svc.addComment('t1', 'omar', 'Shown?', null, { clientVisible: true })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
    await expect(svc.addComment('t1', 'omar', 'Shown?', staff.id, { clientVisible: true })).rejects.toMatchObject({ status: 400 });
    const reply = await svc.addComment('t1', 'omar', 'Yes, Monday.', fromClient.id, { clientVisible: true });
    expect(reply).toMatchObject({ parentId: fromClient.id, clientVisible: true, fromClient: false });
    expect(replies).toEqual([reply.id]);
    // An unticked reply stays with the team, and nobody is emailed.
    const internal = await svc.addComment('t1', 'omar', 'Check stock first', fromClient.id);
    expect(internal.clientVisible).toBe(false);
    expect(replies).toEqual([reply.id]);
  });
});
