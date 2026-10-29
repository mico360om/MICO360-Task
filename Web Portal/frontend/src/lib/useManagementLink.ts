import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { useManagementAccess } from './useManagementAccess';

const keyFor = (userId: string) => `mico360.managementLink.${userId}`;

function remembered(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(keyFor(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Show the Management link in the menu? The server decides (useManagementAccess); until it has
 * answered on this page load, what it said last time on this browser. The link used to appear a
 * moment after every page opened and push the rest of the menu down. Display only: the Management
 * page still waits for the server's own answer.
 */
export function useManagementLink(): boolean {
  const userId = useAuthStore((s) => s.user?.id);
  const { allowed, ready, failed } = useManagementAccess();
  const known = ready && !failed;
  useEffect(() => {
    if (!known || !userId) return;
    try {
      localStorage.setItem(keyFor(userId), allowed ? '1' : '0');
    } catch {
      /* storage unavailable: the link just waits for the answer each time */
    }
  }, [known, allowed, userId]);
  return known ? allowed : remembered(userId);
}
