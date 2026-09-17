import { ForbiddenError, NotFoundError } from '../../lib/http-errors';
import type { CommentRecord, CommentRepository } from './comment-repository';
import type { TaskLookup } from './assignee-repository';

/** Extract unique @usernames from a comment body (for mention notifications). */
export function parseMentions(body: string): string[] {
  const matches = body.match(/@([a-zA-Z0-9_]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

export interface CommentServiceDeps {
  repo: CommentRepository;
  taskLookup: TaskLookup;
  /** Fired when a new comment @mentions usernames (used to notify the mentioned users). */
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
    const mentions = parseMentions(body);
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

  return { addComment, listComments, editComment, deleteComment, mentionsOf: parseMentions };
}

export type CommentService = ReturnType<typeof createCommentService>;
