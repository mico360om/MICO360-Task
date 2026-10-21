/**
 * Invitations and the minutes email (2b), as on the website (InviteDialog, MinutesEmailDialog): who
 * gets them, what the button says, and what happened to each email. Once invitations went out, the
 * default is to invite only the people added since — everyone again is an explicit choice (the
 * server refuses it otherwise, so a double tap can't mail everyone twice). Pure, so it is tested.
 */
import { ApiError, isNetworkError } from './api-client';
import { meetingFailure } from './meeting-flow';
import type { ApiMeeting, InvitePreview, MinutesPreview, Recipient, SendReport } from './types';

export const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export interface InviteChoice {
  /** When invitations last went out (null = never). */
  sentBefore: string | null;
  /** The people not invited yet. */
  fresh: Recipient[];
  effective: 'new' | 'all';
  targets: Recipient[];
  /** Something must be fixed before anything can be sent. */
  blocked: boolean;
  sendLabel: string;
}

/** Who the invitations go to, given the preview and the choice made (null = the default). */
export function inviteChoice(preview: InvitePreview, m: Pick<ApiMeeting, 'status' | 'invitesSentAt'>, mode: 'new' | 'all' | null): InviteChoice {
  const sentBefore = preview.invitesSentAt ?? m.invitesSentAt ?? null;
  const fresh = preview.recipients.filter((r) => !r.alreadyInvited);
  const effective = mode ?? (sentBefore && fresh.length > 0 ? 'new' : 'all');
  const targets = sentBefore && effective === 'new' ? fresh : preview.recipients;
  return {
    sentBefore,
    fresh,
    effective,
    targets,
    blocked: preview.problems.some((p) => p.level === 'error'),
    sendLabel: `${m.status === 'DRAFT' ? 'Schedule and send' : 'Send'} to ${people(targets.length)}`,
  };
}

/** What the send asks the server for. */
export function inviteRequest(c: Pick<InviteChoice, 'sentBefore' | 'effective'>): { onlyNew?: boolean; resend?: boolean } {
  if (!c.sentBefore) return {};
  return c.effective === 'new' ? { onlyNew: true } : { resend: true };
}

/**
 * Why a send (invitations, the minutes) didn't report back. One that got no answer may still be
 * going: the next tap sends the same key, so the server reports the first send instead of mailing
 * everyone twice.
 */
export function sendFailure(e: unknown, fallback: string): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) {
    return 'The server took too long to answer — it may still be sending. Tap Send again to see what happened: nobody gets it twice.';
  }
  if (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS') return 'Still sending — try again in a moment.';
  return meetingFailure(e, fallback);
}

/** Whether the next tap is the same send (no answer came, or it's still going) or a new one. */
export function keepsSendKey(e: unknown): boolean {
  return isNetworkError(e) || (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS');
}

/** Why the invitations weren't sent; `reload` when the preview is out of date (sent elsewhere meanwhile). */
export function inviteFailure(e: unknown): { text: string; reload: boolean } {
  if (e instanceof ApiError && e.code === 'INVITES_ALREADY_SENT') {
    return { text: 'Invitations were just sent from somewhere else. Check who has one, then choose again.', reload: true };
  }
  return { text: sendFailure(e, 'Couldn’t send the invitations.'), reload: false };
}

/** "Invitation sent to 2 of 3. 1 couldn’t be delivered." */
export function sendSummary(report: SendReport, what: string): { text: string; failed: boolean } {
  const failed = report.failed ?? 0;
  const total = report.recipients?.length ?? report.sent + failed;
  return { text: `${what} sent to ${report.sent} of ${total}.${failed ? ` ${failed} couldn’t be delivered.` : ''}`, failed: failed > 0 };
}

/** The minutes go to everyone, or — once someone is left out — only to the addresses chosen. */
export function minutesChoice(preview: MinutesPreview, left: Set<string>): { chosen: Recipient[]; recipients: string[] | undefined; sendLabel: string; canSend: boolean } {
  const chosen = preview.recipients.filter((r) => !left.has(r.email));
  return {
    chosen,
    recipients: chosen.length === preview.recipients.length ? undefined : chosen.map((r) => r.email),
    sendLabel: `Send to ${people(chosen.length)}`,
    canSend: chosen.length > 0,
  };
}
