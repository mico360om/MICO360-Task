import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MICROSOFT_TEAMS_ANCHOR } from '../../lib/useMicrosoftTeams';
import { apiClient } from '../../api/client';
import { microsoftApi, type TeamsNotice } from '../../api/microsoft';
import { Button } from '../ui/Button';

/**
 * 1.23: the meeting is saved, but its Teams link wasn't made — the plain notice in place of the form (so
 * the meeting is never made twice), with Make Teams link when trying again can help (Microsoft was
 * unreachable or refused) and the way to Settings when the Microsoft account isn't connected.
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
  const canRetry = notice.code === 'TEAMS_FAILED' || notice.code === 'TEAMS_NOT_CONNECTED';
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="font-display text-xl font-bold text-ink">Meeting saved</h2>
      {made ? (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">The Teams link is made — it’s in the meeting’s Online link.</p>
      ) : (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {message}
          {notice.code === 'TEAMS_NOT_CONNECTED' ? (
            <>
              {' '}
              <Link to={`/settings#${MICROSOFT_TEAMS_ANCHOR}`} className="tap font-semibold underline">Open Settings</Link>
            </>
          ) : null}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} className="!min-h-[44px]">Done</Button>
        {!made && canRetry ? (
          <Button onClick={() => make.mutate()} loading={make.isPending} className="!min-h-[44px]">
            Make Teams link
          </Button>
        ) : null}
      </div>
    </div>
  );
}
