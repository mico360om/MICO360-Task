import { dateTimeText, instantDayText } from './day-words';
import type { StorageProblem } from './draft-storage';
import type { DraftView } from './inspection-outbox';
import type { SyncState } from './inspection-outboxes';
import { SIGNATURE_LABEL, type SignatureRole } from './inspection-rules';
import type { InspectionCounts, InspectionDetail, InspectionListItem } from './inspection-types';

/**
 * The inspection screens' words — the website's (`pages/InspectionPage.tsx`,
 * `components/inspections/{SyncBanner,inspection-ui}.tsx`) and its small word helpers, copied. Where
 * the website names a page reload the phone says "even if the app closes" (lead amendment 2);
 * `inspection-words.test.ts` checks every word against the website's files.
 */

/** The words of a refused request (the server's, unless they are the generic fallback). */
export function problemText(err: unknown, fallback: string): string {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  return m && !/^Request failed/.test(m) && !/Failed to fetch|NetworkError|Network request failed/i.test(m) ? m : fallback;
}

/** What became of follow-up tasks asked for, item by item, in the form's order. */
export function followUpNotice(report: Array<{ itemId: string; status: 'created' | 'exists' | 'pending' | 'not-failed'; taskKey: string | null }>, order: Array<{ id: string; label: string }>): string {
  const at = new Map(order.map((i, n) => [i.id, n]));
  const sorted = [...report].sort((a, b) => (at.get(a.itemId) ?? 1e9) - (at.get(b.itemId) ?? 1e9));
  if (!sorted.length) return '';
  if (sorted.every((r) => r.status === 'created')) {
    const keys = sorted.map((r) => r.taskKey).filter(Boolean).join(', ');
    return sorted.length === 1 ? `Follow-up task made${keys ? `: ${keys}` : ''}.` : `${sorted.length} follow-up tasks made${keys ? `: ${keys}` : ''}.`;
  }
  const label = (id: string) => order.find((i) => i.id === id)?.label ?? 'An item';
  const what = (r: (typeof sorted)[number]) =>
    r.status === 'created'
      ? `made${r.taskKey ? ` (${r.taskKey})` : ''}`
      : r.status === 'exists'
        ? `already had one${r.taskKey ? ` (${r.taskKey})` : ''}`
        : r.status === 'pending'
          ? 'already being made'
          : 'not made, it no longer fails';
  return `Follow-up tasks: ${sorted.map((r) => `${label(r.itemId)}: ${what(r)}.`).join(' ')}`;
}

export type SyncWord = 'memory' | 'sent' | 'sending' | 'signed-out' | 'unreachable' | 'retry' | 'offline' | 'soon';

