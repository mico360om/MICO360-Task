import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { clientSharesApi, type ClientShare } from '../../api/client-shares';
import { ApiError } from '../../lib/api-client';
import { relativeTime } from '../../lib/relative-time';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FieldLabel, fieldClass } from '../ui/Field';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const reason = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : fallback;

/**
 * Share with client: the project's owner, managers and admins give a client (by name and email) a
 * private, read-only page of this project. The email carries a link that opens only with a code sent
 * to that address. Each client shows when they last viewed it; Resend replaces their link, Remove
 * ends their access at once. The server checks who may do this; this panel is only offered to them.
 */
export function ClientSharePanel({
  projectId,
  projectName,
  emailEnabled = true,
  archived = false,
  onClose,
}: {
  projectId: string;
  projectName: string;
  emailEnabled?: boolean;
  /** An archived project's client page is closed: the panel is read-only, with Remove still offered. */
  archived?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const api = clientSharesApi(apiClient);
  const ids = { title: useId(), intro: useId(), name: useId(), email: useId() };
  const key = ['client-shares', projectId];
  const sharesQ = useQuery({ queryKey: key, queryFn: () => api.list(projectId) });
  const shares = Array.isArray(sharesQ.data) ? sharesQ.data : [];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ClientShare | null>(null);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const busyAny = () => addM.isPending || resendM.isPending || removeM.isPending;
  const dialogRef = useDialog(() => {
    if (!busyAny() && !removing) onClose();
  });

  const addM = useMutation({
    mutationFn: (input: { name: string; email: string }) => api.add(projectId, input),
    onMutate: () => {
      setProblem(null);
      setNotice(null);
    },
    onSuccess: (share) => {
      setName('');
      setEmail('');
      setNotice(`Invitation sent to ${share.email}.`);
      void refresh();
    },
    onError: (err) => setProblem(reason(err, 'Couldn’t share the project. Please try again.')),
  });
  const resendM = useMutation({
    mutationFn: (share: ClientShare) => api.resend(projectId, share.id),
    onMutate: () => {
      setProblem(null);
      setNotice(null);
    },
    onSuccess: () => {
      setNotice('A new link was sent. The old link and any signed-in devices no longer work.');
      void refresh();
    },
    onError: (err) => setProblem(reason(err, 'Couldn’t send a new link. Please try again.')),
  });
  const removeM = useMutation({
    mutationFn: (share: ClientShare) => api.remove(projectId, share.id),
    onMutate: () => setRemoveProblem(null),
    onSuccess: (_r, share) => {
      setRemoving(null);
      setNotice(`${share.name} can no longer view this project.`);
      void refresh();
    },
    onError: (err) => setRemoveProblem(reason(err, 'Couldn’t remove their access. Please try again.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setProblem('Enter the client’s name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setProblem('Enter a valid email address.');
    addM.mutate({ name: name.trim(), email: email.trim() });
  };

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busyAny() || removing ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          aria-describedby={ids.intro}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">Share with client</h2>
              <p dir="auto" className="truncate text-sm text-ink-2">{projectName}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <p id={ids.intro} className="text-sm leading-relaxed text-ink-2">
              A client follows this project on a private, read-only page: its progress and timeline, and only the milestones, tasks and approved minutes marked
              “Show to client”. They never see people, comments, files or internal notes. Their link opens only with a code we email to them.
            </p>

            {archived ? (
              <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
                This project is archived, so its client page is closed and it can’t be shared. You can still remove clients; if the project is reopened,
                the clients still listed here can view it again.
              </p>
            ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-xl border border-line p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={ids.name}>Client’s name</FieldLabel>
                  <input id={ids.name} dir="auto" autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={fieldClass(false, 'w-full')} />
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={ids.email}>Email address</FieldLabel>
                  <input id={ids.email} type="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass(false, 'w-full')} />
                </div>
              </div>
              {!emailEnabled ? (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  Email isn’t set up on this server, so a client could never get their code. Ask an administrator to set up email first.
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={addM.isPending} disabled={!emailEnabled}>Share</Button>
              </div>
            </form>
            )}

            {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
            {notice ? <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{notice}</p> : null}

            <div>
              <h3 className="eyebrow mb-2">Clients</h3>
              {sharesQ.isLoading ? (
                <p className="text-sm text-ink-2">Loading…</p>
              ) : sharesQ.isError ? (
                <p role="alert" className="text-sm text-danger">
                  Couldn’t load the clients. <button type="button" className="font-semibold underline" onClick={() => void sharesQ.refetch()}>Retry</button>
                </p>
              ) : shares.length === 0 ? (
                <p className="text-sm text-ink-2">Not shared with anyone yet.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {shares.map((s) => (
                    <ShareRow
                      key={s.id}
                      share={s}
                      busy={busyAny()}
                      canResend={emailEnabled}
                      showResend={!archived}
                      resending={resendM.isPending && resendM.variables?.id === s.id}
                      onResend={() => resendM.mutate(s)}
                      onRemove={() => {
                        setRemoveProblem(null);
                        setRemoving(s);
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      {removing ? (
        <ConfirmDialog
          title={`Remove ${removing.name}’s access?`}
          confirmLabel="Remove access"
          keepLabel="Keep access"
          busy={removeM.isPending}
          error={removeProblem}
          onConfirm={() => removeM.mutate(removing)}
          onClose={() => setRemoving(null)}
        >
          Their link stops working, and any device signed in to the page is signed out at once. You can share with them again later.
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}

function ShareRow({
  share: s,
  busy,
  canResend,
  showResend,
  resending,
  onResend,
  onRemove,
}: {
  share: ClientShare;
  busy: boolean;
  canResend: boolean;
  showResend: boolean;
  resending: boolean;
  onResend: () => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  return (
    <li aria-labelledby={nameId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={nameId} dir="auto" className="truncate text-sm font-semibold text-ink">{s.name}</p>
        <p className="truncate text-xs text-ink-2">{s.email}</p>
        <p className="text-xs text-ink-2">
          <span>{s.lastViewedAt ? `Last viewed ${relativeTime(s.lastViewedAt)}` : 'Not viewed yet'}</span>
          {s.linkSentAt ? <span> · Link sent {day(s.linkSentAt)}</span> : null}
        </p>
      </div>
      <div className="flex flex-none gap-2">
        {showResend ? (
          <Button type="button" size="sm" variant="secondary" loading={resending} disabled={busy || !canResend} onClick={onResend} aria-label={`Resend the link to ${s.name}`}>
            Resend
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRemove} aria-label={`Remove ${s.name}`} className="text-danger hover:bg-danger-soft hover:text-danger">
          Remove
        </Button>
      </div>
    </li>
  );
}
