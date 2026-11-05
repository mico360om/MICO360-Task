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
  /** Fired on every new comment (used to notify the task's assignees, excluding the author). */
  onComment?: (taskId: string, authorId: string, commentId: string) => void | Promise<void>;
  /** After a change to the words of a task (the task search index re-reads it). */
  onChanged?: (taskId: string) => void | Promise<void>;
  /** 1.23: a team reply marked "Visible to client" was added to a client's comment (their email). */
  onClientReply?: (reply: CommentRecord) => void | Promise<void>;
}

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
    let parent: CommentRecord | null = null;
    if (parentId) {
      // A reply's parent must exist and belong to the same task.
      parent = await repo.findById(parentId);
      if (!parent || parent.taskId !== taskId) throw new NotFoundError('Parent comment not found.');
    }
    // 1.23: "Visible to client" only on a reply to a client's comment (the client sees it under theirs).
    const clientVisible = opts.clientVisible === true;
    if (clientVisible && !parent?.fromClient) throw new ValidationError(NOT_A_CLIENT_REPLY, { field: 'clientVisible' });
    const comment = await repo.create(taskId, userId, body, parentId ?? null, clientVisible ? { clientVisible: true } : undefined);
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
    await onComment?.(taskId, userId, comment.id);
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
