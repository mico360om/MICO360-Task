import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, seriesIdOf, type Meeting, type SeriesScope } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { downloadBlob } from '../../lib/download';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SeriesScopeChoice } from './series-scope';

/** Our sentence, plus the server's reason for a rejected request (and a plain word for 403). */
export function meetingFailure(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    // The server knows for certain (503): say it plainly rather than "may not be configured".
    if (err.code === 'EMAIL_NOT_CONFIGURED') return `${fallback} Email isn’t set up on this server, so nothing was sent — ask your administrator.`;
    if (err.status === 403) return `${fallback} You don’t have permission to do that.`;
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return `${fallback} ${err.message}`;
  }
  if (err instanceof TypeError) return `${fallback} Check your connection and try again.`;
  return fallback;
}

/** "minutes-weekly-sync.pdf", or "minutes-final-weekly-sync.pdf" (Arabic or empty titles fall back to "meeting"). */
export function minutesFileName(title: string, version: 'working' | 'final' = 'working'): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
  return `minutes-${version === 'final' ? 'final-' : ''}${slug}.pdf`;
}

/** Download the minutes PDF of a meeting: the working minutes, or the approved final minutes. */
export async function exportMinutes(meeting: Pick<Meeting, 'id' | 'title'>, version: 'working' | 'final' = 'working'): Promise<void> {
  const blob = await meetingsApi(apiClient).exportMinutesPdf(meeting.id, version);
  downloadBlob(minutesFileName(meeting.title, version), blob);
}

/** Refresh everything that shows meetings: lists, the calendar, project dashboards and this meeting. */
export function useInvalidateMeetings() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['meeting'] });
    void qc.invalidateQueries({ queryKey: ['meeting', id] });
  };
}

/**
 * Cancel a meeting after asking — in a series, just this one or all its upcoming meetings.
 * Invited people are told; the meetings stay listed as Cancelled.
 */
export function CancelMeetingDialog({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone?: (scope: SeriesScope) => void }) {
  const invalidate = useInvalidateMeetings();
  const inSeries = !!seriesIdOf(meeting);
  const [scope, setScope] = useState<SeriesScope>('one');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => meetingsApi(apiClient).cancel(meeting.id, scope),
    onSuccess: () => {
      invalidate(meeting.id);
      onDone?.(scope);
      onClose();
    },
    onError: (err) => setError(meetingFailure(err, scope === 'series' ? 'Couldn’t cancel the meetings.' : 'Couldn’t cancel the meeting.')),
  });
  const notified = meeting.invitesSentAt ? 'Everyone who was invited gets a cancellation notice.' : 'No invitations went out, so nobody is notified.';
  return (
    <ConfirmDialog
      title={inSeries ? 'Cancel a repeating meeting?' : 'Cancel this meeting?'}
      confirmLabel={scope === 'series' ? 'Cancel meetings' : 'Cancel meeting'}
      keepLabel="Keep meeting"
      busy={mut.isPending}
      error={error}
      onConfirm={() => mut.mutate()}
      onClose={onClose}
    >
      {inSeries ? (
        <>
          <p><bdi className="font-medium text-ink">{meeting.title}</bdi> repeats. {notified}</p>
          <SeriesScopeChoice
            value={scope}
            onChange={setScope}
            one={{ label: 'This meeting only', hint: 'It stays in the list, marked Cancelled; the others go ahead.' }}
            series={{ label: 'All upcoming meetings in the series', hint: 'Each is marked Cancelled and no more are created. Meetings already held stay as they were.' }}
          />
        </>
      ) : (
        <p>
          <bdi className="font-medium text-ink">{meeting.title}</bdi> stays in the list, marked Cancelled. {notified}
        </p>
      )}
    </ConfirmDialog>
  );
}

/** Delete a meeting for good, after asking — in a series, just this one or all its upcoming meetings. */
export function DeleteMeetingDialog({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone?: (scope: SeriesScope) => void }) {
  const invalidate = useInvalidateMeetings();
  const inSeries = !!seriesIdOf(meeting);
  const [scope, setScope] = useState<SeriesScope>('one');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => meetingsApi(apiClient).remove(meeting.id, scope),
    onSuccess: () => {
      invalidate(meeting.id);
      onDone?.(scope);
      onClose();
    },
    onError: (err) => setError(meetingFailure(err, scope === 'series' ? 'Couldn’t delete the meetings.' : 'Couldn’t delete the meeting.')),
  });
  const notified = meeting.invitesSentAt && meeting.status !== 'CANCELLED' ? ' Invited people get a cancellation notice.' : '';
  return (
    <ConfirmDialog
      title={inSeries ? 'Delete a repeating meeting?' : 'Delete this meeting?'}
      confirmLabel={scope === 'series' ? 'Delete meetings' : 'Delete meeting'}
      keepLabel="Keep meeting"
      busy={mut.isPending}
      error={error}
      onConfirm={() => mut.mutate()}
      onClose={onClose}
    >
      <p>
        {scope === 'series' ? 'The upcoming meetings' : <bdi className="font-medium text-ink">{meeting.title}</bdi>} and {scope === 'series' ? 'their' : 'its'} agenda, notes and action items are removed. This can’t be undone.
        {notified}
      </p>
      {inSeries ? (
        <SeriesScopeChoice
          value={scope}
          onChange={setScope}
          one={{ label: 'This meeting only', hint: 'The rest of the series goes ahead.' }}
          series={{ label: 'All upcoming meetings in the series', hint: 'No more are created. Meetings already held stay, with their minutes.' }}
        />
      ) : null}
      <p className="mt-2">To keep the record but call it off, cancel the meeting instead.</p>
    </ConfirmDialog>
  );
}

/** Copy a meeting's details (not its agenda, people or notes) as a new draft. */
export function useDuplicateMeeting(onCopied: (copy: Meeting) => void, onError: (message: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meetingsApi(apiClient).duplicate(id),
    onSuccess: (copy) => {
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      onCopied(copy);
    },
    onError: (err) => onError(meetingFailure(err, 'Couldn’t duplicate the meeting.')),
  });
}
