import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usersApi, type ApiUser, type UserStatus } from '../api/users';
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

/** Admin dialog to edit a user's profile, roles and status, and to reset their password. */
export function EditUserModal({ user, onClose }: EditUserModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));
  const [error, setError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [pwNotice, setPwNotice] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const saveMut = useMutation({
    mutationFn: async () => {
      await usersApi(apiClient).update(user.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        email: email.trim(),
        roleNames: [...roles],
      });
      if (status !== user.status) await usersApi(apiClient).setStatus(user.id, status);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: () => setError('Couldn’t save. Check the details (email/username may already be in use).'),
  });

  const resetPwMut = useMutation({
    mutationFn: () => usersApi(apiClient).resetPassword(user.id, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setPwNotice('Password reset. Share the new password with the user securely.');
    },
    onError: () => setPwNotice('Couldn’t reset the password. It must be at least 6 characters.'),
  });

  function toggleRole(value: string) {
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
    saveMut.mutate();
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
            <h2 className="font-display text-xl font-bold text-ink">{user.firstName} {user.lastName}</h2>
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
                <input id="eu-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass(false)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="eu-last" required>Last name</FieldLabel>
                <input id="eu-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass(false)} />
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

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2">Access</legend>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="eu-status">Account status</FieldLabel>
              <select
                id="eu-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Roles &amp; permissions</span>
              {ROLE_OPTIONS.map((r) => (
                <label key={r.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 transition-colors hover:bg-ground">
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
          <p className="mb-2 mt-1 text-xs text-ink-2">Set a new password for this user. They can change it after signing in.</p>
          {pwNotice ? (
            <p role="status" className={`mb-2 rounded-lg px-3 py-2 text-sm ${resetPwMut.isError ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
              {pwNotice}
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
                placeholder="At least 6 characters"
                className={fieldClass(false)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={newPassword.length < 6 || resetPwMut.isPending}
              loading={resetPwMut.isPending}
              onClick={() => { setPwNotice(null); resetPwMut.mutate(); }}
            >
              Reset
            </Button>
          </div>
        </div>

        <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">
          Close
        </button>
      </div>
    </div>
  );
}
