import type { MinutesClientVisibility } from './client-share';
import type { ApiFinalMinutes, FinalMinutesContent } from './types';

/**
 * "Show to client" on a project meeting's approved final minutes — the website's
 * `MinutesClientSwitch.tsx` and `MinutesClientDialog.tsx`: their words and small rules.
 */
export const MINUTES_CLIENT_WORDS = {
  show: 'Show to client',
  visible: 'Visible to client',
  previewTitle: 'Show these minutes to the client?',
  previewIntro: 'This is exactly what the client will see on their page. The PDF the client can download has the same. Owners are left off the next steps.',
  namesNote: 'Highlighted: names of people on the project or at the meeting. If the client shouldn’t see them, cancel, reopen the minutes and edit them.',
  loading: 'Loading…',
  previewFailed: 'Couldn’t load the minutes. Close this and try again.',
  discussion: 'Discussion',
  decisions: 'Decisions',
  risks: 'Risks & open issues',
  nextSteps: 'Next steps',
  includeRisks: 'Include risks and open issues',
  includeRisksHint: 'Left out unless ticked: they are often internal.',
  changeFailed: 'Couldn’t change it. Please try again.',
  cancel: 'Cancel',
} as const;

/**
 * What the final minutes show about the client page: the switch for whoever runs the project, the
 * "Visible to client" mark for others while they are shown, nothing for a standalone meeting or
 * minutes that aren't final.
 */
export function showMinutesSwitch(v: MinutesClientVisibility | undefined, minutes: Pick<ApiFinalMinutes, 'status' | 'content'> | undefined): 'switch' | 'chip' | null {
  if (!v || v.projectMeeting !== true || minutes?.status !== 'FINAL' || !minutes.content) return null;
  if (v.canChange) return 'switch';
  return v.clientVisible ? 'chip' : null;
}

/** Under the switch: what showing them does, or — while shown — whether the risks go too. */
export function minutesHint(v: MinutesClientVisibility): string {
  return v.clientVisible
    ? `Shown on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). Risks and open issues are ${v.includeRisks ? 'included' : 'left out'}. Reopening the minutes or moving the meeting to another project takes them off.`
    : 'Puts these final minutes on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). You see exactly what the client will see first.';
}

/** The preview's parts after its summary, in the website's order; the risks only while ticked. */
export function previewParts(c: FinalMinutesContent, includeRisks: boolean): Array<{ title: string; kind: 'discussion' | 'list'; items: string[] }> {
  const parts: Array<{ title: string; kind: 'discussion' | 'list'; items: string[] }> = [];
  if (c.discussion.length) parts.push({ title: MINUTES_CLIENT_WORDS.discussion, kind: 'discussion', items: [] });
  if (c.decisions.length) parts.push({ title: MINUTES_CLIENT_WORDS.decisions, kind: 'list', items: c.decisions });
  if (includeRisks && c.risks.length) parts.push({ title: MINUTES_CLIENT_WORDS.risks, kind: 'list', items: c.risks });
  if (c.nextSteps.length) parts.push({ title: MINUTES_CLIENT_WORDS.nextSteps, kind: 'list', items: c.nextSteps });
  return parts;
}
