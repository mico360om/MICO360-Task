import { ForbiddenError, NotFoundError } from '../../lib/http-errors';
import type { CommentRecord, CommentRepository } from './comment-repository';
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
  onMention?: (taskId: string, authorId: string, usernames: string[]) => void | Promise<void>;
  /** Fired on every new comment (used to notify the task's assignees, excluding the author). */
  onComment?: (taskId: string, authorId: string, commentId: string) => void | Promise<void>;
}

export function createCommentService({ repo, taskLookup, onMention, onComment }: CommentServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }
  async function loadComment(id: string): Promise<CommentRecord> {
    const c = await repo.findById(id);
    if (!c) throw new NotFoundError('Comment not found.');
    return c;
  }

  async function addComment(taskId: string, userId: string, body: string, parentId?: string | null): Promise<CommentRecord> {
    await ensureTask(taskId);
    if (parentId) {
      // A reply's parent must exist and belong to the same task.
      const parent = await repo.findById(parentId);
      if (!parent || parent.taskId !== taskId) throw new NotFoundError('Parent comment not found.');
    }
    const comment = await repo.create(taskId, userId, body, parentId ?? null);
    // Match mentions against the real usernames of people who can open this task, so a partial
    // name, an email address or an outsider never gets notified.
    let mentions: string[] = [];
    if (body.includes('@')) {
      mentions = repo.listMentionableUsernames
        ? matchMentions(body, await repo.listMentionableUsernames(taskId))
        : parseMentions(body);
    }
    if (mentions.length > 0) await onMention?.(taskId, userId, mentions);
    await onComment?.(taskId, userId, comment.id);
    return comment;
  }

  async function listComments(taskId: string): Promise<CommentRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  async function editComment(commentId: string, userId: string, body: string): Promise<CommentRecord> {
    const comment = await loadComment(commentId);
    if (comment.userId !== userId) throw new ForbiddenError('You can only edit your own comment.');
    return repo.update(commentId, body);
  }

  async function deleteComment(commentId: string, userId: string, isAdmin: boolean): Promise<CommentRecord> {
    const comment = await loadComment(commentId);
    if (comment.userId !== userId && !isAdmin) throw new ForbiddenError('You can only delete your own comment.');
    await repo.delete(commentId);
    return comment; // returned so callers can scope a realtime broadcast to its task/project
  }

  return { addComment, listComments, editComment, deleteComment, getComment: loadComment, mentionsOf: parseMentions };
}

export type CommentService = ReturnType<typeof createCommentService>;
