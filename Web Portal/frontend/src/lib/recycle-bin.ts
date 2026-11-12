import { dayKeyIn, dayText } from './day-words';
import type { EraseResult, RestoreResult } from '../api/recycle-bin';

/**
 * Recycle Bin words (the bin page, a deleted task's banner, the delete question and its Undo). A deleted
 * task is kept 60 days; the server counts the days left in company days (0 on its last day).
 */

/** How many days a deleted task can be restored. */
export const BIN_DAYS = 60;

export type BinTone = 'neutral' | 'warning' | 'danger';

/** "12 days left": amber at 7 or less, red at 2 or less, "Erased tonight" on the last day. */
export function binCountdown(daysLeft: number): { text: string; tone: BinTone } {
  if (daysLeft <= 0) return { text: 'Erased tonight', tone: 'danger' };
  const text = daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
  return { text, tone: daysLeft <= 2 ? 'danger' : daysLeft <= 7 ? 'warning' : 'neutral' };
}

/** "3 Nov" (this year) or "3 Nov 2025": the company day of an instant. */
export function binDay(at: string, timeZone: string, today: string): string {
  const key = dayKeyIn(new Date(at), timeZone);
  return dayText(key, { year: key.slice(0, 4) !== today.slice(0, 4) });
}

/** "In the Recycle Bin — deleted by Ali on 3 Nov" (who: only when it was recorded). */
export function binBannerLead(bin: { deletedAt: string; deletedBy: { name: string } | null }, timeZone: string, today: string): string {
  const who = bin.deletedBy ? ` by ${bin.deletedBy.name}` : '';
  return `In the Recycle Bin — deleted${who} on ${binDay(bin.deletedAt, timeZone, today)}`;
}

/** "In the Recycle Bin — deleted by Ali on 3 Nov · 53 days left". */
export function binBannerText(bin: { deletedAt: string; deletedBy: { name: string } | null; daysLeft: number }, timeZone: string, today: string): string {
  return `${binBannerLead(bin, timeZone, today)} · ${binCountdown(bin.daysLeft).text}`;
}

/** The notice after a restore went through: "Task RIG-12 restored", "3 tasks restored". */
export function restoredNotice(r: RestoreResult): { text: string; taskId: string | null; key: string | null } {
  if (r.restored.length === 1) return { text: `Task ${r.restored[0]!.key} restored`, taskId: r.restored[0]!.id, key: r.restored[0]!.key };
  return { text: `${r.restored.length} tasks restored`, taskId: null, key: null };
}

/** The question before a delete. */
export const DELETE_ASK = `Move to the Recycle Bin? You (or an admin) can restore it for ${BIN_DAYS} days.`;

/** The question before deleting a copy of a repeating task (the series' size when known). */
export function seriesDeleteAsk(size: number | null): string {
  const series = size && size > 1 ? `the entire series (${size} tasks)` : 'the entire series';
  return `This is a repeating task — move this copy or ${series} to the Recycle Bin? You (or an admin) can restore them for ${BIN_DAYS} days.`;
}

/** "OPS-4", "OPS-4 and OPS-5", "OPS-4, OPS-5 and OPS-6", or "4 tasks". */
function keysText(keys: string[]): string {
  if (keys.length > 3) return `${keys.length} tasks`;
  return keys.length < 2 ? (keys[0] ?? '') : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`;
}

/** What a restore did, and why any weren't restored. */
export function restoreText(r: RestoreResult): string {
  const parts: string[] = [];
  if (r.restored.length) parts.push(r.restored.length === 1 ? `Restored ${r.restored[0]!.key}.` : `Restored ${r.restored.length} tasks.`);
  const archived = r.notRestored.filter((x) => x.reason === 'archived');
  const gone = r.notRestored.filter((x) => x.reason !== 'archived');
  if (archived.length === 1) parts.push(`${archived[0]!.key ?? 'One task'} wasn’t restored: its project is archived. Unarchive the project first.`);
  else if (archived.length > 1) parts.push(`${keysText(archived.map((x) => x.key ?? '?'))} weren’t restored: their projects are archived. Unarchive them first.`);
  if (gone.length === 1) parts.push(parts.length ? '1 was no longer in the Recycle Bin.' : (gone[0]!.message || 'It isn’t in the Recycle Bin any more.'));
  else if (gone.length > 1) parts.push(`${gone.length} were no longer in the Recycle Bin.`);
  return parts.join(' ');
}

/** What a delete forever did. */
export function eraseText(r: EraseResult): string {
  const parts: string[] = [];
  if (r.erased.length) parts.push(r.erased.length === 1 ? `Deleted ${r.erased[0]!.key} forever.` : `Deleted ${r.erased.length} tasks forever.`);
  if (r.notErased.length) parts.push(r.notErased.length === 1 ? '1 was no longer in the Recycle Bin.' : `${r.notErased.length} were no longer in the Recycle Bin.`);
  return parts.join(' ');
}
