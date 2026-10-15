import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, type Meeting, type Recipient, type SendReport } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { meetingFailure } from './meeting-actions';
import { formatMeetingDay } from '../../lib/meetingFormat';

const KIND: Record<Recipient['kind'], string> = { organizer: 'Organizer', member: 'Team', guest: 'Guest' };
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** The send's outcome, person by person. */
export function SendResults({ report, what }: { report: SendReport; what: string }) {
  const total = report.recipients?.length ?? report.sent + (report.failed ?? 0);
  const failed = report.failed ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={`rounded-lg px-3 py-2 text-sm font-medium ${failed ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
        {what} sent to {report.sent} of {total}.{failed ? ` ${failed} couldn’t be delivered.` : ''}
      </p>
      {report.recipients?.length ? (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
          {report.recipients.map((r) => (
            <li key={r.email} className="flex items-start gap-2 px-3 py-2">
              <span aria-hidden="true" className={r.ok ? 'text-success' : 'text-danger'}>{r.ok ? '✓' : '✕'}</span>
              <span className="min-w-0 flex-1">
                <bdi className="font-medium text-ink">{r.name}</bdi> <span className="text-ink-3">{r.email}</span>
                {!r.ok ? <span className="block text-xs text-danger">{r.error ?? 'Not delivered.'}</span> : <span className="sr-only">delivered</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {report.skipped?.length ? (
        <p className="text-xs text-ink-2">Skipped (no email address): {report.skipped.map((s) => s.name).join(', ')}</p>
      ) : null}
    </div>
  );
}

/**
 * Check the meeting and its recipients, then send calendar invitations. Once invitations went
 * out, the default is to invite only the people added since — sending everyone an updated
 * invitation is an explicit choice. A draft is scheduled as it is sent.
 */
export function InviteDialog({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const draft = meeting.status === 'DRAFT';
  const previewQ = useQuery({
    queryKey: ['meeting', meeting.id, 'invite-preview'],
    queryFn: () => meetingsApi(apiClient).previewInvites(meeting.id),
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data;
  const sentBefore = preview?.invitesSentAt ?? meeting.invitesSentAt;
  const fresh = preview?.recipients.filter((r) => !r.alreadyInvited) ?? [];
  const [mode, setMode] = useState<'new' | 'all' | null>(null);
  const effective = mode ?? (sentBefore && fresh.length > 0 ? 'new' : 'all');
  const targets = preview ? (sentBefore && effective === 'new' ? fresh : preview.recipients) : [];
  const blocked = preview?.problems.some((p) => p.level === 'error') ?? true;
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      if (draft) await meetingsApi(apiClient).update(meeting.id, { status: 'SCHEDULED' });
      const api = meetingsApi(apiClient);
      return sentBefore ? api.sendInvites(meeting.id, effective === 'new' ? { onlyNew: true } : { resend: true }) : api.sendInvites(meeting.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'INVITES_ALREADY_SENT') {
        setError('Invitations were just sent from somewhere else. Check who has one, then choose again.');
        void previewQ.refetch();
        return;
      }
      setError(meetingFailure(err, 'Couldn’t send the invitations.'));
      void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
    },
  });

  const sendLabel = `${draft ? 'Schedule and send' : 'Send'} to ${people(targets.length)}`;

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={send.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="invite-title" className="card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="invite-title" className="font-display text-lg font-semibold text-ink">Send invitations</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              A calendar invitation (.ics) for <bdi className="font-medium text-ink">{meeting.title}</bdi>.
              {draft ? ' Sending also moves this draft to Scheduled.' : ''}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {send.isSuccess ? (
              <SendResults report={send.data} what="Invitation" />
            ) : previewQ.isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-10 w-full" />
                <div className="skeleton h-10 w-full" />
              </div>
            ) : previewQ.isError || !preview ? (
              <p role="alert" className="text-sm text-danger">
                {meetingFailure(previewQ.error, 'Couldn’t check the invitation.')}{' '}
                <button type="button" onClick={() => void previewQ.refetch()} className="font-semibold underline">Retry</button>
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {preview.problems.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {preview.problems.map((p) => (
                      <li key={p.message} role={p.level === 'error' ? 'alert' : undefined} className={`rounded-lg px-3 py-2 text-sm ${p.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                        {p.level === 'error' ? 'Fix first: ' : 'Check: '}
                        {p.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">Everything needed for the invitation is in place.</p>
                )}

                {sentBefore ? (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1 text-sm font-medium text-ink">
                      Invitations already went out on {formatMeetingDay(sentBefore)}. Send to:
                    </legend>
                    <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
                      <input type="radio" name="invite-mode" checked={effective === 'new'} disabled={fresh.length === 0} onChange={() => setMode('new')} className="h-4 w-4 accent-[color:rgb(var(--c-brand))]" />
                      Only people not invited yet ({fresh.length})
                    </label>
                    <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
                      <input type="radio" name="invite-mode" checked={effective === 'all'} onChange={() => setMode('all')} className="h-4 w-4 accent-[color:rgb(var(--c-brand))]" />
                      Everyone again ({preview.recipients.length}) — an updated invitation
                    </label>
                  </fieldset>
                ) : null}

                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Recipients ({targets.length})</h3>
                  <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
                    {preview.recipients.map((r) => {
                      const included = targets.includes(r);
                      return (
                        <li key={r.email} className={`flex items-center gap-2 px-3 py-2 ${included ? '' : 'opacity-50'}`}>
                          <span className="min-w-0 flex-1 truncate">
                            <bdi className="font-medium text-ink">{r.name}</bdi> <span className="text-ink-3">{r.email}</span>
                          </span>
                          <span className="shrink-0 text-xs text-ink-3">{KIND[r.kind]}</span>
                          {r.alreadyInvited ? <span className="shrink-0 rounded bg-ground px-1.5 py-0.5 text-[11px] text-ink-2">Already invited</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                  {preview.missingEmail.length ? (
                    <p className="mt-2 text-xs text-ink-2">No email address, so no invitation: {preview.missingEmail.map((m) => m.name).join(', ')}.</p>
                  ) : null}
                </div>
                {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={send.isPending}>{send.isSuccess ? 'Done' : 'Cancel'}</Button>
            {send.isSuccess ? null : (
              <Button onClick={() => { setError(null); send.mutate(); }} loading={send.isPending} disabled={!preview || blocked || targets.length === 0}>
                {sendLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
