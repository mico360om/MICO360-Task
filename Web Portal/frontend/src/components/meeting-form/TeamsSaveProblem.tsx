import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { microsoftApi, type TeamsNotice } from '../../api/microsoft';
import { Button } from '../ui/Button';

/**
 * 1.23: the meeting is saved, but its Teams link couldn't be made (Microsoft unreachable or refusing)
 * — the plain notice and Make Teams link, in place of the form (so the meeting is never made twice).
 */
export function TeamsSaveProblem({ meetingId, notice, onDone }: { meetingId: string; notice: TeamsNotice; onDone: () => void }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState(notice.message);
  const make = useMutation({
    mutationFn: () => microsoftApi(apiClient).makeTeamsLink(meetingId),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['meeting', meetingId] });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      if (!r.made) setMessage(r.teamsNotice?.message ?? notice.message);
    },
    onError: () => setMessage(notice.message),
  });
  const made = make.data?.made === true;
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="font-display text-xl font-bold text-ink">Meeting saved</h2>
      {made ? (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">The Teams link is made — it’s in the meeting’s Online link.</p>
      ) : (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{message}</p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} className="!min-h-[44px]">Done</Button>
        {!made ? (
          <Button onClick={() => make.mutate()} loading={make.isPending} className="!min-h-[44px]">
            Make Teams link
          </Button>
        ) : null}
      </div>
    </div>
  );
}