/** Where the changes are, in one word (what the banner shows, and what TalkBack is told when it changes) — the website's. */
export function syncWord(view: DraftView, sync: SyncState, online: boolean): SyncWord {
  const waiting = view.pending.answers > 0 || view.pending.followUps > 0 || view.pending.finish;
  if (!view.persisted) return 'memory';
  if (!waiting) return 'sent';
  if (sync === 'sending') return 'sending';
  if (sync === 'signed-out') return 'signed-out';
  // A failure the screen saw just now, or the one the phone remembers (after the app closed).
  const failure = sync === 'offline' || sync === 'unreachable' || sync === 'retry' ? sync : view.lastFailure;
  if (!online || failure === 'offline') return 'offline';
  if (failure === 'unreachable') return 'unreachable';
  if (failure === 'retry') return 'retry';
  return 'soon';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What waits, in words: "2 answers, 1 follow-up task request, the signatures". */
export function pendingWords(p: DraftView['pending']): string {
  return [p.answers ? plural(p.answers, 'answer') : '', p.followUps ? plural(p.followUps, 'follow-up task request') : '', p.finish ? 'the signatures' : ''].filter(Boolean).join(', ');
}

/**
 * The banner's line for a word: the website's banner, in the phone's words where it names the page
 * (Final I10) — the changes are only in the app, kept while the app is open; an inspection too big
 * for the phone to keep is told apart from the phone being full (`problem`).
 */
export function syncLine(word: SyncWord, view: DraftView, problem?: StorageProblem | null): string {
  const w = pendingWords(view.pending);
  switch (word) {
    case 'memory':
      return problem === 'too-big'
        ? 'This inspection is too big to keep on the phone, so your changes are only in the app. Keep the app open until they’re sent.'
        : 'This phone’s storage is full, so your changes are only in the app. Keep the app open until they’re sent.';
    case 'sent':
      return view.sentAt ? 'All changes sent.' : 'Saved.';
    case 'sending':
      return `Sending ${w}…`;
    case 'signed-out':
      return `Saved on this phone: ${w}. Sign in again to send them.`;
    case 'unreachable':
      return `Can’t reach the server, will keep trying. Saved on this phone: ${w}.`;
    case 'retry':
      return `The server had a problem, will keep trying. Saved on this phone: ${w}.`;
    case 'offline':
      return `Saved on this phone, will send when you’re back online with the app open: ${w}.`;
    case 'soon':
      return `Saved on this phone: ${w}. Sending soon.`;
  }
}

/** What TalkBack is told when the changes can't be sent (the website's five). */
export const SYNC_ANNOUNCE: Partial<Record<SyncWord, string>> = {
  offline: 'No signal. Changes are saved on this phone and sent when you’re back online.',
  unreachable: 'Can’t reach the server. Changes are saved on this phone; it keeps trying.',
  retry: 'The server had a problem. Changes are saved on this phone; it keeps trying.',
  memory: 'This phone’s storage is full: changes are only in the app.',
  'signed-out': 'Signed out. Changes are saved on this phone; sign in again to send them.',
};
/** What TalkBack is told when the changes are only in the app because the inspection is too big to keep. */
export const MEMORY_TOO_BIG_ANNOUNCE = 'This inspection is too big to keep on the phone: changes are only in the app.';
/** …and when they all went once that was over. */
export const BACK_ONLINE = 'Back online: all changes sent.';

/**
 * What another person's change means for the one looking, after the screen read it again: taken
 * over from them, or reopened (null: nothing worth saying; the screen simply shows the new state).
 */
export function inspectionChangeNote(before: InspectionDetail | null | undefined, after: InspectionDetail | null | undefined, myId: string | null): string | null {
  if (!before || !after || !myId) return null;
  if (before.inspector.id === myId && after.inspector.id !== myId && after.status === 'IN_PROGRESS') {
    return `${after.inspector.name} took this inspection over: only they can answer and sign it now. Anything still saved on this phone for it isn’t sent.`;
  }
  if ((after.revision ?? 0) > (before.revision ?? 0) && after.reopened && after.reopened.by.id !== myId) {
    return `${after.reopened.by.name} reopened this inspection: its answers can be changed again, and it is signed again when it’s finished.`;
  }
  return null;
}

/** The progress card's counts: "12 of 40 answered", "3 passed", "1 failed", "2 N/A". */
export function progressWords(c: InspectionCounts): { answered: string; passed: string; failed: string; na: string } {
  return { answered: `${c.answered} of ${c.total} answered`, passed: `${c.passed} passed`, failed: `${c.failed} failed`, na: `${c.na} N/A` };
}

/** Who signs, under Finish: "The inspector signs, then the client (optional) and the supervisor. …". */
export function finishHint(allowed: SignatureRole[], required: SignatureRole[]): string {
  const then = allowed.length > 1 ? `, then ${allowed.slice(1).map((r) => `the ${SIGNATURE_LABEL[r].toLowerCase()}${required.includes(r) ? '' : ' (optional)'}`).join(' and ')}` : '';
  return `The inspector signs${then}. After that it can’t be changed, and the report is made.`;
}

/** After a finish: its check completed, waiting for approval, or just the report. */
export function finishedNotice(d: Pick<InspectionDetail, 'taskCompleted' | 'taskWaiting'>): string {
  if (d.taskCompleted) return `Finished. Task ${d.taskCompleted.key} completed.`;
  if (d.taskWaiting) return `Finished. Task ${d.taskWaiting.key} needs approval, so it’s waiting for a project manager.`;
  return 'Finished. The report is ready.';
}

/** A row's facts: "Rig 3 · Started 27 Oct 2026 · Ann Lee · For RIG-1" (the company's time zone). */
export function inspectionFacts(i: InspectionListItem, timeZone: string): string {
  const finished = i.status === 'FINISHED';
  return [
    i.place || null,
    finished ? `Finished ${instantDayText(i.finishedAt ?? '', timeZone)}` : `Started ${instantDayText(i.startedAt, timeZone)}`,
    i.inspector.name,
    i.task ? `For ${i.task.key}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Started 27 Oct 2026, 14:05" (the company's time zone). */
export function startedLine(at: string, timeZone: string): string {
  return `Started ${dateTimeText(at, timeZone)}`;
}

/** The inspection screen's fixed words, the website's (dialogs: Task 11; the tab: Task 10; schedules: Task 12). */
export const INSPECTION_WORDS = {
  noSignalTitle: 'No signal',
  noSignal:
    'This inspection hasn’t been opened on this phone yet, so there’s no copy saved here. It opens once there’s a signal. (An inspection keeps working without signal, even if the app closes, once you’ve opened it here.)',
  notFoundTitle: 'Inspection not found',
  notFound: 'It may have been deleted, or the link is wrong.',
  loadFailedTitle: 'Couldn’t load this inspection',
  loadFailed: 'Check your connection and try again. (An inspection keeps working without signal, even if the app closes, once you’ve opened it here.)',
  showingCopy: 'No signal: showing the copy saved on this phone.',
  answerFailed: 'That answer couldn’t be saved.',
  signedLocked: 'Signed · waiting to finish',
  signedOnPhone: 'Signed on this phone. It finishes as soon as it reaches the server.',
  takeBack: 'Take the signatures back',
  finish: 'Finish',
  signAndFinish: 'Sign and finish',
  answerFirst: 'Answer these first ({n}):',
  andMore: 'and {n} more',
  signedOffline: 'Signed on this phone. It finishes when it can reach the server, and the report is made then.',
  markDoneTitle: 'Mark {key} done?',
  markDoneBody: 'This inspection was carried out for the task “{title}”. It’s finished now — mark the task done too?',
  markDone: 'Mark it done',
  notNow: 'Not now',
  markedDone: 'The task is marked done.',
  markDoneFailed: 'Couldn’t mark the task done. You can do it from the task.',
  stillOnPhone: 'Still on this phone: {w}.',
  tryAgain: 'Try again',
  tryNow: 'Try now',
  throwAway: 'Throw away what’s on this phone',
  lookAgain: 'Look again',
  ok: 'OK',
  backToProjects: 'Back to projects',
  inProgress: 'In progress',
  notAnswered: 'Not answered',
  inspector: 'Inspector: {name}',
  forTask: 'For {key}',
  revision: 'Revision {n} · reopened on {day} by {name}',
  answered: 'Answered',
  dismiss: 'Dismiss',
  signatures: 'Signatures',
  notSigned: 'Not signed',
  typedName: ' · typed name',
  finishedAt: 'Finished {at}',
  earlierRevisions: 'Earlier signed revisions',
  earlierRevisionsHint: 'Signatures a reopen took off. Kept here and in the staff report; the client sees only the current one.',
} as const;
