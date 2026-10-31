import type { MicoAiNamed, MicoAiProposal, ProposalChange, ProposalResult, ProposalUndo } from './mico-ai-api';
import { countdown, remainingNeeds, resultSummary, undoSummary } from './mico-ai-proposal';
import { parseTimeInput } from './meeting-form';

/**
 * MICO AI's card of proposed changes on the phone (Stage 3 Task 14): which buttons the card's
 * status allows — none while it is being made or put back, so nothing can be tapped twice (Review
 * Focus 3) — and the website ProposalCard's words for each line and button.
 */

/** Under the buttons while the card waits for Confirm. */
export const FOOTER_NOTE = 'Nothing changes until you confirm. You can undo for 15 minutes.';
const CANCELLED = 'Cancelled — nothing was changed.';
const SUPERSEDED = 'Replaced by a newer answer — nothing was changed.';

export interface CardControls {
  confirm: boolean;
  cancel: boolean;
  undo: boolean;
  /** "Undo is no longer available." (the window has closed on changes that were made). */
  undoGone: boolean;
  /** The card's last line (its state or what happened), or none while it waits for Confirm. */
  footer: string | null;
}

const none = (footer: string): CardControls => ({ confirm: false, cancel: false, undo: false, undoGone: false, footer });

/** What the card offers, by its status and the time left on Undo (by the server's clock). */
export function cardControls(p: MicoAiProposal, leftMs: number): CardControls {
  switch (p.status) {
    case 'proposed':
      return { confirm: true, cancel: true, undo: false, undoGone: false, footer: null };
    case 'confirming':
      return none('Making these changes…');
    case 'undoing':
      return none('Putting these changes back…');
    case 'cancelled':
      return none(CANCELLED);
    case 'superseded':
      return none(SUPERSEDED);
    case 'undone':
      return none(undoSummary(p.items));
    case 'done': {
      const undo = p.canUndo && !!p.undoUntil && leftMs > 0;
      const undoGone = !undo && !!p.undoUntil && p.items.some((i) => i.result?.status === 'done');
      return { confirm: false, cancel: false, undo, undoGone, footer: resultSummary(p.items) };
    }
  }
}

/** The change's kind, as its badge says. */
export const KIND_BADGE: Record<ProposalChange['type'], string> = {
  create_task: 'New task',
  update_task: 'Change',
  draft_minutes: 'Final minutes',
  schedule_meeting: 'Meeting',
};

/** What happened to one change (a done one also shows "Done" and where to open it). */
export function resultLine(r: ProposalResult): string {
  switch (r.status) {
    case 'started':
      return 'Being made…';
    case 'done':
      return r.message ?? '';
    case 'skipped':
      return 'Skipped (not ticked).';
    default:
      return `${r.status === 'refused' ? 'Refused' : 'Failed'}: ${r.message ?? 'This change couldn’t be made.'}`;
  }
}

/** What Undo did to one change. */
export function undoLine(u: ProposalUndo): string {
  if (u.status === 'started') return 'Being put back…';
  return u.status === 'undone' ? `Undone: ${u.message ?? 'put back as it was.'}` : `Not undone: ${u.message ?? 'it couldn’t be put back.'}`;
}

export const confirmLabel = (n: number): string => `Confirm (${n})`;
/** What TalkBack hears for Confirm. */
export const confirmA11y = (n: number): string => `Confirm ${n} ${n === 1 ? 'change' : 'changes'}`;
export const undoButtonText = (leftMs: number): string => `Undo (${countdown(leftMs)})`;

/**
 * When Undo closes on the phone's clock (null: no undo window): the server's `undoUntil`, moved by
 * the gap between its clock and the phone's when the card was read (`serverNow` at `receivedAt`).
 */
export function undoDeadline(undoUntil: string | null, serverNow: string, receivedAt: number): number | null {
  if (!undoUntil) return null;
  const at = receivedAt + (Date.parse(undoUntil) - Date.parse(serverNow));
  return Number.isFinite(at) ? at : null;
}

// ── Editing a change before Confirm (Stage 3 Task 15) ──────────────────────────

/** Names to show for edited values (the card's labels are for what was proposed). */
export interface Shown {
  project?: string | null;
  assignees?: MicoAiNamed[];
  column?: string;
  attendees?: MicoAiNamed[];
}

/**
 * The person's edit to one change, as the website's card `edit`: the edits pile up per change, and
 * editing a change means it is wanted — it is ticked once nothing on it is left to put right.
 */
export function applyEdit(
  edits: Record<string, Record<string, unknown>>,
  item: ProposalChange,
  patch: Record<string, unknown>,
): { edits: Record<string, Record<string, unknown>>; tick: boolean } {
  const next = { ...edits[item.id], ...patch };
  return { edits: { ...edits, [item.id]: next }, tick: remainingNeeds(item, next).length === 0 };
}

/**
 * A change with the person's edits put in, and the names to show for them (the website's card
 * `effective`): a task change keeps only the fields it changes.
 */
export function effectiveChange(item: ProposalChange, edits: Record<string, unknown> | undefined, shown: Shown | undefined): ProposalChange {
  if (!edits && !shown) return item;
  const e = edits ?? {};
  const s = shown ?? {};
  switch (item.type) {
    case 'create_task':
      return { ...item, fields: { ...item.fields, ...e }, labels: { project: 'project' in s ? (s.project ?? null) : item.labels.project, assignees: s.assignees ?? item.labels.assignees } };
    case 'update_task': {
      const fields = { ...item.fields, ...Object.fromEntries(Object.entries(e).filter(([k]) => k in item.fields)) };
      return { ...item, fields, labels: { ...item.labels, ...(s.column !== undefined ? { column: s.column } : {}), ...(s.assignees ? { assignees: s.assignees } : {}) } };
    }
    case 'draft_minutes':
      return e.content ? { ...item, fields: { content: e.content as typeof item.fields.content } } : item;
    case 'schedule_meeting':
      return { ...item, fields: { ...item.fields, ...e }, labels: { project: 'project' in s ? (s.project ?? null) : item.labels.project, attendees: s.attendees ?? item.labels.attendees } };
  }
}

/** A meeting's lengths to choose from (the website's LENGTHS). */
export const LENGTH_CHOICES: readonly number[] = [15, 30, 45, 60, 90, 120];
/** The lengths, with the meeting's own when it is none of them. */
export function lengthChoices(current: number): number[] {
  return LENGTH_CHOICES.includes(current) ? [...LENGTH_CHOICES] : [...LENGTH_CHOICES, current].sort((a, b) => a - b);
}

/**
 * What holds Confirm back while a meeting time typed on the card doesn't read as one (`times`: what
 * was typed per change): the meeting would go with the time it had, not the one on screen.
 */
export function timeProblem(times: Record<string, string>): string | null {
  const bad = Object.values(times).some((t) => {
    const p = parseTimeInput(t);
    return !p.ok || !p.value;
  });
  return bad ? 'Put the meeting time right first: enter it as HH:MM, e.g. 09:30.' : null;
}

/** The longest a task title, a meeting title and a text may be (the website's editors). */
export const FIELD_MAX = { taskTitle: 190, meetingTitle: 200, text: 4000 } as const;
