/**
 * The final minutes of a meeting (the "Final MOM"), as on the website (FinalMinutesSection): the
 * organizer starts from a draft — written by the AI from the meeting's agenda, notes and action
 * items, or put together from the notes — edits it, saves it and marks it final. Final minutes are
 * read-only until reopened. Pure, so it is tested here.
 */
import { ApiError, isNetworkError } from './api-client';
import { meetingFailure } from './meeting-flow';
import type { FinalMinutesContent } from './types';

/** The editor's copy: each list is kept as typed text (one item per line) until it is saved. */
export interface MinutesEditing {
  summary: string;
  discussion: Array<{ topic: string; text: string }>;
  decisions: string;
  risks: string;
  nextSteps: string;
}

export const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function toEditing(c: FinalMinutesContent): MinutesEditing {
  return {
    summary: c.summary,
    discussion: c.discussion.map((d) => ({ ...d })),
    decisions: c.decisions.join('\n'),
    risks: c.risks.join('\n'),
    nextSteps: c.nextSteps.join('\n'),
  };
}

export function toContent(e: MinutesEditing): FinalMinutesContent {
  return {
    summary: e.summary.trim(),
    discussion: e.discussion.map((d) => ({ topic: d.topic.trim(), text: d.text.trim() })).filter((d) => d.topic || d.text),
    decisions: linesOf(e.decisions),
    risks: linesOf(e.risks),
    nextSteps: linesOf(e.nextSteps),
  };
}

export function isEmptyContent(c: FinalMinutesContent): boolean {
  return !c.summary && !c.discussion.length && !c.decisions.length && !c.risks.length && !c.nextSteps.length;
}

/** Where a new draft came from (it isn't kept until it is saved). */
export function draftNotice(source: 'ai' | 'notes'): string {
  return source === 'ai'
    ? 'Drafted by the AI from the meeting’s agenda, notes and action items. Check it, then save it.'
    : 'Put together from the meeting’s notes. Edit it, then save it.';
}

/**
 * Why no draft came. The AI running out of time is the AI being slow (a model still loading), not a
 * lost connection; when the AI failed, the notes are offered instead.
 */
export function draftFailure(e: unknown, source: 'ai' | 'notes'): { text: string; offerNotes: boolean } {
  if (source === 'ai' && isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) {
    return { text: 'The AI is taking longer than usual. Try again in a minute, or start from the notes.', offerNotes: true };
  }
  return { text: meetingFailure(e, 'Couldn’t make a draft.'), offerNotes: source === 'ai' };
}

/** Why saving, approving or reopening failed; minutes marked final elsewhere say so. */
export function minutesSaveFailure(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === 'FINAL_MINUTES_LOCKED') return 'These minutes were marked final meanwhile. Reopen them to make changes.';
  return meetingFailure(e, fallback);
}
