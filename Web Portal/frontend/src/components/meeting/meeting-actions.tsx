import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type Meeting } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { downloadBlob } from '../../lib/download';
import { ConfirmDialog } from '../ui/ConfirmDialog';

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

/** "minutes-weekly-sync.pdf" (Arabic or empty titles fall back to "meeting"). */
export function minutesFileName(title: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
  return `minutes-${slug}.pdf`;
}

/** Download the minutes PDF of a meeting. */
export async function exportMinutes(meeting: Pick<Meeting, 'id' | 'title'>): Promise<void> {
  const blob = await meetingsApi(apiClient).exportMinutesPdf(meeting.id);
  downloadBlob(minutesFileName(meeting.title), blob);
}

function useInvalidateMeetings() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['meeting', id] });
  };
}

/** Cancel a meeting after asking. Invited people are told; the meeting stays listed as Cancelled. */
export function CancelMeetingDialog({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone?: () => void }) {
  const invalidate = useInvalidateMeetings();
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => meetingsApi(apiClient).cancel(meeting.id),
    onSuccess: () => {
      invalidate(meeting.id);
      onDone?.();
      onClose();
    },
    onError: (err) => setError(meetingFailure(err, 'Couldn’t cancel the meeting.')),
  });
  return (
    <ConfirmDialog title="Cancel this meeting?" confirmLabel="Cancel meeting" keepLabel="Keep meeting" busy={mut.isPending} error={error} onConfirm={() => mut.mutate()} onClose={onClose}>
      <p>
        <bdi className="font-medium text-ink">{meeting.title}</bdi> stays in the list, marked Cancelled.{' '}
        {meeting.invitesSentAt ? 'Everyone who was invited gets a cancellation notice.' : 'No invitations went out, so nobody is notified.'}
      </p>
    </ConfirmDialog>
  );
}

/** Delete a meeting for good, after asking. */
export function DeleteMeetingDialog({ meeting, onClose, onDone }: { meeting: Meeting; onClose: () => void; onDone?: () => void }) {
  const invalidate = useInvalidateMeetings();
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => meetingsApi(apiClient).remove(meeting.id),
    onSuccess: () => {
      invalidate(meeting.id);
      onDone?.();
      onClose();
    },
    onError: (err) => setError(meetingFailure(err, 'Couldn’t delete the meeting.')),
  });
  return (
    <ConfirmDialog title="Delete this meeting?" confirmLabel="Delete meeting" keepLabel="Keep meeting" busy={mut.isPending} error={error} onConfirm={() => mut.mutate()} onClose={onClose}>
      <p>
        <bdi className="font-medium text-ink">{meeting.title}</bdi> and its agenda, notes and action items are removed. This can’t be undone.
        {meeting.invitesSentAt && meeting.status !== 'CANCELLED' ? ' Invited people get a cancellation notice.' : ''}
      </p>
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
