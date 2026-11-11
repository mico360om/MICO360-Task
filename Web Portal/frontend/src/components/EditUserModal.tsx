import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { ME_KEY } from '../lib/own-user';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { CLIENTS_KEY, clientAsUser, clientKey, clientsApi, isClientRoles, type ClientAccount } from '../api/clients';
import { usersApi, type ApiUser, type TemporaryPasswordStyle, type UserStatus } from '../api/users';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { LoadError } from './ui/LoadError';
import { useDialog } from '../hooks/useDialog';
import { ModalPortal } from './ui/ModalPortal';
import { dialogLayer, dialogPanel, useTwoColumns } from './ui/dialog-size';
import { CompanyChecklist } from './company/CompanyChecklist';
import { useCompanyChoices } from './company/company-admin';
import { Toggle } from './ui/Toggle';
import { SearchableSelect } from './ui/SearchableSelect';
import { MY_PROJECTS_WORDS } from './settings/MyProjectsSettings';
import { DATE_PREFS_KEY } from '../lib/useDatePrefs';
import { resetCompanyScopedQueries } from '../lib/company-scope';
import type { DatePreferences } from '../api/preferences';
import { ClientAccessEditor } from './clients/ClientAccessEditor';
import { grantsChanged, grantsOf, noModuleText, rowsFromAccount, rowsWithoutModule, type AccessRow } from './clients/client-access';
import { SignInSection } from './onboarding/SignInSection';
import { LifetimeSelect, StyleChoice, TemporaryPasswordReveal, useInvitationDays } from './onboarding/way-in';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { EmailTaken, UsernameTaken, useIdentityCheck } from './onboarding/identity';
import { statusChangeWords } from './onboarding/AccountStatusDialog';
import { EMAIL_CHANGE_NOTE } from '../lib/onboarding';
import { emailProblem, organisationProblem, phoneProblem, RULE_WORDS, sameEmail, usernameProblem } from '../lib/account-rules';

export interface EditUserModalProps {
  user: ApiUser;
  onClose: () => void;
}

/** Said on the New password box when Save changes is pressed with a password typed but not reset. */

const ROLE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Administrator', hint: 'Full access — manage users, settings and every project.' },
  { value: 'EMPLOYEE', label: 'Employee', hint: 'Works on assigned tasks and projects.' },
];

const SECTION = 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2';

/** The server's reason for a rejected change (e.g. "the last administrator can't be removed"), else our fallback. */
function reason(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  return fallback;
}

/** Marks a failure of the second step (status change) after the profile update succeeded. */
class StatusChangeError extends Error {
  readonly inner: unknown;
  constructor(inner: unknown) {
    super('status change failed');
    this.inner = inner;
  }
}

/**
 * Admin dialog ("Manage account") to edit a user's profile, roles and status, and to reset their
 * password. On your own account the roles and status are read-only, so an admin can't demote or
 * deactivate themselves by mistake (the server also refuses to remove the last admin).
 * 1.23: a client account edits their details and project access instead (no companies, no staff
 * roles — staff stay staff and clients stay clients; a new account is made for the other kind).
 */
export function EditUserModal({ user, onClose }: EditUserModalProps) {
  return isClientRoles(user.roles) ? <ClientAccountDialog user={user} onClose={onClose} /> : <StaffAccountDialog user={user} onClose={onClose} />;
}

