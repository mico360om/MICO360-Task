import { zonedClock } from '../../lib/working-days';
import { shiftDayKey, zonedStartOfDay } from '../../lib/due-date';

/**
 * Work blocks (Calendar scheduling, owner 11 Nov 2026): dragging a task into an hour plans time to work
 * on it — a "work on it" block — without changing its dates. A block is one person's time: they book
 * their own when they are on the task; the task's creator or whoever runs its project plans time for
 * its assignees ("planned by Sara"). Blocks show in that person's calendar and Workload, and meeting
 * free-time finding counts them as busy. Pure rules here; the store and routes sit beside.
 */

export const BLOCK_MIN_MINUTES = 15;
export const BLOCK_MAX_MINUTES = 12 * 60;

/** What is wrong with a block's times (null: fine). */
export function blockProblem(startAt: Date, endAt: Date): string | null {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return 'Give the block a start and end time.';
  const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (minutes <= 0) return 'A block ends after it starts.';
  if (minutes < BLOCK_MIN_MINUTES) return `A block is at least ${BLOCK_MIN_MINUTES} minutes.`;
  if (minutes > BLOCK_MAX_MINUTES) return 'A block is 12 hours at most.';
  return null;
}

/** The task as the rules read it. */
export interface BlockTaskFacts {
  assigneeIds: readonly string[];
  createdById: string;
}

/**
 * May `viewerId` plan a block of `personId`'s time on the task? Blocks are the assignees' time: the
 * person themselves when assigned, or — for any assignee — the task's creator or whoever runs its
 * project (administrators included).
 */
export function mayPlanBlock(p: { viewerId: string; personId: string; task: BlockTaskFacts; runsProject: boolean }): boolean {
  if (!p.task.assigneeIds.includes(p.personId)) return false;
  return p.viewerId === p.personId || p.viewerId === p.task.createdById || p.runsProject;
}

/** May `viewerId` move, resize or remove the block? Its person, whoever planned it, or whoever runs the project. */
export function mayChangeBlock(p: { viewerId: string; block: { userId: string; plannedById: string }; runsProject: boolean }): boolean {
  return p.viewerId === p.block.userId || p.viewerId === p.block.plannedById || p.runsProject;
}

/** The task's state as hiding reads it (`archivedAt`: the task archive; absent on older servers). */
export interface BlockTaskState {
  deletedAt: Date | null;
  completedAt: Date | null;
  archivedAt?: Date | null;
}

/**
 * Never deleted with the task's state (call 2): kept but hidden while the task is binned or archived;
 * once it is done its blocks still to come (not ended yet) are hidden — those past stay as history. All
 * come back when the task is restored, unarchived or reopened (the nightly erase removes them with it).
 */
export function blockShown(block: { startAt: Date; endAt: Date }, task: BlockTaskState, now: Date): boolean {
  if (task.deletedAt || task.archivedAt) return false;
  if (task.completedAt && block.endAt.getTime() > now.getTime()) return false;
  return true;
}

/**
 * Planned minutes per person and company day (`"<userId> <YYYY-MM-DD>"`), a block over midnight split
 * between its days — what Workload adds to each cell.
 */
export function plannedMinutesByDay(blocks: readonly { userId: string; startAt: Date; endAt: Date }[], timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of blocks) {
    let cursor = b.startAt.getTime();
    const end = b.endAt.getTime();
    // Twelve hours at most: two days at most, but walk generally.
    for (let i = 0; cursor < end && i < 400; i++) {
      const { day } = zonedClock(new Date(cursor), timeZone);
      const nextMidnight = zonedStartOfDay(shiftDayKey(day, 1), timeZone).getTime();
      const until = Math.min(end, nextMidnight);
      const key = `${b.userId} ${day}`;
      out.set(key, (out.get(key) ?? 0) + Math.round((until - cursor) / 60_000));
      cursor = until;
    }
  }
  return out;
}
