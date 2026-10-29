import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateUserModal } from '../components/CreateUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { usersApi, type ApiUser, type CreatedUser, type UserStatus } from '../api/users';
import { ApiError } from '../lib/api-client';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import {
  MAX_WELCOME_BATCH,
  SIGN_OUT_NOTE,
  leftOutText,
  namesText,
  signInText,
  sortBySignIn,
  welcomeBatchSummary,
  welcomeBlockedReason,
  welcomeCandidates,
  welcomeConfirmTitle,
  welcomeOneConfirmTitle,
  welcomeSentText,
  type SignInSort,
} from '../lib/user-sign-in';
import { useAuthStore } from '../stores/auth-store';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';

const STATUS_TONE: Record<UserStatus, string> = {
  ACTIVE: 'bg-success-soft text-success',
  INACTIVE: 'bg-ground text-ink-2',
  SUSPENDED: 'bg-danger-soft text-danger',
};

/** The server's reason for a rejected change (e.g. "the last administrator can't be removed"), else our fallback. */
function reason(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

/** The server's words for a welcome email it didn't send (refused, too soon, email not set up, not delivered). */
const WELCOME_CODES = new Set(['NOT_FOUND', 'ACCOUNT_INACTIVE', 'ACCOUNT_SUSPENDED', 'ACCOUNT_LOCKED', 'NO_EMAIL', 'EMAIL_BLOCKED', 'TOO_SOON', 'DELIVERY_FAILED', 'SERVER_ERROR', 'EMAIL_NOT_CONFIGURED']);
function welcomeFailure(err: unknown): string {
  if (err instanceof ApiError && WELCOME_CODES.has(err.code ?? '') && err.message) return err.message;
  return reason(err, 'Couldn’t send the welcome email. Try again.');
}

/** What the page says once a new account is made: whether its welcome email went, and why not. */
function createdNotice({ user, welcome }: CreatedUser): Notice {
  const whose = user.username ? `${user.username}’s account is ready` : 'The account is ready';
  if (!welcome) return { text: `${whose}.` };
  if (welcome.sent) return { text: `${whose}. Welcome email sent to ${welcome.email ?? user.email}.` };
  return { text: `${whose}, but the welcome email wasn’t sent: ${welcome.why ?? 'it couldn’t be sent'}.`, error: true };
}

interface Notice {
  text: string;
  /** The people a bulk send didn't reach, each with why (keyed by person and place: two may read alike). */
  items?: { key: string; text: string }[];
  error?: boolean;
}

const NOT_SET_UP_ID = 'users-email-not-set-up';
const fullName = (u: ApiUser) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;

/** A padlock, drawn (an emoji looks different on every system). */
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="-mt-px">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

/** An envelope: the row's "Send welcome email" on a phone, where the words would widen the row. */
const EnvelopeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sm:hidden">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </svg>
);

/** A tick box's finger-sized target on a touch screen: its label, 44px, in the cell's padding (the box stays 16px). */
const TICK_TARGET = 'grid cursor-pointer place-items-center [@media(pointer:coarse)]:-m-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

