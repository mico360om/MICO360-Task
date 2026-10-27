/** The warning every "Sign out" shows first when changes are still on this device (see useSignOut). */
export function SignOutWarning({ unsent, onConfirm, onCancel, className = '' }: { unsent: number; onConfirm: () => void; onCancel: () => void; className?: string }) {
  return (
    <div role="alert" className={`rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning ${className}`}>
      <p>
        {unsent} change{unsent === 1 ? '' : 's'} saved on this device {unsent === 1 ? 'hasn’t' : 'haven’t'} been sent yet (made without signal, or waiting to be sent)
        and will be lost if you log out now.
      </p>
      <div className="mt-1.5 flex gap-2">
        <button type="button" onClick={onConfirm} className="min-h-8 rounded-md bg-danger px-2 py-1 font-semibold text-white">
          Log out anyway
        </button>
        <button type="button" onClick={onCancel} className="min-h-8 rounded-md px-2 py-1 font-medium text-ink-2 hover:bg-ground">
          Stay signed in
        </button>
      </div>
    </div>
  );
}
