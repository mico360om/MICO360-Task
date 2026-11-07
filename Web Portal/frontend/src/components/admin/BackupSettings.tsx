import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, assetOrigin } from '../../api/client';
import { backupsApi, type BackupCopy, type BackupOverview } from '../../api/backups';
import { ApiError } from '../../lib/api-client';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { LoadError } from '../ui/LoadError';
import { copyWhen, driveResultNote, scheduleText, sizeText } from './backup-words';

/** The section's address on the page: Google sends the administrator back to it. */
export const BACKUPS_ANCHOR = 'backups';
/** While a copy is being made, the section reads itself again this often. */
const POLL_MS = 3000;
const COARSE = '[@media(pointer:coarse)]:!min-h-11';
const FOLDER = '“MICO360 Tasks backups”';
const KIND_LABEL: Record<BackupCopy['kind'], string> = { nightly: 'Nightly', weekly: 'Weekly', manual: 'Back up now' };

type Note = { ok: boolean; text: string };

function isOverview(v: unknown): v is BackupOverview {
  const o = v as Partial<BackupOverview> | null | undefined;
  return Boolean(o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.copies) && o.nightly && o.drive);
}

/** The server's own words for a refusal (one already running, Drive not set up), else `fallback`. */
function problemText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.status < 500 && e.message ? e.message : fallback;
}

/** `?drive=…` from Google's way back: read once, then taken out of the address (the #backups stays). */
function takeDriveResult(): Note | null {
  const params = new URLSearchParams(window.location.search);
  const note = driveResultNote(params.get('drive'));
  if (params.has('drive')) {
    params.delete('drive');
    const search = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
  }
  return note;
}

const noteClass = (ok: boolean) => `rounded-lg px-3 py-2 text-sm ${ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`;

/**
 * System Settings → Backups (administrators): when copies are made and the last one, any warning,
 * "Back up now", the kept copies (each with Download), where they are and whether they are
 * encrypted, and the Google Drive connection.
 */
