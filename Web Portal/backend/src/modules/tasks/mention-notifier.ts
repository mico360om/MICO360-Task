import { taskNoticeBody } from '../notifications/task-notice';

/** Longest comment excerpt quoted in a mention email. */
const SNIPPET_MAX = 280;

export interface MentionEmailParams {
  mentionedBy: string;
  taskKey: string;
  taskTitle: string;
  snippet: string;
  link: string;
}

export interface MentionNotifierDeps {
  /** The users with these exact usernames (unknown names are left out). */
  usersByUsername: (usernames: string[]) => Promise<Array<{ id: string; email: string | null }>>;
  /** Of these users, those who may open the task — never the author. */
  visibleRecipients: (taskId: string, userIds: string[], authorId: string) => Promise<string[]>;
  /** Stores the in-app notification; null when the user muted the type (then no email either). */
  notify: (input: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }) => Promise<unknown | null>;
  task: (taskId: string) => Promise<{ key: string; title: string } | null>;
  authorName: (authorId: string) => Promise<string>;
  /** Best-effort email; absent when email isn't wired. */
  sendMentionEmail?: (email: string, params: MentionEmailParams) => Promise<void>;
  appUrl: string;
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
}

function snippetOf(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length <= SNIPPET_MAX ? text : `${text.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;
}

/**
 * A comment @mention: each mentioned person who can open the task gets an in-app notification and,
 * unless they muted mentions or have no address, an email quoting the comment. Email is best-effort:
 * a mail problem never fails the comment.
 */
export function createMentionNotifier(deps: MentionNotifierDeps) {
  return async (taskId: string, authorId: string, usernames: string[], body = ''): Promise<void> => {
    const users = await deps.usersByUsername(usernames);
    const recipients = await deps.visibleRecipients(taskId, users.map((u) => u.id), authorId);
    if (recipients.length === 0) return;
    const task = await deps.task(taskId);
    const about = taskNoticeBody(task);
    const mentionedBy = deps.sendMentionEmail ? await deps.authorName(authorId) : '';
    for (const userId of recipients) {
      const kept = await deps.notify({ userId, type: 'MENTION', title: 'You were mentioned in a comment', body: about, entityType: 'task', entityId: taskId });
      const email = users.find((u) => u.id === userId)?.email;
      if (!kept || !email || !deps.sendMentionEmail || !task) continue;
      await deps
        .sendMentionEmail(email, {
          mentionedBy,
          taskKey: task.key,
          taskTitle: task.title,
          snippet: snippetOf(body),
          link: `${deps.appUrl.replace(/\/$/, '')}/my-tasks?task=${encodeURIComponent(taskId)}`,
        })
        .catch((err) => deps.logger?.warn('mention email failed', { err, userId, taskId }));
    }
  };
}
