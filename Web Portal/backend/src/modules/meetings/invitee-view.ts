import { HttpError } from '../../lib/http-errors';
import { COMPANY_WORDS } from '../companies/company-rules';

/**
 * Companies (spec §8.8): how someone sees a meeting.
 *   'full'    — today's view: its notes, decisions, files, drafts, edits (as their rights allow);
 *   'invitee' — invited (or organizing) from outside the project's companies: the meeting itself, its
 *               people and agenda, the approved minutes and their own action items — nothing else;
 *   null      — not at all.
 */
export type MeetingView = 'full' | 'invitee' | null;
export type MeetingViewOf = (userId: string, roles: string[], meetingId: string) => Promise<MeetingView>;

/** 403 INVITEE_ONLY: the part of a meeting an invitee from another company doesn't get. */
export class InviteeOnlyError extends HttpError {
  constructor() {
    super(COMPANY_WORDS.inviteeOnly, 'INVITEE_ONLY', 403);
  }
}

/**
 * The full-view check the meeting routes use: true for the full view, false for no view, and an
 * invitee is refused with INVITEE_ONLY (so every route outside the invitee view says so).
 */
export function fullViewOrInviteeRefusal(viewOf: MeetingViewOf): (userId: string, roles: string[], meetingId: string) => Promise<boolean> {
  return async (userId, roles, meetingId) => {
    const view = await viewOf(userId, roles, meetingId);
    if (view === 'invitee') throw new InviteeOnlyError();
    return view === 'full';
  };
}