export function BackupSettings({ pollMs = POLL_MS, open = (url: string) => window.location.assign(url) }: { pollMs?: number; open?: (url: string) => void } = {}) {
  const qc = useQueryClient();
  // "Back up now" was pressed: the run's start (server time) and when its answer came (this browser).
  const [waiting, setWaiting] = useState<{ since: string; at: number } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [driveNote, setDriveNote] = useState<Note | null>(null);
  const [askDisconnect, setAskDisconnect] = useState(false);
  const scrolled = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const q = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsApi(apiClient).overview(),
    refetchInterval: (query) => (waiting || (isOverview(query.state.data) && query.state.data.running) ? pollMs : false),
  });
  const data = isOverview(q.data) ? q.data : null;

  useEffect(() => {
    const result = takeDriveResult();
    if (result) setDriveNote(result);
  }, []);

  // Coming back from Google (or a #backups link): bring the section into view, the keyboard on its heading.
  useEffect(() => {
    if (!data || scrolled.current || window.location.hash !== `#${BACKUPS_ANCHOR}`) return;
    scrolled.current = true;
    document.getElementById(BACKUPS_ANCHOR)?.scrollIntoView?.({ block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, [data]);

  // "Back up now" finished: say so (a failure shows as the warning). Only an overview read after the
  // start was answered counts — the one on screen before it doesn't know about the new copy yet.
  useEffect(() => {
    if (!waiting || !data || data.running || q.dataUpdatedAt <= waiting.at) return;
    setWaiting(null);
    if (data.lastSuccess && data.lastSuccess.at >= waiting.since) setNote({ ok: true, text: 'The copy is ready.' });
  }, [data, waiting, q.dataUpdatedAt]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] });
  const start = useMutation({
    mutationFn: () => backupsApi(apiClient).start(),
    onSuccess: (run) => {
      setNote(null);
      setWaiting({ since: run.startedAt, at: Date.now() });
      void refresh();
    },
    onError: (e) => setNote({ ok: false, text: problemText(e, 'Couldn’t start the backup. Please try again.') }),
  });
  const download = useMutation({
    mutationFn: (id: string) => backupsApi(apiClient).downloadLink(id),
    onSuccess: (url) => open(`${assetOrigin}${url}`),
    onError: (e) => setNote({ ok: false, text: problemText(e, 'Couldn’t download that copy. Please try again.') }),
  });
  const connect = useMutation({
    mutationFn: () => backupsApi(apiClient).connectDrive(),
    onSuccess: (url) => open(url),
    onError: (e) => setDriveNote({ ok: false, text: problemText(e, 'Couldn’t open Google’s page. Please try again.') }),
  });
  const disconnect = useMutation({
    mutationFn: () => backupsApi(apiClient).disconnectDrive(),
    onSuccess: async () => {
      setAskDisconnect(false);
      setDriveNote({ ok: true, text: 'Google Drive is disconnected. The copies already there stay.' });
      await refresh();
    },
  });

  const running = Boolean(data?.running) || start.isPending || Boolean(waiting);
  const tz = data?.nightly.timeZone ?? 'Asia/Muscat';

  return (
    <section id={BACKUPS_ANCHOR} className="card card-pad lg:col-span-2" aria-labelledby="backups-heading">
      <h2 ref={headingRef} tabIndex={-1} id="backups-heading" className="eyebrow mb-1 outline-none">Backups</h2>
      {q.isLoading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : !data ? (
        <LoadError what="the backups" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-2">{scheduleText(data.nightly)}</p>
          {data.warning ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{data.warning}</p> : null}
          {data.folderWarning ? <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{data.folderWarning}</p> : null}
          {data.keyWarning ? <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{data.keyWarning}</p> : null}
          {data.spaceWarning ? <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{data.spaceWarning}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">
                {data.lastSuccess
                  ? `Last backup: ${copyWhen(data.lastSuccess.at, tz)} · ${sizeText(data.lastSuccess.sizeBytes)}`
                  : data.nightly.enabled
                    ? 'No copies yet. The first one is made tonight, or press Back up now.'
                    : 'No copies yet. Press Back up now to make one.'}
              </div>
              <div role="status" className="text-xs text-ink-2">
                {running ? 'Making a copy… It takes a few minutes; you can leave this page.' : null}
              </div>
            </div>
            <Button size="sm" loading={running} onClick={() => start.mutate()} className={COARSE}>
              Back up now
            </Button>
          </div>
          {note ? <p role="status" className={`mb-3 ${noteClass(note.ok)}`}>{note.text}</p> : null}

          {data.copies.length ? (
            <ul aria-label="Kept copies" className="divide-y divide-line border-t border-line">
              {data.copies.map((c) => (
                <CopyRow key={c.id} copy={c} timeZone={tz} driveConnected={data.drive.connected} busy={download.isPending && download.variables === c.id} onDownload={() => download.mutate(c.id)} />
              ))}
            </ul>
          ) : null}
          {data.copies.length ? (
            <p className="mt-3 text-xs font-medium text-ink-2">
              {`${data.copies.length} ${data.copies.length === 1 ? 'copy' : 'copies'} kept on the server · ${sizeText(data.keptBytes ?? 0)} in all`}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-ink-3">
            Kept on the server in <span className="break-all font-mono">{data.folder}</span>, a private folder the website never shows.{' '}
            {data.encrypted ? 'Copies are encrypted with the backup key: keep that key safe somewhere off the server, because no copy opens without it.' : 'Copies are not encrypted.'}
          </p>

          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-1 text-sm font-semibold text-ink">Google Drive</h3>
            {driveNote ? <p role="status" className={`mb-3 ${noteClass(driveNote.ok)}`}>{driveNote.text}</p> : null}
            {!data.drive.configured ? (
              data.drive.stored ? (
                // A connection kept from before, on a server without the Google settings: it does nothing; let it go.
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm text-ink-2 sm:flex-1">
                    <p>Google Drive isn’t set up on this server yet.</p>
                    <p className="mt-1">A connection to {data.drive.email ?? 'a Google account'} is still kept from before; nothing is sent with it.</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setAskDisconnect(true)} className={COARSE}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ink-2">Google Drive isn’t set up on this server yet.</p>
              )
            ) : !data.drive.connected ? (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-sm text-ink-2 sm:flex-1">
                  Send each new copy to your own Google Drive too, into a folder called {FOLDER}. The app can only see the files it puts there.
                </p>
                <Button size="sm" variant="secondary" loading={connect.isPending} onClick={() => connect.mutate()} className={COARSE}>
                  Connect Google Drive
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Connected as {data.drive.email ?? 'your Google account'}</p>
                  <p className="text-xs text-ink-2">
                    {data.drive.connectedAt ? `Since ${copyWhen(data.drive.connectedAt, tz)}. ` : ''}Copies go into the {FOLDER} folder, and the same 7 + 4 are kept there.
                  </p>
                  {data.drive.problem ? <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{data.drive.problem}</p> : null}
                  {!data.drive.problem && data.drive.warning ? <p role="alert" className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{data.drive.warning}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.drive.problem ? (
                    <Button size="sm" variant="secondary" loading={connect.isPending} onClick={() => connect.mutate()} className={COARSE}>
                      Connect again
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setAskDisconnect(true)} className={COARSE}>
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {askDisconnect ? (
        <ConfirmDialog
          title="Disconnect Google Drive?"
          confirmLabel="Disconnect"
          keepLabel="Keep it connected"
          busy={disconnect.isPending}
          error={disconnect.isError ? 'Couldn’t disconnect Google Drive. Please try again.' : null}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setAskDisconnect(false)}
        >
          {data?.drive.configured === false
            ? 'The connection kept from before is removed. The copies already in Google Drive stay there.'
            : 'New copies stop going to Google Drive. The copies already there stay in your Drive.'}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function CopyRow({ copy, timeZone, driveConnected, busy, onDownload }: { copy: BackupCopy; timeZone: string; driveConnected: boolean; busy: boolean; onDownload: () => void }) {
  const when = copyWhen(copy.createdAt, timeZone);
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{when}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
          <Badge tone={copy.kind === 'nightly' ? 'info' : copy.kind === 'manual' ? 'brand' : 'neutral'}>{KIND_LABEL[copy.kind]}</Badge>
          <span>{sizeText(copy.sizeBytes)}</span>
          {copy.drive === 'UPLOADED' ? (
            <span className="flex items-center gap-1 font-medium text-success">
              <span aria-hidden="true">✓</span>
              <span>Sent to Google Drive</span>
            </span>
          ) : copy.drive === 'FAILED' ? (
            <span className="flex items-center gap-1 font-medium text-danger" title={copy.driveError ?? undefined}>
              <span aria-hidden="true">✗</span>
              <span>Not sent to Google Drive</span>
            </span>
          ) : driveConnected ? (
            <span className="text-ink-3">Not in Google Drive</span>
          ) : null}
        </div>
      </div>
      <Button size="sm" variant="secondary" loading={busy} onClick={onDownload} aria-label={`Download the copy of ${when}`} className={`flex-none ${COARSE}`}>
        Download
      </Button>
    </li>
  );
}
