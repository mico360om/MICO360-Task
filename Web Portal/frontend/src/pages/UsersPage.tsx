import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CreateUserModal } from '../components/CreateUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { usersApi, type ApiUser, type CreatedUser, type UserStatus } from '../api/users';
import { CLIENTS_KEY, clientAsUser, clientsApi, isClientRoles } from '../api/clients';
import { Badge } from '../components/ui/Badge';
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
  type SignInSort,
} from '../lib/user-sign-in';
import { inviteConfirmTitle, invitationLabel, invitationSentText, RESET_LINK_NOTE } from '../lib/user-sign-in';
import { useAuthStore } from '../stores/auth-store';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { useNewFromAddress } from '../lib/useNewFromAddress';
import { useMediaQuery } from '../lib/useMediaQuery';
import { BulkCompanyDialog } from '../components/company/BulkCompanyDialog';
import { peopleChangeText, useCompanyChoices } from '../components/company/company-admin';
import { useMyCompanies } from '../hooks/useMyCompanies';
import { DENSE_TEXT } from '../lib/density-tokens';
import { OnboardingStatusCell } from '../components/onboarding/OnboardingCells';
import { AccountStatusDialog } from '../components/onboarding/AccountStatusDialog';
import { EMAIL_OFF_BANNER, invitedText, matchesStatusFilter, NO_ONE_WITH_STATUS, ONBOARDING_FILTERS, type StatusFilter } from '../lib/onboarding';

/** The server's reason for a rejected change (e.g. "the last administrator can't be removed"), else our fallback. */
function reason(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

/** The server's words for a welcome email (invitation) or reset link it didn't send (refused, too soon, email not set up, not delivered). */
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
  /** More of the same, folded under "Show all" (a bulk company change's other refusals). */
  more?: { key: string; text: string }[];
  error?: boolean;
}

