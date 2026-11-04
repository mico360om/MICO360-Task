import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { microsoftApi } from '../../api/microsoft';
import { ApiError } from '../../lib/api-client';
import { formatMeetingDay } from '../../lib/meetingFormat';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { MICROSOFT_STATUS_KEY, MICROSOFT_TEAMS_ANCHOR, useMicrosoftTeams } from '../../lib/useMicrosoftTeams';
import { useScrollToHash } from '../../lib/useScrollToHash';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { LoadError } from '../ui/LoadError';

type Note = { ok: boolean; text: string };

const RESULT_NOTES: Record<string, Note> = {
  connected: { ok: true, text: 'Microsoft Teams is connected. Tick “Create a Teams link” when you schedule a meeting.' },
  denied: { ok: false, text: 'You cancelled on Microsoft’s page — nothing was connected.' },
  failed: { ok: false, text: 'Microsoft Teams couldn’t be connected. Please try again.' },
};

/** `?teams=…` from Microsoft's way back: read once, then taken out of the address (the #microsoft-teams stays). */
function takeResult(): Note | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('teams');
  if (result === null) return null;
  params.delete('teams');
  const search = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
  return RESULT_NOTES[result] ?? RESULT_NOTES.failed!;
}

const noteClass = (ok: boolean) => `mb-3 rounded-lg px-3 py-2 text-sm ${ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`;

/**
 * Settings → Microsoft Teams (1.23): connect your own Microsoft account once, so meetings you organize
 * can get a Teams link by themselves. Hidden on a site without Teams links set up.
 */
export function MicrosoftTeamsSettings({ open = (url: string) => window.location.assign(url) }: { open?: (url: string) => void } = {}) {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const { available, status, loading, failed, refetch } = useMicrosoftTeams();
  const [note, setNote] = useState<Note | null>(null);
  const [askDisconnect, setAskDisconnect] = useState(false);
  const took = useRef(false);
  useScrollToHash(MICROSOFT_TEAMS_ANCHOR, available && !loading);

  useEffect(() => {
    if (took.current) return;
    took.current = true;
    const result = takeResult();
    if (result) setNote(result);
  }, []);

  const connect = useMutation({
    mutationFn: () => microsoftApi(apiClient).connect(),
    // Microsoft's own sign-in page (the answer remembered this browser for the way back).
    onSuccess: (url) => open(url),
    onError: (e) => setNote({ ok: false, text: e instanceof ApiError && e.status < 500 && e.message ? e.message : 'Couldn’t open Microsoft’s page. Please try again.' }),
  });
  const disconnect = useMutation({
    mutationFn: () => microsoftApi(apiClient).disconnect(),
    onSuccess: async () => {
      setAskDisconnect(false);
      setNote({ ok: true, text: 'Microsoft Teams is disconnected. Teams links already made keep working.' });
      await qc.invalidateQueries({ queryKey: MICROSOFT_STATUS_KEY });
    },
  });

  if (!available) return null;
  return (
    <section id={MICROSOFT_TEAMS_ANCHOR} className="card scroll-mt-20 p-5 lg:col-span-2" aria-labelledby="microsoft-teams-heading">
      <h2 id="microsoft-teams-heading" className="eyebrow mb-1">Microsoft Teams</h2>
      <p className="mb-4 text-sm text-ink-2">Meetings you organize can get a Teams link by themselves, made with your own Microsoft account.</p>
      {note ? <p role="status" className={noteClass(note.ok)}>{note.text}</p> : null}
      {loading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : failed || !status ? (
        <LoadError what="your Microsoft Teams connection" onRetry={refetch} />
      ) : status.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="break-words text-sm font-medium text-ink">Connected as {status.email ?? status.name ?? 'your Microsoft account'}</div>
            {status.connectedAt ? <div className="text-xs text-ink-2">Since {formatMeetingDay(status.connectedAt, timeZone)}</div> : null}
          </div>
          <Button variant="secondary" onClick={() => setAskDisconnect(true)} className="[@media(pointer:coarse)]:!min-h-11">
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {status.problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{status.problem}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-ink-2">
              {status.problem ? `Connected before as ${status.email ?? 'your Microsoft account'}.` : 'You’ll sign in on Microsoft’s own page and allow MICO360 Tasks to make Teams meetings for you.'}
            </div>
            <Button onClick={() => connect.mutate()} loading={connect.isPending} className="[@media(pointer:coarse)]:!min-h-11">
              {status.problem ? 'Connect again' : 'Connect Microsoft account'}
            </Button>
          </div>
        </div>
      )}
      {askDisconnect ? (
        <ConfirmDialog
          title="Disconnect Microsoft Teams?"
          confirmLabel="Disconnect Microsoft"
          keepLabel="Keep it"
          busy={disconnect.isPending}
          error={disconnect.isError ? 'Couldn’t disconnect. Please try again.' : undefined}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setAskDisconnect(false)}
        >
          New meetings won’t get a Teams link until you connect again. Teams links already made keep working.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
