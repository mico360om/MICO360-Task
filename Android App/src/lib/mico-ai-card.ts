import type { MicoAiProposal, ProposalChange, ProposalResult, ProposalUndo } from './mico-ai-api';
import { countdown, resultSummary, undoSummary } from './mico-ai-proposal';

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