export function UsersPage() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  useShortcut('new', () => setCreating(true));
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list() });
  const users = Array.isArray(q.data) ? q.data : [];
  const lockedCount = users.filter((u) => u.locked).length;
  const timeZone = useCompanyTimeZone();
  // Welcome emails need email set up on the server (until /config answers, they're offered).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;

  // Show / Sort: everyone or only the people who have never signed in; the list's order or by last sign-in.
  const [show, setShow] = useState<'all' | 'never'>('all');
  const [sort, setSort] = useState<SignInSort>('newest');
  const shown = sortBySignIn(show === 'never' ? users.filter((u) => !u.lastLoginAt) : users, sort);

  // People picked for "Send welcome emails" (kept in the list's own order when sent).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  // How many "Everyone who has never signed in" left out (sent one in the last 7 days); null once the
  // selection is changed by hand.
  const [leftOut, setLeftOut] = useState<number | null>(null);
  const [confirmingOne, setConfirmingOne] = useState<ApiUser | null>(null);
  const chosen = users.filter((u) => selected.has(u.id));
  const candidates = welcomeCandidates(users, new Date());
  const allShownSelected = shown.length > 0 && shown.every((u) => selected.has(u.id));
  const pickNeverSignedIn = () => {
    setSelected(new Set(candidates.pick.map((u) => u.id)));
    setLeftOut(candidates.leftOut);
  };
  const clearSelection = () => {
    setSelected(new Set());
    setLeftOut(null);
  };
  const toggle = (id: string) => {
    setLeftOut(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleShown = () => {
    setLeftOut(null);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const u of shown) {
        if (allShownSelected) next.delete(u.id);
        else next.add(u.id);
      }
      return next;
    });
  };

  const welcomeOneMut = useMutation({
    mutationFn: (u: ApiUser) => usersApi(apiClient).sendWelcome(u.id),
    onSuccess: (out, u) => {
      setConfirmingOne(null);
      setNotice({ text: `Welcome email sent to ${u.username} (${out.email ?? u.email}).` });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const welcomeBatchMut = useMutation({
    mutationFn: (ids: string[]) => usersApi(apiClient).sendWelcomes(ids),
    onSuccess: (r) => {
      setConfirmingBatch(false);
      clearSelection();
      const missed = r.results
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => !x.sent)
        .map(({ x, i }) => ({ key: `${x.userId}-${i}`, text: `${x.username ?? x.name ?? 'Someone'}: ${x.why ?? 'not sent'}` }));
      setNotice({ text: welcomeBatchSummary(r), ...(missed.length ? { items: missed } : {}), error: r.sent === 0 && r.notSent > 0 });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) => usersApi(apiClient).setStatus(id, status),
    onSuccess: () => { setNotice(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err) => setNotice({ text: reason(err, 'Couldn’t change the account status.'), error: true }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi(apiClient).remove(id),
    onSuccess: () => {
      setConfirmId(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const unlockMut = useMutation({
    mutationFn: (u: ApiUser) => usersApi(apiClient).unlock(u.id),
    onSuccess: (_r, u) => {
      setNotice({ text: `${u.username} can sign in again.` });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err, u) => setNotice({ text: reason(err, `Couldn’t unlock ${u.username}.`), error: true }),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="User &amp; Profile Management"
        subtitle="Create and edit accounts, assign roles, control access, reset passwords and send welcome emails."
        actions={<Button onClick={() => setCreating(true)} title="New user" shortcut="new">+ New user</Button>}
      />

      {notice ? (
        <div
          role={notice.error ? 'alert' : 'status'}
          aria-labelledby="users-notice-text"
          className={`mb-4 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}
        >
          <div className="min-w-0">
            <p id="users-notice-text">{notice.text}</p>
            {notice.items ? (
              <ul className="mt-1 list-disc pl-5">
                {notice.items.map((item) => <li key={item.key}>{item.text}</li>)}
              </ul>
            ) : null}
          </div>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {!emailEnabled ? (
        <p id={NOT_SET_UP_ID} className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Email isn’t set up on this server, so welcome emails can’t be sent. An administrator needs to add the email (Mailjet) keys.
        </p>
      ) : null}

      {lockedCount > 0 ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {lockedCount} account{lockedCount === 1 ? ' is' : 's are'} locked after too many failed sign-in attempts. Unlock {lockedCount === 1 ? 'it' : 'them'} below once you’ve checked it was the account owner.
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="users-show" className="text-xs font-medium text-ink-2">Show</label>
          <select id="users-show" value={show} onChange={(e) => setShow(e.target.value as 'all' | 'never')} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            <option value="all">Everyone</option>
            <option value="never">Never signed in</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="users-sort" className="text-xs font-medium text-ink-2">Sort</label>
          <select id="users-sort" value={sort} onChange={(e) => setSort(e.target.value as SignInSort)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            <option value="newest">Newest accounts first</option>
            <option value="signin-latest">Last sign-in, latest first</option>
            <option value="signin-earliest">Last sign-in, earliest first</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {chosen.length > 0 ? <span className="text-sm font-medium text-ink">{chosen.length} selected</span> : null}
          <Button
            variant="secondary"
            onClick={pickNeverSignedIn}
            disabled={!emailEnabled || candidates.pick.length === 0}
            aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
            title={emailEnabled && candidates.pick.length === 0 ? 'No one to pick: everyone active has signed in, or was sent a welcome email in the last 7 days' : undefined}
          >
            Select everyone who has never signed in
          </Button>
          {chosen.length > 0 ? (
            <>
              <Button onClick={() => { welcomeBatchMut.reset(); setConfirmingBatch(true); }} disabled={!emailEnabled || chosen.length > MAX_WELCOME_BATCH} aria-describedby={chosen.length > MAX_WELCOME_BATCH ? 'users-too-many' : undefined}>
                Send welcome emails
              </Button>
              <button type="button" onClick={clearSelection} className="rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 hover:bg-ground hover:text-ink">
                Clear selection
              </button>
            </>
          ) : null}
        </div>
        {chosen.length > MAX_WELCOME_BATCH ? (
          <p id="users-too-many" className="w-full text-sm text-warning">You can send up to {MAX_WELCOME_BATCH} welcome emails at a time. Choose fewer people.</p>
        ) : null}
      </div>

      {/* Below xl (a phone, a tablet, a small laptop) the table is wider than the page: the names stay put while the rest scrolls. */}
      <p className="mb-2 text-xs text-ink-2 xl:hidden">Swipe the table sideways to see status, last sign-in and actions.</p>
      <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label="Users">
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">
            Couldn’t load users (admin only).{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : show === 'never' && shown.length === 0 ? (
          <p className="p-4 text-ink-2">Everyone has signed in at least once.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                {emailEnabled ? (
                  <th className="w-10 p-3 max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:start-0">
                    <label className={TICK_TARGET}>
                      <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="Select everyone shown" className="h-4 w-4 accent-brand" />
                    </label>
                  </th>
                ) : null}
                <th className={`p-3 max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:border-e max-xl:border-line ${emailEnabled ? 'max-xl:start-10' : 'max-xl:start-0'}`}>User</th>
                <th className="p-3">Email</th>
                <th className="p-3">Roles</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last sign-in</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const isSelf = u.id === meId;
                const welcomeBlocked = welcomeBlockedReason(u, meId);
                return (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    {emailEnabled ? (
                      <td className="p-3 max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:start-0">
                        <label className={TICK_TARGET}>
                          <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.username}`} className="h-4 w-4 accent-brand" />
                        </label>
                      </td>
                    ) : null}
                    <td className={`p-3 font-medium text-ink max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:border-e max-xl:border-line ${emailEnabled ? 'max-xl:start-10' : 'max-xl:start-0'}`}>{u.username}</td>
                    <td className="p-3 text-ink-2">{u.email}</td>
                    <td className="p-3 text-ink-2">{u.roles.join(', ') || '—'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[u.status]}`}>{u.status}</span>
                        {u.locked ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning" title="Locked after too many failed sign-in attempts">
                            <LockIcon />
                            Locked
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-3 text-ink-2">
                      <span className={u.lastLoginAt ? 'text-ink' : 'italic'}>{signInText(u.lastLoginAt, timeZone)}</span>
                      {u.welcomeSentAt ? <span className="block text-xs text-ink-2">{welcomeSentText(u.welcomeSentAt, timeZone)}</span> : null}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { welcomeOneMut.reset(); setConfirmingOne(u); }}
                          disabled={!emailEnabled || !!welcomeBlocked}
                          aria-label={`Send welcome email to ${u.username}`}
                          aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
                          title={welcomeBlocked ?? undefined}
                          className="inline-flex items-center whitespace-nowrap rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink disabled:opacity-50"
                        >
                          <EnvelopeIcon />
                          <span className="hidden sm:inline">Send welcome email</span>
                        </button>
                        {u.locked ? (
                          <button
                            onClick={() => unlockMut.mutate(u)}
                            disabled={unlockMut.isPending}
                            aria-label={`Unlock ${u.username}`}
                            className="rounded-lg border border-warning/40 px-2 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning-soft disabled:opacity-50"
                          >
                            Unlock
                          </button>
                        ) : null}
                        <button
                          onClick={() => setEditing(u)}
                          aria-label={`Edit ${u.username}`}
                          className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink"
                        >
                          Edit
                        </button>
                        <select
                          aria-label={`Status for ${u.username}`}
                          value={u.status}
                          disabled={isSelf || statusMut.isPending}
                          title={isSelf ? 'You can’t change your own status' : undefined}
                          onChange={(e) => statusMut.mutate({ id: u.id, status: e.target.value as UserStatus })}
                          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                          <option value="SUSPENDED">Suspended</option>
                        </select>
                        {confirmId === u.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => deleteMut.mutate(u.id)}
                              disabled={deleteMut.isPending}
                              aria-label={`Confirm deleting ${u.username}`}
                              className="rounded-lg bg-danger px-2 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50"
                            >
                              {deleteMut.isPending ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button onClick={() => { setConfirmId(null); deleteMut.reset(); }} aria-label={`No, keep ${u.username}`} className="rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-ground">
                              No
                            </button>
                            {deleteMut.isError ? (
                              <span role="alert" className="text-xs font-medium text-danger">{reason(deleteMut.error, 'Couldn’t delete. Try again.')}</span>
                            ) : null}
                          </span>
                        ) : (
                          <button
                            onClick={() => { deleteMut.reset(); setConfirmId(u.id); }}
                            disabled={isSelf}
                            aria-label={`Delete ${u.username}`}
                            title={isSelf ? 'You can’t delete your own account' : 'Delete user'}
                            className="rounded-lg border border-line px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirmingBatch ? (
        <ConfirmDialog
          title={welcomeConfirmTitle(chosen.length)}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={welcomeBatchMut.isPending}
          error={welcomeBatchMut.isError ? welcomeFailure(welcomeBatchMut.error) : null}
          onConfirm={() => welcomeBatchMut.mutate(chosen.map((u) => u.id))}
          onClose={() => setConfirmingBatch(false)}
        >
          {/* Everyone it goes to, people filtered off the page included. */}
          <p>To: {namesText(chosen.map(fullName))}.</p>
          <p className="mt-2">
            Each gets their username and a link to set their password, valid for 7 days. Any password they already have keeps working until they use the link, and an earlier welcome link stops working.
          </p>
          <p className="mt-2">{SIGN_OUT_NOTE}</p>
          {leftOut ? <p className="mt-2">{leftOutText(leftOut)}</p> : null}
        </ConfirmDialog>
      ) : null}
      {confirmingOne ? (
        <ConfirmDialog
          title={welcomeOneConfirmTitle(fullName(confirmingOne), confirmingOne.email)}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={welcomeOneMut.isPending}
          error={welcomeOneMut.isError ? welcomeFailure(welcomeOneMut.error) : null}
          onConfirm={() => welcomeOneMut.mutate(confirmingOne)}
          onClose={() => setConfirmingOne(null)}
        >
          {SIGN_OUT_NOTE}
        </ConfirmDialog>
      ) : null}
      {creating ? <CreateUserModal onClose={() => setCreating(false)} onCreated={(result) => setNotice(createdNotice(result))} /> : null}
      {editing ? <EditUserModal user={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
