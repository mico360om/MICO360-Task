import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { CommentRecord, CommentRepository, MentionablePerson } from './comment-repository';
import type { TaskLookup } from './assignee-repository';
import { matchMentions, parseMentions } from './mentions';

/** Extract unique @usernames from a comment body (Unicode names, dots and hyphens included). */
export { parseMentions };

export interface CommentServiceDeps {
  repo: CommentRepository;
  taskLookup: TaskLookup;
  /**
   * Fired when a new comment @mentions users, with their exact usernames. When the repository
   * lists who can open the task, only those users are ever passed here.
   */
  onMention?: (taskId: string, authorId: string, usernames: string[], body?: string) => void | Promise<void>;
  /**
   * Fired on every new comment (used to notify the task's assignees, excluding the author). `info`: for a reply, the
   * team member whose comment it answers (never the writer, never a client — clients have their own notices), and the
   * usernames @mentioned in it (so nobody is told twice).
   */
  onComment?: (taskId: string, authorId: string, commentId: string, info: CommentNoticeInfo) => void | Promise<void>;
  /** After a change to the words of a task (the task search index re-reads it). */
  onChanged?: (taskId: string) => void | Promise<void>;
  /** 1.23: a team reply marked "Visible to client" was added to a client's comment (their email). */
  onClientReply?: (reply: CommentRecord) => void | Promise<void>;
}

/** Who a new comment answers and mentions (owner, 10 Nov 2026: the person replied to gets a notice). */
export interface CommentNoticeInfo {
  repliedToUserId: string | null;
  mentioned: string[];
}

/** How far up a reply chain (older data) the server walks to find a thread's top comment. */
const MAX_THREAD_HOPS = 20;

/** 1.23: why a comment can't be shown to the client. */
export const NOT_A_CLIENT_REPLY = 'Only a reply to a client’s comment can be shown to the client.';

export function createCommentService({ repo, taskLookup, onMention, onComment, onChanged, onClientReply }: CommentServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }
  async function loadComment(id: string): Promise<CommentRecord> {
    const c = await repo.findById(id);
    if (!c) throw new NotFoundError('Comment not found.');
    return c;
  }

  async function addComment(taskId: string, userId: string, body: string, parentId?: string | null, opts: { clientVisible?: boolean } = {}): Promise<CommentRecord> {
    await ensureTask(taskId);
    // A reply's comment must exist (not deleted) and belong to the same task. Owner, 10 Nov 2026: any comment may be
    // answered, one level deep — a reply to a reply goes in the same thread (under its comment, even one deleted
    // since: the thread stays readable).
    let answered: CommentRecord | null = null;
    let threadId: string | null = null;
    let root: CommentRecord | null = null;
    if (parentId) {
      answered = await repo.findById(parentId);
      if (!answered || answered.taskId !== taskId) throw new NotFoundError('Parent comment not found.');
      // Up to the thread's top comment (older data may hold a reply to a reply); a deleted one on the way is the top.
      let at: CommentRecord = answered;
      for (let hops = 0; at.parentId && hops < MAX_THREAD_HOPS; hops++) {
        const up = await repo.findById(at.parentId);
        if (!up || up.taskId !== taskId) break;
        at = up;
      }
      threadId = at.parentId ?? at.id;
      root = at.parentId ? null : at;
    }
    // 1.23: "Visible to client" only in a client's thread (the client sees it under their comment).
    const clientVisible = opts.clientVisible === true;
    if (clientVisible && !root?.fromClient) throw new ValidationError(NOT_A_CLIENT_REPLY, { field: 'clientVisible' });
    const comment = await repo.create(taskId, userId, body, threadId, clientVisible ? { clientVisible: true } : undefined);
    await onChanged?.(taskId);
    // Match mentions against the real usernames of people who can open this task, so a partial
    // name, an email address or an outsider never gets notified.
    let mentions: string[] = [];
    if (body.includes('@')) {
      mentions = repo.listMentionableUsernames
        ? matchMentions(body, await repo.listMentionableUsernames(taskId))
        : parseMentions(body);
    }
    if (mentions.length > 0) await onMention?.(taskId, userId, mentions, body);
    const repliedToUserId = answered && !answered.fromClient && answered.userId !== userId ? answered.userId : null;
    await onComment?.(taskId, userId, comment.id, { repliedToUserId, mentioned: mentions });
    if (clientVisible) await onClientReply?.(comment);
    return comment;
  }

  async function listComments(taskId: string): Promise<CommentRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  async function editComment(commentId: string, userId: string, body: string): Promise<CommentRecord> {
    const comment = await loadComment(commentId);
    if (comment.userId !== userId) throw new ForbiddenError('You can only edit your own comment.');
    const edited = await repo.update(commentId, body);
    await onChanged?.(comment.taskId);
    return edited;
  }

  async function deleteComment(commentId: string, userId: string, isAdmin: boolean): Promise<CommentRecord> {
    const comment = await loadComment(commentId);
    if (comment.userId !== userId && !isAdmin) throw new ForbiddenError('You can only delete your own comment.');
    await repo.delete(commentId);
    await onChanged?.(comment.taskId);
    return comment; // returned so callers can scope a realtime broadcast to its task/project
  }

  /** Who an @mention in this task's comments can notify — for the composer's suggestion list. */
  async function mentionable(taskId: string): Promise<MentionablePerson[]> {
    await ensureTask(taskId);
    return repo.listMentionable ? repo.listMentionable(taskId) : [];
  }

  return { addComment, listComments, editComment, deleteComment, getComment: loadComment, mentionsOf: parseMentions, mentionable };
}

export type CommentService = ReturnType<typeof createCommentService>;
