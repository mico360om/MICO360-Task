import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { clientSharesApi } from '../../api/client-shares';
import { ApiError } from '../../lib/api-client';
import { Toggle } from '../ui/Toggle';
import { ClientEyeIcon } from '../TaskCard';
import { MinutesClientDialog } from './MinutesClientDialog';

/** The key of a meeting's "Show to client" state (the final minutes refresh it when they change). */
export const minutesClientKey = (meetingId: string) => ['meeting', meetingId, 'client-visibility'];

const failure = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : 'Couldn’t change it. Please try again.');

/**
 * "Show to client" on a project meeting's approved final minutes: whoever runs the project may put
 * them on its client page, after a preview of exactly what the client will see (names highlighted,
 * owners off the next steps, risks only when ticked). Others only see that they are visible.
 * Reopened or re-filed minutes leave the client page (the server clears it).
 */
export function MinutesClientSwitch({ meetingId }: { meetingId: string }) {
  const qc = useQueryClient();
  const api = clientSharesApi(apiClient);
  const key = minutesClientKey(meetingId);
  const q = useQuery({ queryKey: key, queryFn: () => api.minutesVisibility(meetingId) });
  const [problem, setProblem] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const setM = useMutation({
    mutationFn: ({ visible, includeRisks }: { visible: boolean; includeRisks?: boolean }) => api.setMinutesVisible(meetingId, visible, includeRisks),
    onMutate: () => setProblem(null),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      setPreviewing(false);
    },
    onError: (err) => setProblem(failure(err)),
  });
  const s = q.data;
  if (!s || s.projectMeeting !== true) return null;
  if (!s.canChange) {
    return s.clientVisible ? (
      <p className="inline-flex items-center gap-1.5 self-start rounded-md bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">
        <ClientEyeIcon size={12} />
        Visible to client
      </p>
    ) : null;
  }
  const change = () => {
    if (s.clientVisible) setM.mutate({ visible: false });
    else {
      setProblem(null);
      setPreviewing(true);
    }
  };
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">Show to client</p>
        <Toggle on={s.clientVisible} onChange={change} label="Show to client" describedBy={`minutes-client-hint-${meetingId}`} disabled={setM.isPending || !s.approved} />
      </div>
      <p id={`minutes-client-hint-${meetingId}`} className="mt-1 text-xs leading-relaxed text-ink-2">
        {s.clientVisible
          ? `Shown on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). Risks and open issues are ${s.includeRisks ? 'included' : 'left out'}. Reopening the minutes or moving the meeting to another project takes them off.`
          : 'Puts these final minutes on the project’s client page, with a PDF of them alone (never the attendees, the notes or the action items). You see exactly what the client will see first.'}
      </p>
      {problem && !previewing ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{problem}</p> : null}
      {previewing ? (
        <MinutesClientDialog
          meetingId={meetingId}
          busy={setM.isPending}
          error={problem}
          onConfirm={(includeRisks) => setM.mutate({ visible: true, includeRisks })}
          onClose={() => setPreviewing(false)}
        />
      ) : null}
    </div>
  );
}
