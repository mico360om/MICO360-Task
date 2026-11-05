import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { Meeting } from '../../api/meetings';
import { microsoftApi } from '../../api/microsoft';
import { useMicrosoftTeams } from '../../lib/useMicrosoftTeams';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/Button';

export const TEAMS_FAILED_TEXT = 'The Teams link couldn’t be made — try again.';

/**
 * 1.23: on a meeting waiting for its Teams link (Microsoft couldn't be reached when it was saved), its
 * organizer sees the plain notice and Make Teams link — made with their own Microsoft account.
 */
export function TeamsLinkNotice({ meeting, onMade }: { meeting: Meeting; onMade: () => void }) {
  const me = useAuthStore((s) => s.user?.id ?? null);
  const { available } = useMicrosoftTeams();
  const [message, setMessage] = useState(TEAMS_FAILED_TEXT);
  const make = useMutation({
    mutationFn: () => microsoftApi(apiClient).makeTeamsLink(meeting.id),
    onSuccess: (r) => {
      if (r.made) onMade();
      else setMessage(r.teamsNotice?.message ?? TEAMS_FAILED_TEXT);
    },
    onError: () => setMessage(TEAMS_FAILED_TEXT),
  });
  const waiting = meeting.teamsLinkPending === true && meeting.status !== 'CANCELLED' && meeting.canEdit !== false;
  if (!available || !waiting || meeting.organizerId !== me || make.data?.made) return null;
  return (
    <div role="status" className="mb-4 flex flex-col gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      <Button size="sm" variant="secondary" onClick={() => make.mutate()} loading={make.isPending} className="shrink-0 [@media(pointer:coarse)]:!min-h-11">
        Make Teams link
      </Button>
    </div>
  );
}
