import { useId, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { UserStatus } from '../../api/users';

/** Onboarding: what a status change does, said before it is done (one place for both lists). */
export function statusChangeWords(name: string, to: UserStatus, opts: { neverSignedIn?: boolean } = {}): { title: string; confirm: string; body: string[] } {
  if (to === 'ACTIVE') {
    return {
      title: `Reactivate ${name}?`,
      confirm: 'Reactivate',
      body: [
        'They can sign in again with their password.',
        ...(opts.neverSignedIn ? ['Nothing is emailed by itself: use Resend invitation if they still need to set a password.'] : []),
      ],
    };
  }
  const verb = to === 'SUSPENDED' ? 'Suspend' : 'Deactivate';
  return {
    title: `${verb} ${name}?`,
    confirm: verb,
    body: [
      'They’re signed out everywhere at once — the website, the Android app and the extension — and can’t sign in until they’re reactivated.',
      'Their tasks, comments and history stay. Invitation and reset links already sent stop working.',
    ],
  };
}

export interface AccountStatusDialogProps {
  name: string;
  to: UserStatus;
  neverSignedIn?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** "Deactivate Sara Ahmed?" — what happens, an optional reason (kept in the audit log), and the button. */
export function AccountStatusDialog({ name, to, neverSignedIn, busy, error, onConfirm, onClose }: AccountStatusDialogProps) {
  const [reason, setReason] = useState('');
  const id = useId();
  const words = statusChangeWords(name, to, { neverSignedIn });
  return (
    <ConfirmDialog
      title={words.title}
      confirmLabel={words.confirm}
      keepLabel="Cancel"
      tone={to === 'ACTIVE' ? 'primary' : 'danger'}
      busy={busy}
      error={error}
      onConfirm={() => onConfirm(reason.trim())}
      onClose={onClose}
    >
      {words.body.map((line) => (
        <p key={line} className="mb-2">{line}</p>
      ))}
      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium text-ink">
          Reason<span className="font-normal text-ink-2"> (optional)</span>
        </label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          maxLength={300}
          rows={2}
          aria-describedby={`${id}-hint`}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <p id={`${id}-hint`} className="text-xs text-ink-2">Kept in the audit log with the change.</p>
      </div>
    </ConfirmDialog>
  );
}
