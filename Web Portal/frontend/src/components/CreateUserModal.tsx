import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { usersApi, type CreatedUser } from '../api/users';
import { Button } from './ui/Button';
import { FieldLabel, fieldClass } from './ui/Field';
import { useDialog } from '../hooks/useDialog';
import { ApiError } from '../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../lib/passwordPolicy';
import { ModalPortal } from './ui/ModalPortal';

export interface CreateUserModalProps {
  onClose: () => void;
  /** The new account, and whether its welcome email went. */
  onCreated?: (result: CreatedUser) => void;
}

type Role = 'EMPLOYEE' | 'ADMIN';

/** Why the server refused the new account, in words that point at the detail to fix. */
function createFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'WEAK_PASSWORD') return PASSWORD_RULE_ERROR;
    if (e.code === 'EMAIL_NOT_CONFIGURED') {
      return 'Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Turn off “Send a welcome email” and give them a temporary password.';
    }
    if (e.code === 'DUPLICATE_USER' || e.status === 409) return 'That email or username is already in use. Choose a different one.';
    const fields = (e.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors ?? {};
    if (fields.email?.length) return 'Enter a valid email address, like name@company.com.';
    const [field, messages] = Object.entries(fields).find(([, m]) => m?.length) ?? [];
    if (field && messages?.[0]) return `Check the ${FIELD_NAMES[field] ?? field}: ${messages[0]}`;
    if (e.status === 403) return 'You don’t have permission to create accounts.';
  }
  return 'Couldn’t create the account. Please try again.';
}

const FIELD_NAMES: Record<string, string> = { firstName: 'first name', lastName: 'last name', username: 'username', password: 'password', roleNames: 'role' };

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
  const passwordRef = useRef<HTMLInputElement>(null);
  // "Send a welcome email": on unless email isn't set up on this server (then it can't be turned on).
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const emailEnabled = (configQ.data as { emailEnabled?: unknown } | undefined)?.emailEnabled !== false;
  const [welcomeChoice, setWelcomeChoice] = useState(true);
  const sendWelcome = emailEnabled && welcomeChoice;

  const createMut = useMutation({
    mutationFn: () =>
      usersApi(apiClient).create({ firstName, lastName, username, email, ...(password ? { password } : {}), roleNames: [role], sendWelcome }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['directory'] });
      onCreated?.(result);
      onClose();
    },
    onError: (e) => setError(createFailure(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim()) {
      setError('Fill in every field.');
      firstRef.current?.focus();
      return;
    }
    // With a welcome email they set their own password; without one, a temporary password is needed.
    if (!password && !sendWelcome) {
      setError('Enter a temporary password, or turn on “Send a welcome email” so they can set their own.');
      passwordRef.current?.focus();
      return;
    }
    // Same rule as the server (8+ characters with a letter and a number), so it never rejects what we accept.
    if (password && !isStrongPassword(password)) {
      setError(PASSWORD_RULE_ERROR);
      return;
    }
    createMut.mutate();
  }

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New user" className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-md animate-scale-in flex-col overflow-hidden">
          {/* The fields scroll; the buttons stay in view — above a phone's keyboard, too. */}
          <form onSubmit={submit} className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
              <h2 className="mb-1 font-display text-xl font-bold text-ink">New user</h2>
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="nu-first" required>First name</FieldLabel>
                  <input id="nu-first" ref={firstRef} dir="auto" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass(false)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="nu-last" required>Last name</FieldLabel>
                  <input id="nu-last" dir="auto" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass(false)} />
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
              <div className="flex items-start gap-2.5 rounded-lg border border-line bg-ground/60 px-3 py-2.5">
                <input
                  id="nu-welcome"
                  type="checkbox"
                  checked={sendWelcome}
                  disabled={!emailEnabled}
                  onChange={(e) => setWelcomeChoice(e.target.checked)}
                  aria-describedby="nu-welcome-hint"
                  className="mt-0.5 h-4 w-4 flex-none accent-brand disabled:opacity-50"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor="nu-welcome" className={`text-sm font-medium ${emailEnabled ? 'text-ink' : 'text-ink-2'}`}>Send a welcome email</label>
                  <p id="nu-welcome-hint" className="text-xs text-ink-2">
                    {emailEnabled
                      ? 'They get their username and a link to set their own password (it works for 7 days).'
                      : 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password instead.'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="nu-password" required={!sendWelcome}>
                    Temp password{sendWelcome ? <span className="font-normal text-ink-2"> (optional)</span> : null}
                  </FieldLabel>
                  <input
                    id="nu-password"
                    ref={passwordRef}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={fieldClass(false)}
                    autoComplete="new-password"
                    aria-required={!sendWelcome}
                    aria-describedby={sendWelcome ? 'nu-password-hint nu-password-optional' : 'nu-password-hint'}
                  />
                  <p id="nu-password-hint" className="text-xs text-ink-2">{PASSWORD_RULE_HINT}</p>
                  {sendWelcome ? <p id="nu-password-optional" className="text-xs text-ink-2">Or leave it empty: they choose their own with the link.</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="nu-role">Role</FieldLabel>
                  <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20">
                    <option value="EMPLOYEE">Employee</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
              <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50">
                Cancel
              </button>
              <Button type="submit" shortcut="submit" showShortcut loading={createMut.isPending} className="!min-h-[44px] flex-[2]">
                {createMut.isPending ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
