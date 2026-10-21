import type { ApiTask } from './types';
import type { RollingGroup } from './read-cache';

/**
 * What the phone keeps offline (read-cache), named and capped. A project's tasks are kept per
 * board day looked at, and only the most recently loaded days stay; a task list too long to keep
 * whole is kept without the tasks finished long ago.
 */

/** Board days kept offline per person (the most recently loaded; older ones are deleted). */
export const BOARD_DAYS_KEPT = 14;

/** A list too long to keep whole leaves out tasks finished more than this many days ago. */
export const DONE_KEPT_DAYS = 30;

const BOARD_DAY = /^tasks\.[^.]+\.\d{4}-\d{2}-\d{2}$/;

/** The offline copy's name for a project's tasks: one board day, or all of them. */
export function projectTasksCopyKey(projectId: string, boardDate?: string): string {
  return `tasks.${projectId}.${boardDate ?? 'all'}`;
}

/** The offline copy's name for the All projects board on one day (4c): kept, and capped, with the board days. */
export function allTasksCopyKey(boardDate: string): string {
  return `tasks.all.${boardDate}`;
}

/** Is this the copy of one board day (one is kept per day looked at)? */
export function isBoardDayCopy(key: string): boolean {
  return BOARD_DAY.test(key);
}

/** A task list without the tasks finished more than DONE_KEPT_DAYS ago (every open one stays). */
export function withoutOldDone(now: number): (tasks: ApiTask[]) => ApiTask[] {
  const since = now - DONE_KEPT_DAYS * 86_400_000;
  return (tasks) =>
    tasks.filter((t) => {
      if (!t.completedAt) return true;
      const at = Date.parse(t.completedAt);
      return Number.isNaN(at) || at >= since;
    });
}

// ── Chat (3a) ────────────────────────────────────────────────────────────────

/** Conversations kept offline per person: the most recently opened (older ones are deleted). */
export const CHAT_THREADS_KEPT = 20;

/** The inbox (conversations, unread) and the people's names, kept whole. */
export const CHAT_INBOX_COPY = 'chat.conversations';
export const CHAT_DIRECTORY_COPY = 'chat.directory';

/** A conversation's newest page of messages (chat-thread newestPageCopy). */
export const chatThreadCopyKey = (conversationId: string): string => `chat.thread.${conversationId}`;
/** A channel's members (who can be mentioned). */
export const chatMembersCopyKey = (conversationId: string): string => `chat.members.${conversationId}`;

const CHAT_THREAD = /^chat\.thread\.[^.]+$/;
const CHAT_MEMBERS = /^chat\.members\.[^.]+$/;

// ── Projects (5b review) ─────────────────────────────────────────────────────

/** Boards whose progress figures are kept offline (the most recently opened). */
export const PROGRESS_KEPT = 20;

const PROGRESS = /^progress\.[^.]+$/;

/** The Projects list's card figures (one small copy, from one task list). */
export const PROJECT_FIGURES_COPY = 'projects.figures';

/** The copies that pile up, each capped on its own: board days, chat threads, channel members, boards' progress. */
export function offlineCopyCaps(): RollingGroup[] {
  return [
    { matches: isBoardDayCopy, keep: BOARD_DAYS_KEPT },
    { name: 'chat', matches: (key) => CHAT_THREAD.test(key), keep: CHAT_THREADS_KEPT },
    { name: 'chat-members', matches: (key) => CHAT_MEMBERS.test(key), keep: CHAT_THREADS_KEPT },
    { name: 'progress', matches: (key) => PROGRESS.test(key), keep: PROGRESS_KEPT },
  ];
}
