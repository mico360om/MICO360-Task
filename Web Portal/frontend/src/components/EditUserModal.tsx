import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usersApi, type ApiUser, type UserStatus } from '../api/users';
import { ApiError } from '../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../lib/passwordPolicy';
import { useAuthStore } from '../stores/auth-store';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { useDialog } from '../hooks/useDialog';
import { ModalPortal } from './ui/ModalPortal';
import { dialogLayer, dialogPanel, useTwoColumns } from './ui/dialog-size';
import { CompanyChecklist } from './company/CompanyChecklist';
import { useCompanyChoices } from './company/company-admin';
import { Toggle } from './ui/Toggle';
import { MY_PROJECTS_WORDS } from './settings/MyProjectsSettings';
import { DATE_PREFS_KEY } from '../lib/useDatePrefs';
import { resetCompanyScopedQueries } from '../lib/company-scope';
import type { DatePreferences } from '../api/preferences';

export interface EditUserModalProps {
  user: ApiUser;
  onClose: () => void;
}

/** Said on the New password box when Save changes is pressed with a password typed but not reset. */
const UNAPPLIED_PASSWORD = 'This new password isn’t set yet. Press Reset to set it, or clear this box.';

const ROLE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Administrator', hint: 'Full access — manage users, settings and every project.' },
  { value: 'EMPLOYEE', label: 'Employee', hint: 'Works on assigned tasks and projects.' },
];

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
 * Admin dialog to edit a user's profile, roles and status, and to reset their password.
 * On your own account the roles and status are read-only, so an admin can't demote or
 * deactivate themselves by mistake (the server also refuses to remove the last admin).
 */
export function EditUserModal({ user, onClose }: EditUserModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const meId = useAuthStore((s) => s.user?.id);
  const isSelf = user.id === meId;
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));
  const [error, setError] = useState<string | null>(null);

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

  const [newPassword, setNewPassword] = useState('');
  const [pwNotice, setPwNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const newPwRef = useRef<HTMLInputElement>(null);
  const resetFormId = `${useId()}-reset`;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const saveMut = useMutation({
    mutationFn: async () => {
      await usersApi(apiClient).update(user.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        email: email.trim(),
        // Your own roles are never sent, so they can't change from this dialog.
        ...(isSelf ? {} : { roleNames: [...roles] }),
        ...(companiesChanged ? { companyIds, primaryCompanyId } : {}),
        ...(mineChanged ? { myProjectsOnly: mine } : {}),
      });
      if (!isSelf && status !== user.status) {
        try {
          await usersApi(apiClient).setStatus(user.id, status);
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

  const resetPwMut = useMutation({
    mutationFn: () => usersApi(apiClient).resetPassword(user.id, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setPwNotice({ text: 'Password reset. Share the new password with the user securely.' });
      invalidate(); // a reset also clears a sign-in lock
    },
    onError: (err) => setPwNotice({ text: reason(err, `Couldn’t reset the password. ${PASSWORD_RULE_ERROR}`), error: true }),
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
    // 1.22 review: a new password typed but not reset is never dropped by Save changes — the dialog
    // stays open and says so on the box (Reset sets it; clearing the box lets Save go ahead).
    if (newPassword !== '') {
      setPwNotice({ text: UNAPPLIED_PASSWORD, error: true });
      newPwRef.current?.focus();
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim()) {
      setError('First name, last name, username and email are all required.');
      return;
    }
    if (!isSelf && roles.size === 0) {
      setError('Give the account at least one role.');
      return;
    }
    saveMut.mutate();
  }

  function resetPassword(e?: FormEvent) {
    e?.preventDefault();
    setPwNotice(null);
    if (!isStrongPassword(newPassword)) {
      setPwNotice({ text: PASSWORD_RULE_ERROR, error: true });
      return;
    }
    resetPwMut.mutate();
  }

  // Big form (1.22): 960px and two columns from 1024px — the profile and the password on the left,
  // companies and access on the right; Close and Save in a footer that stays in view.
  const twoColumns = useTwoColumns();
  const SECTION = 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2';
  const profileFields = (
    <fieldset className="flex flex-col gap-3">
      <legend className={SECTION}>Profile</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="eu-first" required>First name</FieldLabel>
          <input id="eu-first" dir="auto" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass(false)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="eu-last" required>Last name</FieldLabel>
          <input id="eu-last" dir="auto" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass(false)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-username" required>Username</FieldLabel>
        <input id="eu-username" value={username} onChange={(e) => setUsername(e.target.value)} className={fieldClass(false)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-email" required>Email</FieldLabel>
        <input id="eu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass(false)} />
      </div>
    </fieldset>
  );
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
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="eu-status">Account status</FieldLabel>
        <select id="eu-status" value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} className={fieldClass(false, 'disabled:opacity-60')}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>
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
  // Reset password is its own form (1.22 review): its box and Reset button belong to the reset form
  // (the `form` attribute — that form sits after the profile's, so both layouts keep their places).
  // Enter in the box or Reset resets the password and never saves the profile.
  const passwordFields = (
    <section aria-labelledby="eu-reset-title" className="flex flex-col gap-1.5 border-t border-line pt-4">
      <p id="eu-reset-title" className={SECTION}>Reset password</p>
      <p className="text-xs text-ink-2">Set a new password for this user. They can change it after signing in. Resetting also unlocks a locked account.</p>
      {pwNotice ? (
        <p id="eu-newpw-notice" role={pwNotice.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${pwNotice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          {pwNotice.text}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <FieldLabel htmlFor="eu-newpw">New password</FieldLabel>
          <input
            ref={newPwRef}
            id="eu-newpw"
            form={resetFormId}
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPwNotice(null); }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (newPassword && !resetPwMut.isPending) resetPassword();
            }}
            autoComplete="new-password"
            aria-describedby={pwNotice ? 'eu-newpw-notice eu-newpw-hint' : 'eu-newpw-hint'}
            aria-invalid={pwNotice?.error ? true : undefined}
            className={fieldClass(false)}
          />
        </div>
        <Button type="submit" form={resetFormId} variant="secondary" disabled={!newPassword || resetPwMut.isPending} loading={resetPwMut.isPending} className="[@media(pointer:coarse)]:!min-h-11">
          Reset
        </Button>
      </div>
      <p id="eu-newpw-hint" className="text-xs text-ink-2">{PASSWORD_RULE_HINT}</p>
    </section>
  );

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

          <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
              {twoColumns ? (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
                  <div data-form-column="profile" className="flex min-w-0 flex-col gap-4">
                    {profileFields}
                    {passwordFields}
                  </div>
                  <div data-form-column="access" className="flex min-w-0 flex-col gap-4">
                    {companiesField}
                    {accessFields}
                    {projectsField}
                  </div>
                </div>
              ) : (
                <>
                  {profileFields}
                  {companiesField}
                  {accessFields}
                  {projectsField}
                  {passwordFields}
                </>
              )}
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              <button type="button" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:flex-none">
                Close
              </button>
              <Button type="submit" shortcut="save" showShortcut loading={saveMut.isPending} className="!min-h-[44px] flex-[2] sm:min-w-[9.5rem] sm:flex-none">
                {saveMut.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
          {/* Reset password's own form: its box and Reset button point here with `form`. */}
          <form id={resetFormId} onSubmit={resetPassword} hidden />
        </div>
      </div>
    </ModalPortal>
  );
}
