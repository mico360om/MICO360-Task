import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { clientSharesApi } from '../../api/client-shares';
import { ApiError } from '../../lib/api-client';
import { Toggle } from '../ui/Toggle';
import { ClientEyeIcon } from '../TaskCard';

/** The key of a meeting's "Show to client" state (the final minutes refresh it when they change). */
export const minutesClientKey = (meetingId: string) => ['meeting', meetingId, 'client-visibility'];

/**
 * "Show to client" on a project meeting's approved final minutes: whoever runs the project may put
 * them on its client page (they are shown as written, so the hint says to check them first). Others
 * only see that they are visible. Reopened minutes leave the client page (the server clears it).
 */
export function MinutesClientSwitch({ meetingId }: { meetingId: string }) {
  const qc = useQueryClient();
  const api = clientSharesApi(apiClient);
  const key = minutesClientKey(meetingId);
  const q = useQuery({ queryKey: key, queryFn: () => api.minutesVisibility(meetingId) });
  const [problem, setProblem] = useState<string | null>(null);
  const setM = useMutation({
    mutationFn: (visible: boolean) => api.setMinutesVisible(meetingId, visible),
    onMutate: () => setProblem(null),
    onSuccess: (next) => qc.setQueryData(key, next),
    onError: (err) => setProblem(err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : 'Couldn’t change it. Please try again.'),
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
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">Show to client</p>
        <Toggle on={s.clientVisible} onChange={() => setM.mutate(!s.clientVisible)} label="Show to client" describedBy={`minutes-client-hint-${meetingId}`} disabled={setM.isPending || !s.approved} />
      </div>
      <p id={`minutes-client-hint-${meetingId}`} className="mt-1 text-xs leading-relaxed text-ink-2">
        The project’s client page then shows these final minutes as written, with a PDF of them alone (never the attendees, the notes or the action items).
        Check them for names or internal notes first. Reopening the minutes takes them off the client page.
      </p>
      {problem ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{problem}</p> : null}
    </div>
  );
}