/** The window every account shares: "Manage account", their name, ✕ — and the form its kind brings. */
function AccountDialog({ user, onClose, children }: { user: ApiUser; onClose: () => void; children: ReactNode }) {
  const dialogRef = useDialog(onClose);
  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${user.username}`}
          className={`keyboard-flow-cramped card relative flex ${dialogPanel('wide')} animate-scale-in flex-col overflow-hidden`}
        >
          <div className="flex flex-none items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-2">Manage account</p>
              <h2 dir="auto" className="font-display text-xl font-bold text-ink [overflow-wrap:anywhere]">{user.firstName} {user.lastName}</h2>
              <p className="text-sm text-ink-2">@{user.username}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}

/** Close and Save changes, in a footer that stays in view (above a phone's keyboard too). */
function DialogFooter({ onClose, saving = false, disabled = false }: { onClose: () => void; saving?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-none items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
      <button type="button" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:flex-none">
        Close
      </button>
      <Button type="submit" shortcut="save" showShortcut disabled={disabled} loading={saving} className="!min-h-[44px] flex-[2] sm:min-w-[9.5rem] sm:flex-none">
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}

/**
 * The fields and form body: two columns from 1024px (`left` and `right`, then `below` across both), else
 * one, in `single` order.
 */
function AccountColumns({ left, right, below, single }: { left: ReactNode; right: ReactNode; below?: ReactNode; single: ReactNode }) {
  const twoColumns = useTwoColumns();
  return twoColumns ? (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
        <div data-form-column="profile" className="flex min-w-0 flex-col gap-4">{left}</div>
        <div data-form-column="access" className="flex min-w-0 flex-col gap-4">{right}</div>
      </div>
      {below ? (
        <div data-form-row="access" className="min-w-0 border-t border-line pt-4">
          {below}
        </div>
      ) : null}
    </>
  ) : (
    <>{single}</>
  );
}

interface NameValues {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
}

/**
 * Profile: first and last name, username, email (and, for a client, `more`: organisation and phone).
 * Onboarding: the username rule under its box, a duplicate warning while typing (someone else's email or
 * username), and what an email change means for signing in.
 */
function ProfileFields({ values, onChange, firstRef, more, saved, userId, client = false }: { values: NameValues; onChange: (patch: Partial<NameValues>) => void; firstRef?: Ref<HTMLInputElement>; more?: ReactNode; saved: NameValues; userId: string; client?: boolean }) {
  const emailChanged = !!values.email.trim() && !sameEmail(values.email, saved.email);
  const usernameChanged = values.username.trim() !== saved.username;
  const found = useIdentityCheck({ ...(emailChanged ? { email: values.email } : {}), ...(usernameChanged ? { username: values.username } : {}), excludeId: userId, client });
  const usernameRule = usernameChanged && values.username.trim() ? usernameProblem(values.username) : null;
  const emailRule = emailChanged ? emailProblem(values.email) : null;
  const describe = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={SECTION}>Profile</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="eu-first" required>First name</FieldLabel>
          <input id="eu-first" ref={firstRef} dir="auto" value={values.firstName} onChange={(e) => onChange({ firstName: e.target.value })} className={fieldClass(false)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="eu-last" required>Last name</FieldLabel>
          <input id="eu-last" dir="auto" value={values.lastName} onChange={(e) => onChange({ lastName: e.target.value })} className={fieldClass(false)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-username" required>Username</FieldLabel>
        <input id="eu-username" value={values.username} onChange={(e) => onChange({ username: e.target.value })} autoComplete="off" spellCheck={false} maxLength={191} aria-invalid={usernameRule || found?.username ? true : undefined} aria-describedby={describe('eu-username-hint', usernameRule && 'eu-username-error', found?.username && 'eu-username-taken')} className={fieldClass(!!usernameRule || !!found?.username)} />
        <p id="eu-username-hint" className="text-xs text-ink-2">{RULE_WORDS.username}</p>
        {usernameRule ? <p id="eu-username-error" className="text-xs text-danger">{usernameRule}</p> : null}
        <UsernameTaken id="eu-username-taken" match={found?.username ?? null} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-email" required>Email</FieldLabel>
        <input id="eu-email" type="email" value={values.email} onChange={(e) => onChange({ email: e.target.value })} autoComplete="off" spellCheck={false} maxLength={191} aria-invalid={emailRule || found?.email ? true : undefined} aria-describedby={describe(emailRule && 'eu-email-error', found?.email && 'eu-email-taken', emailChanged && 'eu-email-note')} className={fieldClass(!!emailRule || !!found?.email)} />
        {emailRule ? <p id="eu-email-error" className="text-xs text-danger">{emailRule}</p> : null}
        <EmailTaken id="eu-email-taken" match={found?.email ?? null} />
        {emailChanged && !emailRule && !found?.email ? <p id="eu-email-note" className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">{EMAIL_CHANGE_NOTE}</p> : null}
      </div>
      {more}
    </fieldset>
  );
}

const missingName = (v: NameValues) => !v.firstName.trim() || !v.lastName.trim() || !v.username.trim() || !v.email.trim();

/**
 * 1.23.6 "Set a temporary password": made on the server (never typed here), shown once with Copy and
 * "New one", given to the person by the administrator themselves (never by email). It ends any invitation
 * link (one way in), unlocks a locked account, and must be changed at the person's first sign-in; unused,
 * it stops working after the lifetime. Your own account: change it in Settings instead.
 */
function usePasswordReset(person: { id: string; firstName: string; lastName: string; username: string }, invalidate: () => void, isSelf = false) {
  const [style, setStyle] = useState<TemporaryPasswordStyle>('words');
  const settingDays = useInvitationDays();
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const days = chosenDays ?? settingDays;
  const [made, setMade] = useState<{ password: string; expiresAt: string } | null>(null);
  const [pwNotice, setPwNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const timeZone = useCompanyTimeZone();

  const makeMut = useMutation({
    mutationFn: () => usersApi(apiClient).makeTemporaryPassword(person.id, style, days),
    onMutate: () => setPwNotice(null),
    onSuccess: (m) => {
      setMade({ password: m.temporaryPassword, expiresAt: m.expiresAt });
      invalidate(); // a temporary password also clears a sign-in lock and ends the invitation link
    },
    onError: (err) => setPwNotice({ text: reason(err, 'Couldn’t make a temporary password. Try again.'), error: true }),
  });

  const section = (
    <section aria-labelledby="eu-reset-title" className="flex flex-col gap-2 border-t border-line pt-4">
      <p id="eu-reset-title" className={SECTION}>Set a temporary password</p>
      {isSelf ? (
        <p className="text-xs text-ink-2">Change your own password in Settings → Security.</p>
      ) : (
        <>
          <p className="text-xs text-ink-2">
            We make a strong password for you to give them yourself — never by email. It ends any invitation link, unlocks a locked account, and they choose their own
            at their first sign-in. (Send password reset above emails them a link instead.)
          </p>
          {pwNotice ? (
            <p role={pwNotice.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${pwNotice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
              {pwNotice.text}
            </p>
          ) : null}
          {made ? (
            <TemporaryPasswordReveal
              idPrefix="eu-temp"
              password={made.password}
              personName={`${person.firstName} ${person.lastName}`.trim() || person.username}
              expiresAt={made.expiresAt}
              timeZone={timeZone}
              onNewOne={() => makeMut.mutate()}
              renewing={makeMut.isPending}
            />
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <StyleChoice name="eu-style" value={style} onChange={setStyle} disabled={makeMut.isPending} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
                  <FieldLabel htmlFor="eu-days">Unused, it stops working after</FieldLabel>
                  <LifetimeSelect id="eu-days" value={days} onChange={setChosenDays} disabled={makeMut.isPending} />
                </div>
                <Button type="button" variant="secondary" onClick={() => makeMut.mutate()} loading={makeMut.isPending} className="[@media(pointer:coarse)]:!min-h-11">
                  Make a temporary password
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
  // Nothing typed here any more: Save never has a password to hold back.
  const holdsSave = (): boolean => false;
  const form = null;
  return { section, form, holdsSave };
}

/**
 * Account status: Active, Inactive or Suspended. Onboarding: a change says what Save will do, and takes an
 * optional reason (kept in the audit log with it).
 */
function StatusField({ value, onChange, saved, reason, onReason, name, neverSignedIn }: { value: UserStatus; onChange: (s: UserStatus) => void; saved: UserStatus; reason: string; onReason: (r: string) => void; name: string; neverSignedIn: boolean }) {
  const changed = value !== saved;
  const words = changed ? statusChangeWords(name, value, { neverSignedIn }) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="eu-status">Account status</FieldLabel>
      <select id="eu-status" value={value} onChange={(e) => onChange(e.target.value as UserStatus)} aria-describedby={words ? 'eu-status-note' : undefined} className={fieldClass(false, 'disabled:opacity-60')}>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
        <option value="SUSPENDED">Suspended</option>
      </select>
      {words ? (
        <>
          <p id="eu-status-note" className={`rounded-lg px-3 py-2 text-xs ${value === 'ACTIVE' ? 'bg-info-soft text-info' : 'bg-warning-soft text-warning'}`}>
            On save: {words.body.join(' ')}
          </p>
          <label htmlFor="eu-status-reason" className="text-sm font-medium text-ink">
            Reason<span className="font-normal text-ink-2"> (optional, kept in the audit log)</span>
          </label>
          <textarea id="eu-status-reason" rows={2} maxLength={300} value={reason} onChange={(e) => onReason(e.target.value.slice(0, 300))} className={fieldClass(false)} />
        </>
      ) : null}
    </div>
  );
}

/** A staff account: profile, companies, roles and status, and the password. */
function StaffAccountDialog({ user, onClose }: EditUserModalProps) {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const isSelf = user.id === meId;
  const [names, setNames] = useState<NameValues>({ firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email });
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [statusReason, setStatusReason] = useState('');
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));
  const [error, setError] = useState<string | null>(null);
  const savedNames: NameValues = { firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email };

  // Their companies and primary company (with two or more companies on the site, or on their record).
  // Sent only when changed: a name change never touches them.
  const savedCompanyIds = (user.companies ?? []).map((c) => c.id);
  const savedPrimary = user.primaryCompanyId && savedCompanyIds.includes(user.primaryCompanyId) ? user.primaryCompanyId : (savedCompanyIds[0] ?? null);
  const companyChoices = useCompanyChoices(savedCompanyIds.length);
  const [companyIds, setCompanyIds] = useState<string[]>(savedCompanyIds);
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string | null>(savedPrimary);
  const companiesChanged =
    companyChoices.show &&
    (companyIds.length !== savedCompanyIds.length || companyIds.some((id) => !savedCompanyIds.includes(id)) || primaryCompanyId !== savedPrimary);

  // 1.22.3 "Show my projects only": an administrator's setting (Settings has the same switch for
  // your own). Shown while Administrator is ticked; sent only when changed, and only then.
  const savedMine = user.myProjectsOnly === true;
  const [mine, setMine] = useState(savedMine);
  const adminInForm = roles.has('ADMIN');
  const mineChanged = adminInForm && mine !== savedMine;

  // Training Center: Reports to, Department and the Training manager permission — each sent only when changed.
  const training = useTrainingFields(user);

  // The header reads your own name and photo again too (you may have just edited yourself).
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ME_KEY })]);
  const password = usePasswordReset(user, invalidate, isSelf);

  const saveMut = useMutation({
    mutationFn: async () => {
      await usersApi(apiClient).update(user.id, {
        firstName: names.firstName.trim(),
        lastName: names.lastName.trim(),
        username: names.username.trim(),
        email: names.email.trim(),
        // Your own roles are never sent, so they can't change from this dialog.
        ...(isSelf ? {} : { roleNames: [...roles] }),
        ...(companiesChanged ? { companyIds, primaryCompanyId } : {}),
        ...(mineChanged ? { myProjectsOnly: mine } : {}),
        ...training.patch,
      });
      if (!isSelf && status !== user.status) {
        try {
          await usersApi(apiClient).setStatus(user.id, status, statusReason);
        } catch (err) {
          throw new StatusChangeError(err);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      // Your own: Settings and the Projects page's tick read it again, and every list too (it changes
      // what they hold) — as turning it on or off in Settings does.
      if (isSelf && mineChanged) {
        qc.setQueryData<DatePreferences>(DATE_PREFS_KEY, (prev) => (prev ? { ...prev, myProjectsOnly: mine } : prev));
        void qc.invalidateQueries({ queryKey: DATE_PREFS_KEY });
        resetCompanyScopedQueries(qc);
      }
      onClose();
    },
    onError: (err) => {
      if (err instanceof StatusChangeError) {
        invalidate(); // the profile part was saved
        setError(`Profile saved, but the status couldn’t be changed. ${reason(err.inner, '')}`.trim());
        return;
      }
      setError(reason(err, 'Couldn’t save. Check the details (email/username may already be in use).'));
    },
  });

  function toggleRole(value: string) {
    if (isSelf) return;
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.holdsSave()) return;
    if (missingName(names)) {
      setError('First name, last name, username and email are all required.');
      return;
    }
    // Onboarding: the rules bite on what changes (an older username still saves).
    const nameProblem = (names.username.trim() !== user.username && usernameProblem(names.username)) || (!sameEmail(names.email, user.email) && emailProblem(names.email));
    if (nameProblem) {
      setError(nameProblem);
      return;
    }
    if (!isSelf && roles.size === 0) {
      setError('Give the account at least one role.');
      return;
    }
    saveMut.mutate();
  }

  const profileFields = <ProfileFields values={names} onChange={(p) => setNames((v) => ({ ...v, ...p }))} saved={savedNames} userId={user.id} />;
  const signIn = <SignInSection user={user} />;
  const companiesField = companyChoices.show ? (
    <CompanyChecklist
      companies={companyChoices.companies}
      value={companyIds}
      onChange={setCompanyIds}
      primaryId={primaryCompanyId}
      onPrimaryChange={setPrimaryCompanyId}
      idPrefix="eu-companies"
      variant="section"
    />
  ) : null;
  const accessFields = (
    <fieldset className="flex flex-col gap-3" disabled={isSelf} aria-describedby={isSelf ? 'eu-self-note' : undefined}>
      <legend className={SECTION}>Access</legend>
      {isSelf ? (
        <p id="eu-self-note" className="rounded-lg bg-ground px-3 py-2 text-xs text-ink-2">
          You can’t change your own roles or account status. Ask another administrator if they need to change.
        </p>
      ) : null}
      <StatusField value={status} onChange={setStatus} saved={user.status} reason={statusReason} onReason={setStatusReason} name={`${user.firstName} ${user.lastName}`.trim() || user.username} neverSignedIn={!user.lastLoginAt && !user.activatedAt} />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Roles &amp; permissions</span>
        {ROLE_OPTIONS.map((r) => (
          <label key={r.value} className={`flex items-start gap-2.5 rounded-lg border border-line p-2.5 transition-colors [@media(pointer:coarse)]:!min-h-11 ${isSelf ? 'opacity-60' : 'cursor-pointer hover:bg-ground'}`}>
            <input type="checkbox" aria-label={r.label} checked={roles.has(r.value)} onChange={() => toggleRole(r.value)} className="mt-0.5 h-4 w-4 flex-none accent-brand" />
            <span>
              <span className="block text-sm font-medium text-ink">{r.label}</span>
              <span className="block text-xs text-ink-2">{r.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  // Outside Access: on your own account the roles are locked, this isn't (Settings has it too).
  const projectsField = adminInForm ? (
    <section aria-labelledby="eu-projects-title" className="flex flex-col gap-2">
      <p id="eu-projects-title" className={SECTION}>{MY_PROJECTS_WORDS.heading}</p>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{MY_PROJECTS_WORDS.label}</div>
          <div id="eu-my-projects-hint" className="text-xs text-ink-2">{isSelf ? MY_PROJECTS_WORDS.hint : MY_PROJECTS_WORDS.hintTheirs}</div>
        </div>
        <Toggle on={mine} onChange={() => setMine((v) => !v)} label={MY_PROJECTS_WORDS.label} describedBy="eu-my-projects-hint" />
      </div>
    </section>
  ) : null;

  // Big form (1.22): 960px and two columns from 1024px — the profile and the password on the left,
  // companies and access on the right; Close and Save in a footer that stays in view.
  return (
    <AccountDialog user={user} onClose={onClose}>
      <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
        <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          <AccountColumns
            left={<>{profileFields}{signIn}{password.section}</>}
            right={<>{companiesField}{accessFields}{projectsField}{training.section}</>}
            single={<>{profileFields}{companiesField}{accessFields}{projectsField}{training.section}{signIn}{password.section}</>}
          />
        </div>
        <DialogFooter onClose={onClose} saving={saveMut.isPending} />
      </form>
      {password.form}
    </AccountDialog>
  );
}

/** What the Training fields say (and the tests read). */
export const TRAINING_FIELD_WORDS = {
  reportsToHint: 'Overdue mandatory training is escalated to this person; empty: the Training managers.',
  departmentHint: 'Pick one or type a new name. Empty: no department.',
  managerHint: 'Can create, publish and assign training and see training reports — no other administrator powers.',
} as const;

/**
 * Training Center on a staff account (R16; owner 4 and 15): "Reports to" (active staff, never themselves; overdue
 * mandatory training is escalated to them), "Department" (an existing one or a new name) and the Training manager
 * permission. `patch` holds only what changed.
 */
function useTrainingFields(user: ApiUser) {
  const savedReportsTo = user.reportsToId ?? '';
  const savedDepartment = user.departmentName ?? '';
  const savedManager = user.trainingManager === true;
  const [reportsTo, setReportsTo] = useState(savedReportsTo);
  const [department, setDepartment] = useState(savedDepartment);
  const [manager, setManager] = useState(savedManager);
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const deptQ = useQuery({ queryKey: ['users', 'departments'], queryFn: () => usersApi(apiClient).departments() });
  const people = (Array.isArray(dirQ.data) ? dirQ.data : []).filter((p) => p.active !== false && p.id !== user.id);
  const options = [
    { value: '', label: 'No one' },
    ...people.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName}`.trim() || p.username, hint: `@${p.username}` })),
    // Someone saved before who is no longer offered (made inactive): still named, so the box doesn't look empty.
    ...(savedReportsTo && dirQ.data && !people.some((p) => p.id === savedReportsTo) ? [{ value: savedReportsTo, label: 'Someone no longer active' }] : []),
  ];
  const departments = Array.isArray(deptQ.data) ? deptQ.data : [];
  const patch = {
    ...(reportsTo !== savedReportsTo ? { reportsToId: reportsTo || null } : {}),
    ...(department.trim() !== savedDepartment ? { departmentName: department.trim() || null } : {}),
    ...(manager !== savedManager ? { trainingManager: manager } : {}),
  };
  const section = (
    <section aria-labelledby="eu-training-title" className="flex flex-col gap-3">
      <p id="eu-training-title" className={SECTION}>Training</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink" aria-hidden="true">Reports to</span>
        <SearchableSelect size="lg" ariaLabel="Reports to" describedBy="eu-reports-to-hint" options={options} value={reportsTo} onChange={setReportsTo} placeholder="No one" />
        <p id="eu-reports-to-hint" className="text-xs text-ink-2">{TRAINING_FIELD_WORDS.reportsToHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-department">Department</FieldLabel>
        <input id="eu-department" list="eu-department-list" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={120} autoComplete="off" dir="auto" aria-describedby="eu-department-hint" className={fieldClass(false)} />
        <datalist id="eu-department-list">
          {departments.map((d) => <option key={d.id} value={d.name} />)}
        </datalist>
        <p id="eu-department-hint" className="text-xs text-ink-2">{TRAINING_FIELD_WORDS.departmentHint}</p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Training manager</div>
          <div id="eu-training-manager-hint" className="text-xs text-ink-2">{TRAINING_FIELD_WORDS.managerHint}</div>
        </div>
        <Toggle on={manager} onChange={() => setManager((v) => !v)} label="Training manager" describedBy="eu-training-manager-hint" />
      </div>
    </section>
  );
  return { section, patch };
}

