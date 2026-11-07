import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { CLIENTS_KEY, clientAsUser, clientsApi, type ClientAccount } from '../api/clients';
import { usersApi, type ApiUser, type CreatedUser, type UserStatus } from '../api/users';
import { CreateUserModal } from '../components/CreateUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { projectCount } from '../components/clients/client-access';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { PageHeader } from '../components/ui/PageHeader';
import { ApiError } from '../lib/api-client';
import { instantDayText } from '../lib/day-words';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useMediaQuery } from '../lib/useMediaQuery';
import { inviteConfirmTitle, invitationLabel, invitationSentText, RESET_LINK_NOTE, welcomeBlockedReason } from '../lib/user-sign-in';
import { OnboardingStatusCell } from '../components/onboarding/OnboardingCells';
import { AccountStatusDialog } from '../components/onboarding/AccountStatusDialog';
import { EMAIL_OFF_BANNER, invitedText, matchesStatusFilter, NO_ONE_WITH_STATUS, ONBOARDING_FILTERS, type StatusFilter } from '../lib/onboarding';
import { useAuthStore } from '../stores/auth-store';

/** Below 768px (the md width, in em as the layout's widths are): one card per client instead of the table. */
const PHONE_QUERY = '(max-width: 47.9375em)';
/** A finger-sized target on a touch screen ('!': over the base rule's 32px for every button). */
const TOUCH = '[@media(pointer:coarse)]:!min-h-11';
const ACTION = `inline-flex items-center whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${TOUCH}`;
const PLAIN = `${ACTION} border-line text-ink-2 hover:border-brand/30 hover:bg-ground hover:text-ink`;
/** How many of a client's projects are named in the list before "+2 more". */
const NAMED = 3;
const NOT_SET_UP_ID = 'clients-email-not-set-up';

const nameOf = (c: Pick<ClientAccount, 'firstName' | 'lastName' | 'username'>) => `${c.firstName} ${c.lastName}`.trim() || c.username;

/** The server's own words for a refused change, else `fallback`. */
function problemText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

/** What the page says once a new client account is made (as User Management says it). */
function createdNotice({ user, welcome }: CreatedUser): Notice {
  const whose = user.username ? `${user.username}’s account is ready` : 'The account is ready';
  // 1.23.6: a temporary password (shown once in the form): they choose their own at the first sign-in.
  if (user.mustChangePassword) return { text: `${whose}. They choose their own password at their first sign-in.` };
  if (!welcome) return { text: `${whose}.` };
  if (welcome.sent) return { text: `${whose}. Welcome email sent to ${welcome.email ?? user.email}.` };
  return { text: `${whose}, but the welcome email wasn’t sent: ${welcome.why ?? 'it couldn’t be sent'}.`, error: true };
}

interface Notice {
  text: string;
  error?: boolean;
}

/**
 * Clients (Admin, 1.23), administrators only: the client accounts — people outside the company who
 * sign in to the Client portal — with their organisation, projects and last sign-in. "New client"
 * makes one (the same form as User Management's Role "Client"); a client opens in Manage account
 * (the same project access editor). Send the welcome email again, deactivate or reactivate, delete.
 */
