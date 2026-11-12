import { dayText } from './day-words';
import type { TaskNotice } from './task-notice';

/**
 * Duplicate Task (website): the words around a copy — what the review form copies without a field of
 * its own ("Also copied: …"), whether the original's start date still fits, and how the files went.
 */

/** How the copy's files went (POST /tasks/:id/duplicate). */
export interface FilesOutcome {
  total: number;
  copied: number;
  failed: { filename: string; reason: string }[];
}

/** "a", "a and b", "a, b and c". */
function listText(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (s: string) => `“${s}”`;

/** "3 Nov" this year, "3 Nov 2027" another. */
export function shortDay(key: string, today: string): string {
  return dayText(key, { year: key.slice(0, 4) !== today.slice(0, 4) });
}

/**
 * The original's start date goes with the copy only when it fits the copy's due date (on or before
 * it) — a start after the due date would be refused, and the form has no start date of its own yet.
 */
export function carriedStart(start: string | null | undefined, due: string | null | undefined): string | null {
  if (!start) return null;
  return !due || start <= due ? start : null;
}

/** What is copied that the form has no field for: "Also copied: start date 3 Nov, tags safety and rig, 2 watchers, 4 h estimate." */
export function alsoCopiedText(
  parts: { startDate?: string | null; tags?: string[]; watchers?: number; estimatedHours?: number | null },
  today: string,
): string | null {
  const out: string[] = [];
  if (parts.startDate) out.push(`start date ${shortDay(parts.startDate, today)}`);
  if (parts.tags?.length) out.push(`${parts.tags.length === 1 ? 'tag' : 'tags'} ${listText(parts.tags)}`);
  if (parts.watchers) out.push(plural(parts.watchers, 'watcher'));
  if (parts.estimatedHours) out.push(`${parts.estimatedHours} h estimate`);
  return out.length ? `Also copied: ${listText(out)}.` : null;
}

/**
 * How the files went, in a few words: "3 files copied"; "2 of 3 files copied — “x.dwg” couldn’t be
 * copied"; null when none were to be copied.
 */
export function filesOutcomeText(o: FilesOutcome | null | undefined): string | null {
  if (!o || o.total === 0) return null;
  const names = listText(o.failed.map((f) => quote(f.filename)));
  if (o.failed.length === 0) return `${plural(o.copied, 'file')} copied`;
  if (o.copied === 0) return o.total === 1 ? `${names} couldn’t be copied` : `No files copied — ${names} couldn’t be copied`;
  return `${o.copied} of ${o.total} files copied — ${names} couldn’t be copied`;
}

/** The app's notice after a duplicate: "Task MSSP-40 created · 2 of 3 files copied — “x.dwg” couldn’t be copied", with Open. */
export function duplicatedNotice(task: { id: string; key: string }, files: FilesOutcome | null | undefined): TaskNotice {
  const outcome = filesOutcomeText(files);
  return { text: `Task ${task.key} created${outcome ? ` · ${outcome}` : ''}`, taskId: task.id, key: task.key };
}

/** "Copies: MSSP-40, MSSP-41" — a few numbers, then how many more. */
export const COPIES_SHOWN = 5;
