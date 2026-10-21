/**
 * Running a meeting (2b), as on the website (MeetingDetailPage, meeting-flow, meeting-actions): the
 * one main button for its status, the other actions, the cancel and delete questions, and what to
 * say after a change. Everything is offered only to someone the server lets run the meeting
 * (`canEdit`); the server checks again. Pure, so it is tested here.
 */
import { ApiError, isNetworkError } from './api-client';
import { seriesIdOf } from './meeting-form';
import type { ApiMeeting, MeetingStatus, SeriesScope } from './types';

/** The one main button on a meeting: the next step for its status. */
export type PrimaryAction = 'schedule' | 'invite' | 'start' | 'end' | 'email-minutes' | 'export-minutes' | 'duplicate';

export const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  schedule: 'Schedule & invite',
  invite: 'Send invitations',
  start: 'Start meeting',
  end: 'End meeting',
  'email-minutes': 'Email minutes…',
  'export-minutes': 'Export minutes (PDF)',
  duplicate: 'Duplicate',
};

export function primaryAction(m: Pick<ApiMeeting, 'status' | 'invitesSentAt'>, canEdit: boolean): PrimaryAction | null {
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

export type MenuKey = 'edit' | 'schedule-quietly' | 'invite' | 'start' | 'email-minutes' | 'export-minutes' | 'duplicate' | 'cancel' | 'delete';

export interface MenuItem {
  key: MenuKey;
  label: string;
  danger?: boolean;
}

/** Everything that isn't the main button; the destructive pair comes last. */
export function meetingMenu(m: Pick<ApiMeeting, 'status' | 'invitesSentAt'>, canEdit: boolean): MenuItem[] {
  const primary = primaryAction(m, canEdit);
  const ended = m.status === 'CANCELLED' || m.status === 'COMPLETED';
  const items: MenuItem[] = [];
  if (canEdit && m.status !== 'CANCELLED') items.push({ key: 'edit', label: 'Edit details' });
  if (canEdit && m.status === 'DRAFT') items.push({ key: 'schedule-quietly', label: 'Schedule without inviting' });
  if (canEdit && !ended && primary !== 'invite' && primary !== 'schedule') items.push({ key: 'invite', label: 'Invitations…' });
  if (canEdit && m.status === 'SCHEDULED' && primary !== 'start') items.push({ key: 'start', label: 'Start meeting' });
  if (canEdit && m.status !== 'CANCELLED' && primary !== 'email-minutes') items.push({ key: 'email-minutes', label: 'Email minutes…' });
  if (primary !== 'export-minutes') items.push({ key: 'export-minutes', label: PRIMARY_LABEL['export-minutes'] });
  if (primary !== 'duplicate') items.push({ key: 'duplicate', label: 'Duplicate' });
  if (canEdit && !ended) items.push({ key: 'cancel', label: 'Cancel meeting…', danger: true });
  if (canEdit) items.push({ key: 'delete', label: 'Delete meeting…', danger: true });
  return items;
}

export interface ScopeOption {
  label: string;
  hint: string;
}

export interface ConfirmDialog {
  title: string;
  body: string;
  confirm: string;
  keep: string;
  /** In a series: "This meeting only" or "All upcoming meetings in the series". */
  scopes: { one: ScopeOption; series: ScopeOption } | null;
  /** What to say once it is done. */
  done: string;
  hint?: string;
}

type SeriesFacts = Pick<ApiMeeting, 'id' | 'title' | 'invitesSentAt' | 'recurrenceRule' | 'recurrenceParentId'>;

/** Cancel a meeting (in a series: this one or all upcoming). Invited people are told; it stays listed as Cancelled. */
export function cancelDialog(m: SeriesFacts, scope: SeriesScope): ConfirmDialog {
  const inSeries = !!seriesIdOf(m);
  const notified = m.invitesSentAt ? 'Everyone who was invited gets a cancellation notice.' : 'No invitations went out, so nobody is notified.';
  return {
    title: inSeries ? 'Cancel a repeating meeting?' : 'Cancel this meeting?',
    body: inSeries ? `“${m.title}” repeats. ${notified}` : `“${m.title}” stays in the list, marked Cancelled. ${notified}`,
    confirm: scope === 'series' ? 'Cancel meetings' : 'Cancel meeting',
    keep: 'Keep meeting',
    scopes: inSeries
      ? {
          one: { label: 'This meeting only', hint: 'It stays in the list, marked Cancelled; the others go ahead.' },
          series: { label: 'All upcoming meetings in the series', hint: 'Each is marked Cancelled and no more are created. Meetings already held stay as they were.' },
        }
      : null,
    done: scope === 'series' ? 'The upcoming meetings of the series are cancelled.' : 'Meeting cancelled.',
  };
}

/** Delete a meeting for good (in a series: this one or all upcoming), after asking. */
export function deleteDialog(m: SeriesFacts & Pick<ApiMeeting, 'status'>, scope: SeriesScope): ConfirmDialog {
  const inSeries = !!seriesIdOf(m);
  const notified = m.invitesSentAt && m.status !== 'CANCELLED' ? ' Invited people get a cancellation notice.' : '';
  const what = scope === 'series' ? 'The upcoming meetings and their' : `“${m.title}” and its`;
  return {
    title: inSeries ? 'Delete a repeating meeting?' : 'Delete this meeting?',
    body: `${what} agenda, notes and action items are removed. This can’t be undone.${notified}`,
    confirm: scope === 'series' ? 'Delete meetings' : 'Delete meeting',
    keep: 'Keep meeting',
    scopes: inSeries
      ? {
          one: { label: 'This meeting only', hint: 'The rest of the series goes ahead.' },
          series: { label: 'All upcoming meetings in the series', hint: 'No more are created. Meetings already held stay, with their minutes.' },
        }
      : null,
    done: scope === 'series' ? 'The upcoming meetings of the series are deleted.' : 'Meeting deleted.',
    hint: 'To keep the record but call it off, cancel the meeting instead.',
  };
}

/** "minutes-weekly-sync.pdf", or "minutes-final-…" once final (Arabic or empty titles: "meeting"). */
export function minutesFileName(title: string, final = false): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'meeting';
  return `minutes-${final ? 'final-' : ''}${slug}.pdf`;
}

/** What to say after the status changed from the meeting's page. */
export function statusNotice(status: MeetingStatus): string {
  if (status === 'IN_PROGRESS') return 'The meeting has started.';
  if (status === 'COMPLETED') return 'The meeting has ended. You can now send the minutes.';
  return 'Saved.';
}

/** Is this the server saying email isn't set up (so nothing was sent)? */
function emailNotSetUp(e: ApiError): boolean {
  return e.code === 'EMAIL_NOT_CONFIGURED' || (e.status === 503 && /email is not configured/i.test(e.message));
}

/**
 * Our sentence, plus the server's reason for a refused request (and plain words for 403, for email
 * not set up and for no connection) — the website's meetingFailure.
 */
export function meetingFailure(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return `${fallback} You’re offline — this needs a connection.`;
  if (e instanceof ApiError) {
    if (emailNotSetUp(e)) return `${fallback} Email isn’t set up on this server, so nothing was sent — ask your administrator.`;
    if (e.status === 403) return `${fallback} You don’t have permission to do that.`;
    if (e.status >= 400 && e.status < 500 && e.message && !/^Request failed/.test(e.message)) return `${fallback} ${e.message}`;
  }
  return fallback;
}