export function ClientsPage() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const q = useQuery({ queryKey: CLIENTS_KEY, queryFn: () => clientsApi(apiClient).list() });
  const clients = Array.isArray(q.data) ? q.data : [];
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClientAccount | null>(null);
  // A staff account opened from a duplicate warning (Manage account works for both kinds).
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [welcoming, setWelcoming] = useState<ClientAccount | null>(null);
  const [deleting, setDeleting] = useState<ClientAccount | null>(null);
  // Onboarding: "Send password reset" and a status change, each asked first; the status filter.
  const [resetting, setResetting] = useState<ClientAccount | null>(null);
  const [statusChange, setStatusChange] = useState<{ c: ClientAccount; to: UserStatus } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const shown = clients.filter((c) => matchesStatusFilter(c, statusFilter));
  const [notice, setNotice] = useState<Notice | null>(null);
  const timeZone = useCompanyTimeZone();
  const phone = useMediaQuery(PHONE_QUERY);
  useShortcut('new', () => setCreating(true));
  // Welcome emails need email set up on the server (until /config answers, they're offered).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: CLIENTS_KEY });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };

  const welcomeMut = useMutation({
    mutationFn: (c: ClientAccount) => usersApi(apiClient).sendWelcome(c.id),
    onSuccess: (out, c) => {
      setWelcoming(null);
      setNotice({ text: invitationSentText({ ...c, username: nameOf(c) }, out.email ?? c.email) });
      refresh();
    },
  });
  const resetMut = useMutation({
    mutationFn: (c: ClientAccount) => usersApi(apiClient).sendPasswordReset(c.id),
    onSuccess: (out, c) => {
      setResetting(null);
      setNotice({ text: `Password reset link sent to ${nameOf(c)} (${out.email ?? c.email}).` });
    },
  });
  const statusMut = useMutation({
    mutationFn: ({ c, status, why }: { c: ClientAccount; status: UserStatus; why?: string }) => usersApi(apiClient).setStatus(c.id, status, why),
    onMutate: () => setNotice(null),
    onSuccess: (_r, { c, status }) => {
      setStatusChange(null);
      setNotice({ text: status === 'ACTIVE' ? `${nameOf(c)} can sign in again.` : `${nameOf(c)} can’t sign in now.` });
      refresh();
    },
  });
  const unlockMut = useMutation({
    mutationFn: (c: ClientAccount) => usersApi(apiClient).unlock(c.id),
    onMutate: () => setNotice(null),
    onSuccess: (_r, c) => {
      setNotice({ text: `${nameOf(c)} can sign in again.` });
      refresh();
    },
    onError: (err, c) => setNotice({ text: problemText(err, `Couldn’t unlock ${nameOf(c)}.`), error: true }),
  });
  const deleteMut = useMutation({
    mutationFn: (c: ClientAccount) => usersApi(apiClient).remove(c.id),
    onSuccess: (_r, c) => {
      setDeleting(null);
      setNotice({ text: `${nameOf(c)}’s client account was deleted.` });
      refresh();
    },
  });

  // Onboarding: "Open account" from a duplicate warning — that person's Manage account (staff or client).
  const openAccount = (id: string) => {
    setCreating(false);
    const listed = clients.find((c) => c.id === id);
    if (listed) {
      setEditing(listed);
      return;
    }
    void usersApi(apiClient).get(id).then((u) => setEditingUser(u), () => setNotice({ text: 'Couldn’t open that account. Try again.', error: true }));
  };

  const nameButton = (c: ClientAccount) => (
    <button type="button" onClick={() => setEditing(c)} aria-label={`Open ${nameOf(c)}`} className={`flex min-w-0 flex-col items-start rounded text-left ${TOUCH}`}>
      <bdi className="font-medium text-ink [overflow-wrap:anywhere] hover:text-brand hover:underline">{nameOf(c)}</bdi>
      <span className="text-xs font-normal text-ink-3">@{c.username}</span>
    </button>
  );
  const organisation = (c: ClientAccount) => (c.organisation ? <bdi className="[overflow-wrap:anywhere]">{c.organisation}</bdi> : <span className="text-ink-3">—</span>);
  const projects = (c: ClientAccount) => {
    if (c.projects.length === 0) return <span className="text-ink-3">None yet</span>;
    const rest = c.projects.length - NAMED;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">{projectCount(c.projects.length)}</span>
        <ul aria-label="Projects" className="flex flex-wrap gap-1">
          {c.projects.slice(0, NAMED).map((p) => (
            <li key={p.projectId} className="rounded-md bg-ground px-1.5 py-0.5 text-xs text-ink-2" title={p.archived ? 'Archived: hidden in the Client portal' : undefined}>
              <bdi>{p.name}</bdi>
              {p.archived ? <span> (archived)</span> : null}
            </li>
          ))}
        </ul>
        {rest > 0 ? <span className="text-xs text-ink-3">+{rest} more</span> : null}
      </div>
    );
  };
  const lastSignIn = (c: ClientAccount) => {
    const invited = invitedText(c, timeZone);
    return (
      <>
        {c.lastLoginAt ? <span className="text-ink">{instantDayText(c.lastLoginAt, timeZone)}</span> : <span className="italic text-ink-2">Never</span>}
        {invited ? <span className="block text-xs text-ink-2">{invited}</span> : null}
      </>
    );
  };
  // Onboarding: Invited · 3 days ago / Invite expired / Active / Locked / Deactivated, and email verified or not.
  const status = (c: ClientAccount) => <OnboardingStatusCell person={c} />;
  const actions = (c: ClientAccount) => {
    const blocked = welcomeBlockedReason(c, meId);
    const busy = statusMut.isPending && statusMut.variables?.c.id === c.id;
    return (
      <>
        <button
          type="button"
          onClick={() => { welcomeMut.reset(); setWelcoming(c); }}
          disabled={!emailEnabled || !!blocked}
          aria-label={`${invitationLabel(c)} to ${c.username}`}
          aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
          title={blocked ?? undefined}
          className={PLAIN}
        >
          {invitationLabel(c)}
        </button>
        <button
          type="button"
          onClick={() => { resetMut.reset(); setResetting(c); }}
          disabled={!emailEnabled || c.status !== 'ACTIVE'}
          aria-label={`Send password reset to ${c.username}`}
          aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
          title={c.status !== 'ACTIVE' ? 'Reactivate the account first' : 'Email them a link to choose a new password (works for an hour)'}
          className={PLAIN}
        >
          Send password reset
        </button>
        {c.locked ? (
          <button type="button" onClick={() => unlockMut.mutate(c)} disabled={unlockMut.isPending} aria-label={`Unlock ${c.username}`} className={`${ACTION} border-warning/40 font-semibold text-warning hover:bg-warning-soft`}>
            Unlock
          </button>
        ) : null}
        {c.status === 'ACTIVE' ? (
          <button type="button" onClick={() => { statusMut.reset(); setStatusChange({ c, to: 'INACTIVE' }); }} disabled={busy} aria-label={`Deactivate ${c.username}`} className={PLAIN}>
            Deactivate
          </button>
        ) : (
          <button type="button" onClick={() => { statusMut.reset(); setStatusChange({ c, to: 'ACTIVE' }); }} disabled={busy} aria-label={`Reactivate ${c.username}`} className={PLAIN}>
            Reactivate
          </button>
        )}
        <button type="button" onClick={() => { deleteMut.reset(); setDeleting(c); }} aria-label={`Delete ${c.username}`} className={`${ACTION} border-line text-danger hover:bg-danger-soft`}>
          Delete
        </button>
      </>
    );
  };

  const newButton = (
    <Button onClick={() => setCreating(true)} title="New client" shortcut="new">
      + New client
    </Button>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Clients"
        subtitle="People outside the company who follow their projects in the Client portal, and what each may see and do."
        actions={newButton}
      />

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <p className="min-w-0 [overflow-wrap:anywhere]">{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {!emailEnabled ? (
        <p id={NOT_SET_UP_ID} className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {EMAIL_OFF_BANNER}
        </p>
      ) : null}

      {clients.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="clients-status" className="text-xs font-medium text-ink-2">Status</label>
            <select id="clients-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:!min-h-11">
              {ONBOARDING_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {q.isLoading ? (
        <p className="card p-4 text-ink-2" role="status">Loading…</p>
      ) : q.isError ? (
        <div className="card p-4">
          <LoadError what="the clients" onRetry={() => void q.refetch()} />
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          titleAs="h2"
          title="No clients yet"
          description="A client account lets someone outside the company sign in and follow the projects you give them in the Client portal."
          action={newButton}
          icon={
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="9" cy="11" r="2.2" />
              <path d="M5.8 16.5a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3" />
            </svg>
          }
        />
      ) : statusFilter && shown.length === 0 ? (
        <p className="card p-4 text-ink-2">{NO_ONE_WITH_STATUS[statusFilter]}</p>
      ) : phone ? (
        <ul aria-label="Clients" className="flex flex-col gap-2">
          {shown.map((c) => (
            <li key={c.id} className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">{nameButton(c)}</div>
                <div className="flex-none">{status(c)}</div>
              </div>
              <p className="mt-0.5 truncate text-sm text-ink-2" title={c.email}>{c.email}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-ink-3">Organisation</dt>
                  <dd className="text-ink-2">{organisation(c)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-ink-3">Last sign-in</dt>
                  <dd className="text-ink-2">{lastSignIn(c)}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs text-ink-3">Projects</dt>
                  <dd className="mt-0.5">{projects(c)}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">{actions(c)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label="Clients">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="min-w-[10rem] p-3">Client</th>
                <th className="p-3">Organisation</th>
                <th className="p-3">Email</th>
                <th className="min-w-[10rem] p-3">Projects</th>
                <th className="whitespace-nowrap p-3">Last sign-in</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-b border-line align-top last:border-0">
                  <td className="p-3">{nameButton(c)}</td>
                  <td className="p-3 text-ink-2">{organisation(c)}</td>
                  <td className="p-3 text-ink-2">{c.email}</td>
                  <td className="p-3">{projects(c)}</td>
                  <td className="whitespace-nowrap p-3 text-ink-2">{lastSignIn(c)}</td>
                  <td className="p-3">{status(c)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">{actions(c)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {welcoming ? (
        <ConfirmDialog
          title={inviteConfirmTitle(welcoming, nameOf(welcoming))}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={welcomeMut.isPending}
          error={welcomeMut.isError ? problemText(welcomeMut.error, 'Couldn’t send the invitation. Try again.') : null}
          onConfirm={() => welcomeMut.mutate(welcoming)}
          onClose={() => setWelcoming(null)}
        >
          They get their username and a link to set their password (it works for 7 days; an earlier invitation stops working). Using the link signs them out on their other devices.
        </ConfirmDialog>
      ) : null}
      {resetting ? (
        <ConfirmDialog
          title={`Send a password reset link to ${nameOf(resetting)} (${resetting.email})?`}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={resetMut.isPending}
          error={resetMut.isError ? problemText(resetMut.error, 'Couldn’t send the reset link. Try again.') : null}
          onConfirm={() => resetMut.mutate(resetting)}
          onClose={() => setResetting(null)}
        >
          {RESET_LINK_NOTE}
        </ConfirmDialog>
      ) : null}
      {statusChange ? (
        <AccountStatusDialog
          name={nameOf(statusChange.c)}
          to={statusChange.to}
          neverSignedIn={!statusChange.c.lastLoginAt && !statusChange.c.activatedAt}
          busy={statusMut.isPending}
          error={statusMut.isError ? problemText(statusMut.error, `Couldn’t change ${nameOf(statusChange.c)}’s account. Please try again.`) : null}
          onConfirm={(why) => statusMut.mutate({ c: statusChange.c, status: statusChange.to, why })}
          onClose={() => setStatusChange(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${nameOf(deleting)}’s client account?`}
          confirmLabel="Delete client"
          keepLabel="Cancel"
          busy={deleteMut.isPending}
          error={deleteMut.isError ? problemText(deleteMut.error, 'Couldn’t delete. Try again.') : null}
          onConfirm={() => deleteMut.mutate(deleting)}
          onClose={() => setDeleting(null)}
        >
          They can’t sign in to the Client portal any more. This can’t be undone.
        </ConfirmDialog>
      ) : null}
      {creating ? <CreateUserModal clientOnly onClose={() => setCreating(false)} onCreated={(result) => setNotice(createdNotice(result))} onOpenAccount={openAccount} /> : null}
      {editing ? <EditUserModal user={clientAsUser(editing)} onClose={() => setEditing(null)} /> : null}
      {editingUser ? <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} /> : null}
    </div>
  );
}
