import { shiftDayKey, todayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';

/**
 * The Recycle Bin's rules (1.24, owner 10 Nov 2026). A deleted task is kept, whole, for 60 days: it
 * can be restored with everything it had, then it is erased for good by the nightly sweep. Admins see
 * and restore every deleted task, the people who run a project its deleted tasks; only admins may
 * delete one forever before its 60 days are up. Who may *delete* is unchanged (task-delete-rule.ts).
 */

/** How many days a deleted task can be restored. */
export const BIN_DAYS = 60;

/**
 * When a task deleted at `deletedAt` is erased: the company midnight that ends the 60th day after the
 * day it was deleted ("3 Nov" → kept to the end of 2 Jan, erased that night). A whole day, so the
 * countdown reads the same all day and the last day says "Erased tonight".
 */
export function binExpiryOf(deletedAt: Date, timeZone: string): Date {
  return zonedStartOfDay(shiftDayKey(zonedDayKey(deletedAt, timeZone), BIN_DAYS + 1), timeZone);
}

/** A deleted task's expiry: the stored one, else (deleted by something older) 60 days from its deletion. */
export function effectiveExpiry(t: { deletedAt: Date; binExpiresAt: Date | null }, timeZone: string): Date {
  return t.binExpiresAt ?? binExpiryOf(t.deletedAt, timeZone);
}

/** Whole days between two 'YYYY-MM-DD' keys (noon-UTC arithmetic: no DST edges). */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * Days left before it is erased, counted in company days: 60 on the day it was deleted, 0 on its last
 * day (it is erased tonight) — and never below 0 while it waits for the sweep.
 */
export function binDaysLeft(expiresAt: Date, timeZone: string, now: Date = new Date()): number {
  return Math.max(0, dayDiff(todayKey(timeZone, now), zonedDayKey(expiresAt, timeZone)) - 1);
}

/** May this person see and restore a deleted task? Admins any; the people who run its project, theirs. */
export function mayRestore(f: { isAdmin: boolean; runsProject: boolean }): boolean {
  return f.isAdmin || f.runsProject;
}

/** May this person delete a task forever before its 60 days are up? Admins only. */
export function mayEraseNow(f: { isAdmin: boolean }): boolean {
  return f.isAdmin;
}