/** A person's companies (A–Z, as the server lists them), their primary and archived ones marked; "No company" when none. */
function CompanyNames({ user, archived }: { user: ApiUser; archived: ReadonlySet<string> }) {
  const companies = user.companies ?? [];
  // 1.23: a client account never belongs to a company.
  if (companies.length === 0 && isClientRoles(user.roles)) return <span className="text-ink-3">None (client)</span>;
  if (companies.length === 0) return <span className="text-ink-3">No company</span>;
  return (
    <ul aria-label="Companies" className="flex flex-wrap gap-1">
      {companies.map((c) => {
        const primary = c.id === user.primaryCompanyId;
        const marks = [primary ? 'primary' : null, archived.has(c.id) ? 'archived' : null].filter(Boolean).join(', ');
        return (
          <li key={c.id} title={primary ? 'Primary company: their emails use its logo and name' : undefined} className={`rounded-md px-1.5 py-0.5 text-xs ${primary ? 'bg-brand/10 font-semibold text-brand' : 'bg-ground text-ink-2'}`}>
            <bdi>{c.name}</bdi>
            {marks ? <span className="font-normal"> ({marks})</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

const NOT_SET_UP_ID = 'users-email-not-set-up';

/** The Role filter (1.23): everyone, or the people with one role. */
type RoleFilter = '' | 'ADMIN' | 'EMPLOYEE' | 'CLIENT';
const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: '', label: 'All roles' },
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'CLIENT', label: 'Client' },
];
const NO_ONE_WITH_ROLE: Record<Exclude<RoleFilter, ''>, string> = {
  ADMIN: 'No one is an administrator.',
  EMPLOYEE: 'No one is an employee.',
  CLIENT: 'No client accounts yet. Make one with New user and Role “Client”.',
};
/** Said by the company bulk buttons (1.23): clients never belong to a company. */
const CLIENTS_NO_COMPANY = 'Clients don’t belong to companies';
const clientsLeftOut = (n: number) => `${n} ${n === 1 ? 'client' : 'clients'} left out: clients don’t belong to companies.`;
const fullName = (u: ApiUser) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;

/** A key: the row's "Send password reset" below sm, where the words would widen the row. */
const KeyIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sm:hidden">
    <circle cx="8" cy="15" r="4" />
    <path d="m10.8 12.2 9.2-9.2M17 6l3 3M14.5 8.5l2 2" />
  </svg>
);

/** An envelope: the row's "Resend invitation" on a phone, where the words would widen the row. */
const EnvelopeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sm:hidden">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </svg>
);

/** A tick box's finger-sized target on a touch screen: its label, 44px, in the cell's padding (the box stays 16px). */
const TICK_TARGET = 'grid cursor-pointer place-items-center [@media(pointer:coarse)]:-m-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
/** Below 768px (the md width, in em as the layout's widths are): one card per person instead of the table. */
const PHONE_QUERY = '(max-width: 47.9375em)';
/** On a card, each control is finger-sized on a touch screen (in the table they sit in a tight row). */
const CARD_TOUCH = '[@media(pointer:coarse)]:!min-h-11';
/**
 * Below xl (1280px) the table is wider than the page: the tick box and the name stay put while the
 * rest scrolls. With the Companies column (two or more companies) it is wider still, so up to 2xl (1536px).
 */
const STICKY = {
  xl: { tick: 'max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:start-0', name: 'max-xl:sticky max-xl:z-[1] max-xl:bg-surface max-xl:border-e max-xl:border-line', afterTick: 'max-xl:start-10', first: 'max-xl:start-0', hint: 'xl:hidden' },
  '2xl': { tick: 'max-2xl:sticky max-2xl:z-[1] max-2xl:bg-surface max-2xl:start-0', name: 'max-2xl:sticky max-2xl:z-[1] max-2xl:bg-surface max-2xl:border-e max-2xl:border-line', afterTick: 'max-2xl:start-10', first: 'max-2xl:start-0', hint: '2xl:hidden' },
} as const;

export function UsersPage() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  useShortcut('new', () => setCreating(true));
  // /admin/users?new=1 (the first steps' "Add your team") opens the New user form on arrival.
  useNewFromAddress(() => setCreating(true));
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Companies (two or more on the site): a Companies column, a filter that starts at the picked company
  // (the choice isn't remembered; a new pick starts it again), and bulk add / remove.
  const { pick } = useMyCompanies();
  const companyChoices = useCompanyChoices();
  const multi = companyChoices.show;
  const archivedIds = new Set(companyChoices.companies.filter((c) => c.status === 'ARCHIVED').map((c) => c.id));
  const [companyChoice, setCompanyChoice] = useState<{ pick: string | null; value: string }>({ pick, value: pick ?? '' });
  // Only with the filter on screen (two or more companies): a pick from before can't narrow the list unseen.
  const companyFilter = !multi ? '' : companyChoice.pick === pick ? companyChoice.value : (pick ?? '');
  const [bulk, setBulk] = useState<'add' | 'remove' | null>(null);
  const q = useQuery({
    queryKey: ['users', companyFilter || 'all'],
    queryFn: () => usersApi(apiClient).list(companyFilter ? { companyId: companyFilter } : undefined),
  });
  const phone = useMediaQuery(PHONE_QUERY);
  const users = Array.isArray(q.data) ? q.data : [];
  // 1.23.6: /admin/users?open=<id> (a client account found by search) opens that person's Manage account
  // — a client account from the clients list when a company filter leaves it out — then leaves the address.
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!openId || !q.isSuccess) return;
    const shown = users.find((u) => u.id === openId);
    if (shown) setEditing(shown);
    else
      void clientsApi(apiClient)
        .list()
        .then((list) => (Array.isArray(list) ? list.find((c) => c.id === openId) : undefined))
        .then((c) => {
          if (c && mounted.current) setEditing(clientAsUser(c));
        })
        .catch(() => undefined);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      },
      { replace: true },
    );
  }, [openId, q.isSuccess]);
  // 1.23: client accounts' organisations (the people list doesn't carry them), once any client is listed.
  const anyClient = users.some((u) => isClientRoles(u.roles));
  const clientsQ = useQuery({ queryKey: CLIENTS_KEY, queryFn: () => clientsApi(apiClient).list(), enabled: anyClient });
  const organisationOf = new Map((Array.isArray(clientsQ.data) ? clientsQ.data : []).map((c) => [c.id, c.organisation]));
  const lockedCount = users.filter((u) => u.locked).length;
  const timeZone = useCompanyTimeZone();
  // Welcome emails need email set up on the server (until /config answers, they're offered).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;
  // Tick boxes: for welcome emails (email set up) and, with two or more companies, for bulk assign.
  const selectable = emailEnabled || multi;
  const sticky = STICKY[multi ? '2xl' : 'xl'];
  const nameCell = `${sticky.name} ${selectable ? sticky.afterTick : sticky.first}`;

  // Show / Sort: everyone or only the people who have never signed in; the list's order or by last sign-in.
  const [show, setShow] = useState<'all' | 'never'>('all');
  const [sort, setSort] = useState<SignInSort>('newest');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  // Onboarding: the status filter (Invited / Invite expired / Active / Locked / Deactivated).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const withRole = (roleFilter ? users.filter((u) => u.roles.includes(roleFilter)) : users).filter((u) => matchesStatusFilter(u, statusFilter));
  const shown = sortBySignIn(show === 'never' ? withRole.filter((u) => !u.lastLoginAt) : withRole, sort);

  // People picked for "Send welcome emails" (kept in the list's own order when sent).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  // How many "Everyone who has never signed in" left out (sent one in the last 7 days); null once the
  // selection is changed by hand.
  const [leftOut, setLeftOut] = useState<number | null>(null);
  const [confirmingOne, setConfirmingOne] = useState<ApiUser | null>(null);
  // Onboarding: "Send password reset" and a status change, each asked first.
  const [resetting, setResetting] = useState<ApiUser | null>(null);
  const [statusChange, setStatusChange] = useState<{ user: ApiUser; to: UserStatus } | null>(null);
  const chosen = users.filter((u) => selected.has(u.id));
  // Company changes are for staff: the clients ticked are left out (and said so).
  const chosenStaff = chosen.filter((u) => !isClientRoles(u.roles));
  const chosenClients = chosen.length - chosenStaff.length;
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
      setNotice({ text: invitationSentText(u, out.email ?? u.email) });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const resetMut = useMutation({
    mutationFn: (u: ApiUser) => usersApi(apiClient).sendPasswordReset(u.id),
    onSuccess: (out, u) => {
      setResetting(null);
      setNotice({ text: `Password reset link sent to ${u.username} (${out.email ?? u.email}).` });
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
    mutationFn: ({ id, status, why }: { id: string; status: UserStatus; why?: string }) => usersApi(apiClient).setStatus(id, status, why),
    onSuccess: (_r, { status }) => {
      const u = statusChange?.user;
      setStatusChange(null);
      setNotice(u ? { text: status === 'ACTIVE' ? `${u.username} can sign in again.` : `${u.username} can’t sign in now.` } : null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
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

  // Onboarding: "Open account" from a duplicate warning — that person's Manage account.
  const openAccount = (id: string) => {
    setCreating(false);
    const listed = users.find((u) => u.id === id);
    if (listed) {
      setEditing(listed);
      return;
    }
    void usersApi(apiClient).get(id).then(setEditing, () => setNotice({ text: 'Couldn’t open that account. Try again.', error: true }));
  };

  // One person's parts, shared by the table's row and (below 768px) their card.
  const tickBox = (u: ApiUser) => (
    <label className={TICK_TARGET}>
      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.username}`} className="h-4 w-4 accent-brand" />
    </label>
  );
  /** The person's name, and under it the username they sign in with. */
  const who = (u: ApiUser) =>
    fullName(u) !== u.username ? (
      <>
        <bdi className="block whitespace-nowrap">{fullName(u)}</bdi>
        <span className="block text-xs font-normal text-ink-3"><span>@</span><span data-username>{u.username}</span></span>
      </>
    ) : (
      <span data-username>{u.username}</span>
    );
  /** Their roles: a client's "Client" badge (and organisation), staff as before. */
  const roleWords = (u: ApiUser) => {
    if (!isClientRoles(u.roles)) return <>{u.roles.join(', ') || '—'}</>;
    const organisation = organisationOf.get(u.id);
    return (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone="info">Client</Badge>
        {organisation ? <bdi className="text-xs text-ink-2 [overflow-wrap:anywhere]">{organisation}</bdi> : null}
      </span>
    );
  };
  // Onboarding: Invited · 3 days ago / Invite expired / Active / Locked / Deactivated, and email verified or not.
  const statusBadges = (u: ApiUser) => <OnboardingStatusCell person={u} />;
  const lastSignIn = (u: ApiUser) => {
    const invited = invitedText(u, timeZone);
    return (
      <>
        <span className={u.lastLoginAt ? 'text-ink' : 'italic'}>{signInText(u.lastLoginAt, timeZone)}</span>
        {invited ? <span className="block text-xs text-ink-2">{invited}</span> : null}
      </>
    );
  };
  /** Welcome email, Unlock, Edit, Status and Delete. `card`: on a phone's card (words, finger-sized). */
  const actionsFor = (u: ApiUser, card = false) => {
    const isSelf = u.id === meId;
    const welcomeBlocked = welcomeBlockedReason(u, meId);
    const touch = card ? ` ${CARD_TOUCH}` : '';
    return (
      <>
        <button
          onClick={() => { welcomeOneMut.reset(); setConfirmingOne(u); }}
          disabled={!emailEnabled || !!welcomeBlocked}
          aria-label={`${invitationLabel(u)} to ${u.username}`}
          aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
          title={welcomeBlocked ?? undefined}
          className={`inline-flex items-center whitespace-nowrap rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink disabled:opacity-50${touch}`}
        >
          {card ? <span>{invitationLabel(u)}</span> : (
            <>
              <EnvelopeIcon />
              <span className="hidden sm:inline">{invitationLabel(u)}</span>
            </>
          )}
        </button>
        <button
          onClick={() => { resetMut.reset(); setResetting(u); }}
          disabled={!emailEnabled || u.status !== 'ACTIVE'}
          aria-label={`Send password reset to ${u.username}`}
          aria-describedby={!emailEnabled ? NOT_SET_UP_ID : undefined}
          title={u.status !== 'ACTIVE' ? 'Reactivate the account first' : 'Email them a link to choose a new password (works for an hour)'}
          className={`inline-flex items-center whitespace-nowrap rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink disabled:opacity-50${touch}`}
        >
          {card ? <span>Send password reset</span> : (
            <>
              <KeyIcon />
              <span className="hidden sm:inline">Password reset</span>
            </>
          )}
        </button>
        {u.locked ? (
          <button
            onClick={() => unlockMut.mutate(u)}
            disabled={unlockMut.isPending}
            aria-label={`Unlock ${u.username}`}
            className={`rounded-lg border border-warning/40 px-2 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning-soft disabled:opacity-50${touch}`}
          >
            Unlock
          </button>
        ) : null}
        <button
          onClick={() => setEditing(u)}
          aria-label={`Edit ${u.username}`}
          className={`rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink${touch}`}
        >
          Edit
        </button>
        <select
          aria-label={`Status for ${u.username}`}
          value={u.status}
          disabled={isSelf || statusMut.isPending}
          title={isSelf ? 'You can’t change your own status' : undefined}
          onChange={(e) => { statusMut.reset(); setStatusChange({ user: u, to: e.target.value as UserStatus }); }}
          className={`rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50${touch}`}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        {confirmId === u.id ? (
          <span className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => deleteMut.mutate(u.id)}
              disabled={deleteMut.isPending}
              aria-label={`Confirm deleting ${u.username}`}
              className={`rounded-lg bg-danger px-2 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50${touch}`}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Confirm'}
            </button>
            <button onClick={() => { setConfirmId(null); deleteMut.reset(); }} aria-label={`No, keep ${u.username}`} className={`rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-ground${touch}`}>
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
            className={`rounded-lg border border-line px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40${touch}`}
          >
            Delete
          </button>
        )}
      </>
    );
  };

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
            {notice.more?.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer font-medium">Show all</summary>
                <ul className="mt-1 list-disc pl-5">
                  {notice.more.map((item) => <li key={item.key}>{item.text}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {!emailEnabled ? (
        <p id={NOT_SET_UP_ID} className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {EMAIL_OFF_BANNER}
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
        {multi ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="users-company" className="text-xs font-medium text-ink-2">Company</label>
            <select
              id="users-company"
              value={companyFilter}
              onChange={(e) => {
                clearSelection();
                setCompanyChoice({ pick, value: e.target.value });
              }}
              className="max-w-[16rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">All companies</option>
              {companyChoices.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.status === 'ARCHIVED' ? `${c.name} (archived)` : c.name}</option>
              ))}
              <option value="none">No company</option>
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="users-status" className="text-xs font-medium text-ink-2">Status</label>
          <select id="users-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            {ONBOARDING_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="users-role" className="text-xs font-medium text-ink-2">Role</label>
          <select id="users-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            {ROLE_FILTERS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
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
              {multi ? (
                <>
                  <Button variant="secondary" onClick={() => setBulk('add')} disabled={chosenStaff.length === 0} title={chosenStaff.length === 0 ? CLIENTS_NO_COMPANY : undefined}>Add to a company…</Button>
                  <Button variant="secondary" onClick={() => setBulk('remove')} disabled={chosenStaff.length === 0} title={chosenStaff.length === 0 ? CLIENTS_NO_COMPANY : undefined}>Remove from a company…</Button>
                </>
              ) : null}
              {emailEnabled ? (
                <Button onClick={() => { welcomeBatchMut.reset(); setConfirmingBatch(true); }} disabled={chosen.length > MAX_WELCOME_BATCH} aria-describedby={chosen.length > MAX_WELCOME_BATCH ? 'users-too-many' : undefined}>
                  Send welcome emails
                </Button>
              ) : null}
              <button type="button" onClick={clearSelection} className="rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 hover:bg-ground hover:text-ink">
                Clear selection
              </button>
            </>
          ) : null}
        </div>
        {multi && chosenClients > 0 ? <p className="w-full text-sm text-ink-2">Clients are left out of company changes: they don’t belong to companies.</p> : null}
        {emailEnabled && chosen.length > MAX_WELCOME_BATCH ? (
          <p id="users-too-many" className="w-full text-sm text-warning">You can send up to {MAX_WELCOME_BATCH} welcome emails at a time. Choose fewer people.</p>
        ) : null}
      </div>

      {/* From 768px to xl (a tablet, a small laptop) the table is wider than the page: the names stay put
          while the rest scrolls. Below 768px (a phone) each person is a card instead. */}
      {phone ? null : <p className={`mb-2 text-xs text-ink-2 ${sticky.hint}`}>Swipe the table sideways to see status, last sign-in and actions.</p>}
      <div className={phone ? '' : 'card overflow-x-auto'} tabIndex={phone ? undefined : 0} role={phone ? undefined : 'region'} aria-label={phone ? undefined : 'Users'}>
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">
            Couldn’t load users (admin only).{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : roleFilter && withRole.length === 0 ? (
          <p className="p-4 text-ink-2">{NO_ONE_WITH_ROLE[roleFilter]}</p>
        ) : statusFilter && withRole.length === 0 ? (
          <p className="p-4 text-ink-2">{NO_ONE_WITH_STATUS[statusFilter]}</p>
        ) : show === 'never' && shown.length === 0 ? (
          <p className="p-4 text-ink-2">Everyone has signed in at least once.</p>
        ) : companyFilter && shown.length === 0 ? (
          <p className="p-4 text-ink-2">
            {companyFilter === 'none' ? 'Everyone has a company.' : <>No one is in <bdi>{companyChoices.companies.find((c) => c.id === companyFilter)?.name ?? 'this company'}</bdi>.</>}
          </p>
        ) : phone ? (
          <>
            {selectable ? (
              <label className={`mb-2 inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-2 ${CARD_TOUCH}`}>
                <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="Select everyone shown" className="h-4 w-4 accent-brand" />
                Select everyone shown
              </label>
            ) : null}
            <ul aria-label="Users" className="flex flex-col gap-2">
              {shown.map((u) => (
                <li key={u.id} className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-soft">
                  <div className="flex items-start gap-3">
                    {selectable ? <div className="pt-0.5 [@media(pointer:coarse)]:pt-2.5">{tickBox(u)}</div> : null}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink [overflow-wrap:anywhere] [&_bdi]:whitespace-normal">{who(u)}</div>
                      <p className="mt-0.5 truncate text-sm text-ink-2" title={u.email}>{u.email}</p>
                    </div>
                    <div className="flex-none">{statusBadges(u)}</div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-ink-3">Roles</dt>
                      <dd className="text-ink-2 [overflow-wrap:anywhere]">{roleWords(u)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-ink-3">Last sign-in</dt>
                      <dd className="text-ink-2">{lastSignIn(u)}</dd>
                    </div>
                    {multi ? (
                      <div className="col-span-2 min-w-0">
                        <dt className="text-xs text-ink-3">Companies</dt>
                        <dd className="mt-0.5"><CompanyNames user={u} archived={archivedIds} /></dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-2">{actionsFor(u, true)}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          // Compact rows (1.23.0, lib/density): a third less padding in each row, the words a step smaller.
          <table className={`w-full text-sm ${DENSE_TEXT}`}>
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                {selectable ? (
                  <th className={`w-10 p-3 ${sticky.tick}`}>
                    <label className={TICK_TARGET}>
                      <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="Select everyone shown" className="h-4 w-4 accent-brand" />
                    </label>
                  </th>
                ) : null}
                <th className={`p-3 ${nameCell}`}>User</th>
                <th className="p-3">Email</th>
                <th className="p-3">Roles</th>
                {multi ? <th className="p-3">Companies</th> : null}
                <th className="p-3">Status</th>
                <th className="p-3">Last sign-in</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0 compact:[&>td]:py-2">
                  {selectable ? (
                    <td className={`p-3 ${sticky.tick}`}>{tickBox(u)}</td>
                  ) : null}
                  <td className={`p-3 font-medium text-ink ${nameCell}`}>
                    {who(u)}
                  </td>
                  <td className="p-3 text-ink-2">{u.email}</td>
                  <td className="p-3 text-ink-2">{roleWords(u)}</td>
                  {multi ? <td className="min-w-[10rem] p-3"><CompanyNames user={u} archived={archivedIds} /></td> : null}
                  <td className="p-3">{statusBadges(u)}</td>
                  <td className="whitespace-nowrap p-3 text-ink-2">{lastSignIn(u)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">{actionsFor(u)}</div>
                  </td>
                </tr>
              ))}
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
          title={inviteConfirmTitle(confirmingOne, fullName(confirmingOne))}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={welcomeOneMut.isPending}
          error={welcomeOneMut.isError ? welcomeFailure(welcomeOneMut.error) : null}
          onConfirm={() => welcomeOneMut.mutate(confirmingOne)}
          onClose={() => setConfirmingOne(null)}
        >
          <p>A welcome email with their username and a link to set their password, valid for 7 days. An earlier invitation stops working.</p>
          <p className="mt-2">{SIGN_OUT_NOTE}</p>
        </ConfirmDialog>
      ) : null}
      {resetting ? (
        <ConfirmDialog
          title={`Send a password reset link to ${fullName(resetting)} (${resetting.email})?`}
          confirmLabel="Send"
          keepLabel="Cancel"
          tone="primary"
          busy={resetMut.isPending}
          error={resetMut.isError ? welcomeFailure(resetMut.error) : null}
          onConfirm={() => resetMut.mutate(resetting)}
          onClose={() => setResetting(null)}
        >
          {RESET_LINK_NOTE}
        </ConfirmDialog>
      ) : null}
      {statusChange ? (
        <AccountStatusDialog
          name={fullName(statusChange.user)}
          to={statusChange.to}
          neverSignedIn={!statusChange.user.lastLoginAt && !statusChange.user.activatedAt}
          busy={statusMut.isPending}
          error={statusMut.isError ? reason(statusMut.error, 'Couldn’t change the account status.') : null}
          onConfirm={(why) => statusMut.mutate({ id: statusChange.user.id, status: statusChange.to, why })}
          onClose={() => setStatusChange(null)}
        />
      ) : null}
      {creating ? <CreateUserModal onClose={() => setCreating(false)} onCreated={(result) => setNotice(createdNotice(result))} onOpenAccount={openAccount} /> : null}
      {editing ? <EditUserModal user={editing} onClose={() => setEditing(null)} /> : null}
      {bulk ? (
        <BulkCompanyDialog
          mode={bulk}
          userIds={chosenStaff.map((u) => u.id)}
          onClose={() => setBulk(null)}
          onDone={(result) => {
            setBulk(null);
            const leftOut = chosenClients;
            clearSelection();
            const { text, more } = peopleChangeText(result);
            setNotice({ text: leftOut > 0 ? `${text} ${clientsLeftOut(leftOut)}` : text, ...(more.length ? { more } : {}), error: result.changed === 0 && result.refused.length > 0 });
          }}
        />
      ) : null}
    </div>
  );
}
