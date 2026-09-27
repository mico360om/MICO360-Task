import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usersApi, type ApiUser, type UserStatus } from '../api/users';
import { ApiError } from '../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../lib/passwordPolicy';
import { useAuthStore } from '../stores/auth-store';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { useDialog } from '../hooks/useDialog';

export interface EditUserModalProps {
  user: ApiUser;
  onClose: () => void;
}

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

  const [newPassword, setNewPassword] = useState('');
  const [pwNotice, setPwNotice] = useState<{ text: string; error?: boolean } | null>(null);

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

  function resetPassword() {
    setPwNotice(null);
    if (!isStrongPassword(newPassword)) {
      setPwNotice({ text: PASSWORD_RULE_ERROR, error: true });
      return;
    }
    resetPwMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${user.username}`}
        className="card relative max-h-[90vh] w-full max-w-lg animate-scale-in overflow-y-auto p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-2">Manage account</p>
            <h2 dir="auto" className="font-display text-xl font-bold text-ink">{user.firstName} {user.lastName}</h2>
            <p className="text-sm text-ink-2">@{user.username}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2">Profile</legend>
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

          <fieldset className="flex flex-col gap-3" disabled={isSelf} aria-describedby={isSelf ? 'eu-self-note' : undefined}>
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2">Access</legend>
            {isSelf ? (
              <p id="eu-self-note" className="rounded-lg bg-ground px-3 py-2 text-xs text-ink-2">
                You can’t change your own roles or account status. Ask another administrator if they need to change.
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="eu-status">Account status</FieldLabel>
              <select
                id="eu-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Roles &amp; permissions</span>
              {ROLE_OPTIONS.map((r) => (
                <label key={r.value} className={`flex items-start gap-2.5 rounded-lg border border-line p-2.5 transition-colors ${isSelf ? 'opacity-60' : 'cursor-pointer hover:bg-ground'}`}>
                  <input
                    type="checkbox"
                    aria-label={r.label}
                    checked={roles.has(r.value)}
                    onChange={() => toggleRole(r.value)}
                    className="mt-0.5 h-4 w-4 accent-brand"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{r.label}</span>
                    <span className="block text-xs text-ink-2">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button type="submit" loading={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-2">Reset password</p>
          <p className="mb-2 mt-1 text-xs text-ink-2">Set a new password for this user. They can change it after signing in. Resetting also unlocks a locked account.</p>
          {pwNotice ? (
            <p role={pwNotice.error ? 'alert' : 'status'} className={`mb-2 rounded-lg px-3 py-2 text-sm ${pwNotice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
              {pwNotice.text}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <FieldLabel htmlFor="eu-newpw">New password</FieldLabel>
              <input
                id="eu-newpw"
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwNotice(null); }}
                autoComplete="new-password"
                aria-describedby="eu-newpw-hint"
                className={fieldClass(false)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!newPassword || resetPwMut.isPending}
              loading={resetPwMut.isPending}
              onClick={resetPassword}
            >
              Reset
            </Button>
          </div>
          <p id="eu-newpw-hint" className="mt-1 text-xs text-ink-2">{PASSWORD_RULE_HINT}</p>
        </div>

        <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">
          Close
        </button>
      </div>
    </div>
  );
}
