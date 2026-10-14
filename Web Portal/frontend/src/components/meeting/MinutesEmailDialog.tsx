import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { meetingsApi, type Meeting } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { meetingFailure, exportMinutes } from './meeting-actions';
import { SendResults } from './InviteDialog';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Email the minutes PDF: shows the email as it will arrive (subject, body, attachment) and who
 * gets it — anyone can be left out before sending.
 */
export function MinutesEmailDialog({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  const previewQ = useQuery({
    queryKey: ['meeting', meeting.id, 'minutes-preview'],
    queryFn: () => meetingsApi(apiClient).previewMinutes(meeting.id),
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data;
  const [left, setLeft] = useState<Set<string>>(new Set());
  const chosen = preview ? preview.recipients.filter((r) => !left.has(r.email)) : [];
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => {
      const all = chosen.length === preview!.recipients.length;
      return meetingsApi(apiClient).sendMinutes(meeting.id, all ? undefined : chosen.map((r) => r.email));
    },
    onError: (err) => setError(meetingFailure(err, 'Couldn’t email the minutes.')),
  });

  const toggle = (email: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={send.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="minutes-title" className="card relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl animate-scale-in flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 id="minutes-title" className="font-display text-lg font-semibold text-ink">Email the minutes</h2>
            <p className="mt-0.5 text-sm text-ink-2">The minutes go as a PDF attachment. Check the email and choose who gets it.</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {send.isSuccess ? (
              <SendResults report={send.data} what="Minutes" />
            ) : previewQ.isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-40 w-full" />
              </div>
            ) : previewQ.isError || !preview ? (
              <p role="alert" className="text-sm text-danger">
                {meetingFailure(previewQ.error, 'Couldn’t prepare the email.')}{' '}
                <button type="button" onClick={() => void previewQ.refetch()} className="font-semibold underline">Retry</button>
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
                <div className="flex min-w-0 flex-col gap-2">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-ink-3">Subject</dt>
                    <dd className="min-w-0 font-medium text-ink"><bdi>{preview.subject}</bdi></dd>
                    <dt className="text-ink-3">Attached</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
                      <span>{preview.attachmentName}</span>
                      <button
                        type="button"
                        onClick={() => { setPdfError(null); void exportMinutes(meeting).catch((err) => setPdfError(meetingFailure(err, 'Couldn’t open the PDF.'))); }}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        Download to check
                      </button>
                    </dd>
                  </dl>
                  {pdfError ? <p role="alert" className="text-xs text-danger">{pdfError}</p> : null}
                  {/* The real email, sandboxed: no scripts, no navigation. */}
                  <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-72 w-full rounded-lg border border-line bg-white" />
                </div>
                <fieldset className="min-w-0">
                  <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Send to ({chosen.length} of {preview.recipients.length})
                  </legend>
                  <div className="mb-1 flex gap-3 text-xs">
                    <button type="button" onClick={() => setLeft(new Set())} className="font-medium text-brand hover:underline">All</button>
                    <button type="button" onClick={() => setLeft(new Set(preview.recipients.map((r) => r.email)))} className="font-medium text-brand hover:underline">None</button>
                  </div>
                  <ul className="flex max-h-72 flex-col overflow-y-auto">
                    {preview.recipients.map((r) => (
                      <li key={r.email}>
                        <label className="flex min-h-10 items-start gap-2 rounded px-1 py-1.5 text-sm hover:bg-ground">
                          <input type="checkbox" checked={!left.has(r.email)} onChange={() => toggle(r.email)} className="mt-0.5 h-4 w-4 shrink-0 accent-[color:rgb(var(--c-brand))]" />
                          <span className="min-w-0">
                            <bdi className="block truncate font-medium text-ink">{r.name}</bdi>
                            <span className="block truncate text-xs text-ink-3">{r.email}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {preview.missingEmail.length ? (
                    <p className="mt-2 text-xs text-ink-2">No email address: {preview.missingEmail.map((m) => m.name).join(', ')}.</p>
                  ) : null}
                </fieldset>
              </div>
            )}
            {error && !send.isSuccess ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={send.isPending}>{send.isSuccess ? 'Done' : 'Cancel'}</Button>
            {send.isSuccess ? null : (
              <Button onClick={() => { setError(null); send.mutate(); }} loading={send.isPending} disabled={!preview || chosen.length === 0}>
                Send to {people(chosen.length)}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
