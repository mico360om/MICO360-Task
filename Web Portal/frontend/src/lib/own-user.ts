import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { usersApi } from '../api/users';
import { useAuthStore, type AuthUser } from '../stores/auth-store';

/**
 * The signed-in person as the header shows them (11 Nov): their own name and current photo. The copy
 * saved at sign-in is refreshed on every load (GET /users/me) and the moment they change their photo, so
 * a photo or a name changed elsewhere — another device, User Management — shows without signing in again.
 */
export const ME_KEY = ['me'] as const;

/** Their first and last name, else the username ('' when nobody is signed in). */
export function ownName(user: Pick<AuthUser, 'username' | 'firstName' | 'lastName'> | null | undefined): string {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;
}

/** Take these newer details of the signed-in person (only theirs), keeping the rest and the session. */
export function updateOwnUser(patch: Partial<AuthUser> & { id: string }): void {
  const { user, accessToken, refreshToken, setSession } = useAuthStore.getState();
  if (!user || user.id !== patch.id || !accessToken || !refreshToken) return;
  const next = { ...user, ...patch };
  if (JSON.stringify(next) === JSON.stringify(user)) return;
  setSession({ user: next, accessToken, refreshToken });
}

/** On every load: read GET /users/me and take their current name and photo. */
export function useOwnUserRefresh(): void {
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const q = useQuery({ queryKey: ME_KEY, queryFn: () => usersApi(apiClient).me(), enabled: signedIn, staleTime: 60_000 });
  useEffect(() => {
    const d = q.data;
    if (!d || typeof d.id !== 'string' || typeof d.username !== 'string') return;
    updateOwnUser({ id: d.id, email: d.email, username: d.username, firstName: d.firstName ?? '', lastName: d.lastName ?? '', avatarUrl: d.avatarUrl ?? null });
  }, [q.data]);
}
