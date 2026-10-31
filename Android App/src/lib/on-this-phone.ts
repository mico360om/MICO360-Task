import type { DraftView } from './inspection-outbox';
import { unsentChanges } from './inspection-outboxes';
import { INSPECTION_WORDS } from './inspection-words';

/**
 * "On this phone" (device check B): the inspections the signed-in person has changes waiting for, or
 * keeps on this phone unfinished, read from the phone's own records — so the Dashboard (and a
 * project's Inspections tab) can open them with no signal, even after the app was restarted. Not
 * "Waiting on this phone": an unfinished one may have nothing waiting (re-check note a).
 */
export const ON_PHONE_TEXT = { title: 'On this phone', open: 'Open' } as const;

/** "1 change waiting", "3 changes waiting". */
export function changesWaiting(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'} waiting`;
}

export interface KeptRow {
  inspectionId: string;
  projectId: string;
  title: string;
  /** Its task's key ("SITE-10"), or null for an inspection without a task. */
  taskKey: string | null;
  /** "Signed · waiting to finish", "2 changes waiting" or "In progress". */
  line: string;
  /** What TalkBack reads for the row. */
  label: string;
}

/**
 * The card's rows from the person's records (`views`, inspection-outboxes `kept`), of one project when
 * `projectId` is given: each with changes waiting, or not finished — those with changes first, then
 * by title. A finished one with nothing waiting is the server's report, not listed.
 */
export function keptRows(views: readonly DraftView[], projectId?: string): KeptRow[] {
  return views
    .filter((v) => (!projectId || v.projectId === projectId) && (unsentChanges(v.pending) > 0 || v.status !== 'FINISHED'))
    .map((v) => {
      const n = unsentChanges(v.pending);
      const line = v.pending.finish ? INSPECTION_WORDS.signedLocked : n > 0 ? changesWaiting(n) : INSPECTION_WORDS.inProgress;
      const taskKey = v.snapshot.task?.key ?? null;
      const row: KeptRow = { inspectionId: v.inspectionId, projectId: v.projectId, title: v.title, taskKey, line, label: [v.title, taskKey, line].filter(Boolean).join(', ') };
      return { row, waiting: n > 0 };
    })
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || a.row.title.localeCompare(b.row.title, 'en'))
    .map(({ row }) => row);
}
