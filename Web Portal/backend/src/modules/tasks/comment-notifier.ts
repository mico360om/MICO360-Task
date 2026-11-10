import type { CommentNoticeInfo } from './comment-service';

/** One notice about a new comment (stored in the app; the person's notification settings apply). */
export interface CommentNotice {
  userId: string;
  type: 'TASK_COMMENT';
  title: string;
  body: string | null;
  entityType: 'task';
  entityId: string;
}

export interface CommentNotifierDeps {
  /** The task's followers (assignees and watchers) who can open it — never the writer. */
  recipients: (taskId: string, authorId: string) => Promise<string[]>;
  /** Of these people, those who may open the task — never the writer. */
  visibleRecipients: (taskId: string, userIds: string[], authorId: string) => Promise<string[]>;
  /** The ids of the people with these exact usernames. */
  userIdsByUsername: (usernames: string[]) => Promise<string[]>;
  /** The task's line in a notice ("MICO-7 Fix the valve"). */
  taskNotice: (taskId: string) => Promise<string | null>;
  authorName: (authorId: string) => Promise<string>;
  notify: (n: CommentNotice) => Promise<unknown>;
}

/**
 * Who hears about a new comment. Its followers hear "New comment on your task" (as before). Owner, 10 Nov 2026: a
 * reply tells the person whose comment it answers — "Sara Ali replied to your comment" (a comment notice, so their
 * Comments setting applies) — while they can open the task, whether or not they follow it; once only (not the
 * follower notice too), and not at all when the reply @mentions them (their mention notice says it). Anyone
 * @mentioned gets their mention notice only (not "New comment" too). Never the writer.
 */
export function createCommentNotifier(deps: CommentNotifierDeps) {
  return async (taskId: string, authorId: string, _commentId: string, info: CommentNoticeInfo = { repliedToUserId: null, mentioned: [] }): Promise<void> => {
    const about = await deps.taskNotice(taskId);
    // The people @mentioned have their mention notice: nothing more from this comment (not doubled).
    const mentioned = info.mentioned.length > 0 ? await deps.userIdsByUsername(info.mentioned) : [];
    const told = new Set<string>(mentioned);
    const answered = info.repliedToUserId;
    if (answered && answered !== authorId && !told.has(answered)) {
      told.add(answered);
      if ((await deps.visibleRecipients(taskId, [answered], authorId)).includes(answered)) {
        await deps.notify({ userId: answered, type: 'TASK_COMMENT', title: `${await deps.authorName(authorId)} replied to your comment`, body: about, entityType: 'task', entityId: taskId });
      }
    }
    for (const userId of await deps.recipients(taskId, authorId)) {
      if (told.has(userId) || userId === authorId) continue;
      await deps.notify({ userId, type: 'TASK_COMMENT', title: 'New comment on your task', body: about, entityType: 'task', entityId: taskId });
    }
  };
}
