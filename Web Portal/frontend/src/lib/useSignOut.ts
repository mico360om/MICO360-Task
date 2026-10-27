import { useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { failedChanges, pendingCount } from './offline-replay';
import { inspectionOutbox } from './inspection-sync';

/**
 * Changes saved on this device that haven't reached the server: task changes made offline (waiting or
 * failed) and inspection answers, signatures and follow-up requests. Signing out on purpose throws
 * them away (nothing of a person's may stay behind on a shared device), so every sign-out asks first.
 */
export function unsentChangeCount(userId: string | null | undefined): number {
  const inspections = userId
    ? inspectionOutbox.waiting(userId).reduce((n, w) => n + w.pending.answers + w.pending.followUps + (w.pending.finish ? 1 : 0), 0)
    : 0;
  return pendingCount() + failedChanges().length + inspections;
}

/**
 * Every "Sign out" button: signs out at once when nothing is waiting; otherwise `unsent` says how much
 * would be lost, and `signOut({ force: true })` (the warning's "Log out anyway") signs out after all.
 */
export function useSignOut(): { signOut: (opts?: { force?: boolean; before?: () => void }) => void; unsent: number | null; cancel: () => void } {
  const logout = useAuthStore((s) => s.logout);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [unsent, setUnsent] = useState<number | null>(null);
  const signOut = (opts: { force?: boolean; before?: () => void } = {}) => {
    const waiting = unsentChangeCount(userId);
    if (waiting > 0 && !opts.force) {
      setUnsent(waiting);
      return;
    }
    setUnsent(null);
    opts.before?.();
    logout('user');
  };
  return { signOut, unsent, cancel: () => setUnsent(null) };
}
