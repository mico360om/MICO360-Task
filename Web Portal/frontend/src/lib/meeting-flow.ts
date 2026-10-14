import type { InvitationResponse, MeetingStatus } from '../api/meetings';

/** The one main button on a meeting: the next step for its status. */
export type PrimaryAction = 'schedule' | 'invite' | 'start' | 'end' | 'email-minutes' | 'export-minutes' | 'duplicate';

export function primaryAction(m: { status: MeetingStatus; invitesSentAt: string | null }, canEdit: boolean): PrimaryAction | null {
  if (!canEdit) return m.status === 'COMPLETED' ? 'export-minutes' : null;
  switch (m.status) {
    case 'DRAFT':
      return 'schedule';
    case 'SCHEDULED':
      return m.invitesSentAt ? 'start' : 'invite';
    case 'IN_PROGRESS':
      return 'end';
    case 'COMPLETED':
      return 'email-minutes';
    default:
      return 'duplicate';
  }
}

/** Planned agenda minutes against the meeting's own length (null when it has no end time). */
export function agendaTiming(items: { expectedMinutes: number | null }[], startAt: string, endAt: string | null) {
  const planned = items.reduce((sum, i) => sum + (i.expectedMinutes ?? 0), 0);
  const unplanned = items.filter((i) => i.expectedMinutes == null).length;
  const length = endAt ? Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000) : null;
  return { planned, length, over: length !== null && planned > length ? planned - length : 0, unplanned };
}

/** How many people gave each answer (older rows without one count as no response). */
export function responseSummary(attendees: { response?: InvitationResponse }[]): Record<InvitationResponse, number> {
  const out: Record<InvitationResponse, number> = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0, PENDING: 0 };
  for (const a of attendees) out[a.response ?? 'PENDING'] += 1;
  return out;
}
