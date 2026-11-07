import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth-store';
import { ApiError } from '../../lib/api-client';
import { isStrongPassword, PASSWORD_RULE_ERROR, PASSWORD_RULE_HINT } from '../../lib/passwordPolicy';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { FieldLabel, fieldClass } from '../ui/Field';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { usePortalApi } from './portal-context';
import { TOUCH } from './portal-ui';

/**
 * 1.23 A client changes their own password (POST /users/me/password, as staff do on Profile). The
 * server signs out every other session and returns a fresh pair for this one, which is kept — so
 * this device stays signed in.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const api = usePortalApi();
  const mut = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: (fresh) => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
      const { user } = useAuthStore.getState();
      if (fresh?.accessToken && fresh.refreshToken && user) {
        useAuthStore.getState().setSession({ user, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
        setDone('Password changed. Other devices have been signed out; you’re still signed in here.');
      } else {
        setDone('Password changed. You’ll be asked to sign in again with your new password shortly.');
      }
    },
    onError: (err) => {
      setDone(null);
      setError(
        err instanceof ApiError && err.status === 400 && err.message && !/^Request failed/.test(err.message)
          ? err.message
          : 'Couldn’t change your password. Check that your current password is correct.',
      );
    },
  });
  const busy = mut.isPending;
  const dialogRef = useDialog(busy ? () => {} : onClose);

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    if (!current) return setError('Enter your current password.');
    if (!isStrongPassword(next)) return setError(PASSWORD_RULE_ERROR);
    if (next !== confirm) return setError('The new passwords don’t match.');
    setError(null);
    mut.mutate();
  }

  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}>
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">Change password</h2>
          <p className="mt-1 text-sm text-ink-2">Choose a new password for signing in.</p>
          {error ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          {done ? <p role="status" className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{done}</p> : null}
          <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-current`} required>Current password</FieldLabel>
              <input id={`${id}-current`} type="password" autoComplete="current-password" aria-required="true" value={current} onChange={(e) => setCurrent(e.target.value)} className={fieldClass(false, `${TOUCH} w-full`)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-new`} required>New password</FieldLabel>
              <input id={`${id}-new`} type="password" autoComplete="new-password" aria-required="true" aria-describedby={`${id}-hint`} value={next} onChange={(e) => setNext(e.target.value)} className={fieldClass(false, `${TOUCH} w-full`)} />
              <p id={`${id}-hint`} className="text-xs text-ink-2">{PASSWORD_RULE_HINT}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-confirm`} required>Confirm new password</FieldLabel>
              <input id={`${id}-confirm`} type="password" autoComplete="new-password" aria-required="true" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fieldClass(false, `${TOUCH} w-full`)} />
            </div>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className={TOUCH}>
                {done ? 'Close' : 'Cancel'}
              </Button>
              <Button type="submit" loading={busy} className={TOUCH}>
                {busy ? 'Saving…' : 'Change password'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
