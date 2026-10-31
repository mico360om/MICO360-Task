import { dayText } from './day-words';
import type { ClientInspection, ClientInspectionSummary, InspectionPermissions } from './inspection-types';
import { highlightNames } from './name-highlight';

/**
 * A finished inspection's report and what can be done with it, as the website's inspection page:
 * the actions the server allows, and the client's copy (the preview before "Show to client") — its
 * result line, rows and words.
 */

export type InspectionAction = 'report' | 'takeOver' | 'reopen' | 'delete';

/** The actions, in the website's order: the report when finished, then what the server allows. */
export function inspectionMenu(p: InspectionPermissions, finished: boolean): InspectionAction[] {
  const out: InspectionAction[] = [];
  if (finished) out.push('report');
  if (p.canTakeOver) out.push('takeOver');
  if (p.canReopen) out.push('reopen');
  if (p.canDelete) out.push('delete');
  return out;
}

/**
 * Where a deleted inspection's screen goes (Final I12): back to its project's screen when it was
 * opened from there (how many screens to pop), else that project's screen in its place.
 */
export function backToProject(routes: ReadonlyArray<{ name: string; params?: object }>, index: number, projectId: string): { pop: number } | { replace: true } {
  for (let i = index - 1; i >= 0; i -= 1) {
    const r = routes[i];
    if (r?.name === 'ProjectDetail' && (r.params as { projectId?: unknown } | undefined)?.projectId === projectId) return { pop: index - i };
  }
  return { replace: true };
}

/** Whether any note of the report names one of these people (the preview says so only then) — the website's. */
export function notesNameSomeone(x: ClientInspection, names: string[]): boolean {
  return x.sections.some((s) => s.items.some((i) => !!i.note && highlightNames(i.note, names).some((p) => p.name)));
}

/** "2 failed · 3 items: 1 passed, 0 N/A": the result already says how many failed, so it isn't said twice. */
export function clientResultLine(x: Pick<ClientInspectionSummary, 'result' | 'counts'>): string {
  const c = x.counts;
  return `${x.result} · ${c.total} ${c.total === 1 ? 'item' : 'items'}: ${c.passed} passed${c.failed ? '' : `, ${c.failed} failed`}, ${c.na} N/A`;
}

/** "Revision 2 · reopened on 27 Oct 2026" for a report reopened and signed again; null for a first signing. */
export function revisionLine(x: Pick<ClientInspectionSummary, 'revisionNumber' | 'reopenedOn'>): string | null {
  if (!x.revisionNumber || x.revisionNumber < 2) return null;
  return `Revision ${x.revisionNumber}${x.reopenedOn ? ` · reopened on ${dayText(x.reopenedOn)}` : ''}`;
}

/** One row of the client's report: "162.5 psi · allowed 0–150 psi", and its result in words ("—" when none). */
export function clientRow(i: ClientInspection['sections'][number]['items'][number]): { reading: string | null; result: string } {
  const reading = [i.reading, i.limits ? `allowed ${i.limits}` : null].filter(Boolean).join(' · ');
  return { reading: reading || null, result: i.result ?? '—' };
}

/** The actions' words, the website's. */
export const ACTION_WORDS = {
  report: 'Report (PDF)',
  takeOver: 'Take over',
  reopen: 'Reopen',
  delete: 'Delete',
  reopenTitle: 'Reopen this inspection?',
  reopenBody: 'Its answers can be changed again. The signatures come off (they’re kept as an earlier revision, and it is signed again when it’s finished), and it leaves the client page if it was shown there.',
  takeOverTitle: 'Take over this inspection?',
  takeOverBody: 'You become its inspector: only you can answer, sign and finish it. {inspector} can no longer change it (anything they still have on their phone isn’t sent).',
  deleteTitle: 'Delete this inspection?',
  deleteBody: 'Its answers, signatures and report go with it (follow-up tasks already made stay). This can’t be undone.',
  discardTitle: 'Throw away what’s on this phone?',
  discardBody: 'The changes saved on this phone for this inspection are removed. Nothing on the server changes.',
  discard: 'Throw it away',
  keep: 'Keep it',
  failed: 'That didn’t work. Check your connection and try again.',
  reportFailed: 'Couldn’t download the report. Check your connection and try again.',
} as const;

/** Show to client on a report: the switch, its hints, the preview's words — the website's. */
export const REPORT_CLIENT_WORDS = {
  show: 'Show to client',
  archivedHint: 'The project is archived: you can take this report off the client page, but it can’t be put back.',
  onHint: 'Shown on the project’s client page, with its PDF. Reopening the inspection takes it off.',
  offHint: 'Puts this report on the project’s client page, with a PDF of it. You see exactly what the client will see first.',
  visible: 'Visible to client',
  previewTitle: 'Show this report to the client?',
  previewIntro: 'This is exactly what the client will see on their page, and in the PDF they can download: the results, the notes and the signatures with the signers’ names. No other staff names, tasks or internal notes.',
  namesNote: 'Highlighted: names of people on the project, in the notes. If the client shouldn’t see them, cancel, reopen the inspection and change the notes.',
  previewFailed: 'Couldn’t load the report. Close this and try again.',
  changeFailed: 'Couldn’t change it. Please try again.',
  failedItems: 'Failed items',
  signatures: 'Signatures',
  notSigned: 'Not signed',
  typedName: ' · typed name',
} as const;