/** A client account: loads their details and project access (GET /clients/:id), then the form. */
function ClientAccountDialog({ user, onClose }: EditUserModalProps) {
  const q = useQuery({ queryKey: clientKey(user.id), queryFn: () => clientsApi(apiClient).get(user.id) });
  return (
    <AccountDialog user={user} onClose={onClose}>
      {q.data ? (
        <ClientAccountForm key={q.data.id} client={q.data} onClose={onClose} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
            {q.isError ? <LoadError what="this client" onRetry={() => void q.refetch()} /> : <p className="text-sm text-ink-2" role="status">Loading…</p>}
          </div>
          {/* The footer as it will be; Save waits for the client. */}
          <form onSubmit={(e) => e.preventDefault()}>
            <DialogFooter onClose={onClose} disabled />
          </form>
        </div>
      )}
    </AccountDialog>
  );
}

function ClientAccountForm({ client, onClose }: { client: ClientAccount; onClose: () => void }) {
  const qc = useQueryClient();
  const [names, setNames] = useState<NameValues>({ firstName: client.firstName, lastName: client.lastName, username: client.username, email: client.email });
  const [organisation, setOrganisation] = useState(client.organisation ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [status, setStatus] = useState<UserStatus>(client.status);
  const [statusReason, setStatusReason] = useState('');
  const savedNames: NameValues = { firstName: client.firstName, lastName: client.lastName, username: client.username, email: client.email };
  const saved = rowsFromAccount(client.projects);
  const [access, setAccess] = useState<AccessRow[]>(saved);
  // After a save attempt: a project with no module is marked in the editor.
  const [accessChecked, setAccessChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  // The fields have just arrived: start on the first one, as a dialog does.
  useEffect(() => firstRef.current?.focus(), []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: CLIENTS_KEY });
  };
  const password = usePasswordReset(client, invalidate);

  const saveMut = useMutation({
    mutationFn: async () => {
      await clientsApi(apiClient).update(client.id, {
        firstName: names.firstName.trim(),
        lastName: names.lastName.trim(),
        username: names.username.trim(),
        email: names.email.trim(),
        organisation: organisation.trim() || null,
        phone: phone.trim() || null,
        // Sent only when changed (exactly these projects): a name change never touches them.
        ...(grantsChanged(saved, access) ? { projects: grantsOf(access) } : {}),
      });
      if (status !== client.status) {
        try {
          await usersApi(apiClient).setStatus(client.id, status, statusReason);
        } catch (err) {
          throw new StatusChangeError(err);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof StatusChangeError) {
        invalidate(); // the details were saved
        setError(`Details saved, but the status couldn’t be changed. ${reason(err.inner, '')}`.trim());
        return;
      }
      setError(reason(err, 'Couldn’t save. Check the details (email/username may already be in use).'));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.holdsSave()) return;
    if (missingName(names)) {
      setError('First name, last name, username and email are all required.');
      return;
    }
    // Onboarding: the rules bite on what changes (an older phone still saves; a set organisation stays set).
    const detailProblem =
      (names.username.trim() !== client.username && usernameProblem(names.username)) ||
      (!sameEmail(names.email, client.email) && emailProblem(names.email)) ||
      ((phone.trim() || null) !== client.phone && phoneProblem(phone)) ||
      ((organisation.trim() || null) !== client.organisation && organisationProblem(organisation, client.organisation !== null));
    if (detailProblem) {
      setError(detailProblem);
      return;
    }
    setAccessChecked(true);
    const missing = rowsWithoutModule(access);
    if (missing.length > 0) {
      setError(noModuleText(missing));
      return;
    }
    saveMut.mutate();
  }

  const profileFields = (
    <ProfileFields
      values={names}
      onChange={(p) => setNames((v) => ({ ...v, ...p }))}
      saved={savedNames}
      userId={client.id}
      client
      firstRef={firstRef}
      more={
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="eu-organisation" required={client.organisation !== null}>
              Organisation{client.organisation === null ? <span className="font-normal text-ink-2"> (optional)</span> : null}
            </FieldLabel>
            <input id="eu-organisation" dir="auto" value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={160} autoComplete="organization" aria-describedby="eu-organisation-hint" className={fieldClass(false)} />
            <p id="eu-organisation-hint" className="text-xs text-ink-2">{RULE_WORDS.organisation}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="eu-phone">
              Phone<span className="font-normal text-ink-2"> (optional)</span>
            </FieldLabel>
            <input id="eu-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" aria-describedby="eu-phone-hint" className={fieldClass(false)} />
            <p id="eu-phone-hint" className="text-xs text-ink-2">{RULE_WORDS.phone}</p>
          </div>
        </div>
      }
    />
  );
  // 1.23.7 The permission matrix, with "Preview as client": their saved account, the details as typed and the
  // matrix on screen (nothing is saved first).
  const accessField = (
    <ClientAccessEditor
      value={access}
      onChange={setAccess}
      idPrefix="eu-access"
      showErrors={accessChecked}
      variant="section"
      preview={{ clientId: client.id, firstName: names.firstName.trim(), lastName: names.lastName.trim(), organisation: organisation.trim() || null, email: names.email.trim() }}
    />
  );
  const accountFields = (
    <fieldset className="flex flex-col gap-3">
      <legend className={SECTION}>Account</legend>
      <p className="rounded-lg bg-ground px-3 py-2 text-xs text-ink-2">
        Client account: they sign in to the Client portal only. To make them staff, make a new account.
      </p>
      <StatusField value={status} onChange={setStatus} saved={client.status} reason={statusReason} onReason={setStatusReason} name={`${client.firstName} ${client.lastName}`.trim() || client.username} neverSignedIn={!client.lastLoginAt && !client.activatedAt} />
    </fieldset>
  );
  const signIn = <SignInSection user={clientAsUser(client)} />;

  return (
    <>
      <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
        <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          {/* 1.23.7: from 1024px the permission matrix takes the whole width, below the two columns. */}
          <AccountColumns
            left={<>{profileFields}{password.section}</>}
            right={<>{accountFields}{signIn}</>}
            below={accessField}
            single={<>{profileFields}{accessField}{accountFields}{signIn}{password.section}</>}
          />
        </div>
        <DialogFooter onClose={onClose} saving={saveMut.isPending} />
      </form>
      {password.form}
    </>
  );
}
