import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usersApi } from '../api/users';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { useDialog } from '../hooks/useDialog';

export interface CreateUserModalProps {
  onClose: () => void;
  onCreated?: () => void;
}

type Role = 'EMPLOYEE' | 'ADMIN';

/** Admin dialog to create a new account (name, credentials, role). Used by User Management + Team. */
export function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const createMut = useMutation({
    mutationFn: () =>
      usersApi(apiClient).create({ firstName, lastName, username, email, password, roleNames: [role] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      onCreated?.();
      onClose();
    },
    onError: () => setError('Couldn’t create the account. Check the details (email/username may already be in use).'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || password.length < 6) {
      setError('Fill in every field. Password must be at least 6 characters.');
      firstRef.current?.focus();
      return;
    }
    createMut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New user" className="card relative w-full max-w-md animate-scale-in p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">New user</h2>
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="nu-first" required>First name</FieldLabel>
              <input id="nu-first" ref={firstRef} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="nu-last" required>Last name</FieldLabel>
              <input id="nu-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass(false)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="nu-username" required>Username</FieldLabel>
            <input id="nu-username" value={username} onChange={(e) => setUsername(e.target.value)} className={fieldClass(false)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="nu-email" required>Email</FieldLabel>
            <input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass(false)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="nu-password" required>Temp password</FieldLabel>
              <input id="nu-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass(false)} autoComplete="new-password" />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="nu-role">Role</FieldLabel>
              <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20">
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
          </div>
          <Button type="submit" loading={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create user'}
          </Button>
          <button type="button" onClick={onClose} className="w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
