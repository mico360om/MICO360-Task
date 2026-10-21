import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { userActions, type ApiAdminUser } from '../lib/users-admin';

/** The user list's key; the people directory (chat names, pickers) follows the same changes. */
export const USERS_KEY = ['admin', 'users'] as const;
const DIRECTORY_KEY = ['chat', 'directory'] as const;

/**
 * User Management's list (6b): administrators only — the server refuses anyone else, and the screen
 * says so. Never kept on the phone for an offline start (it holds everyone's email): it needs a
 * connection, as on the website.
 */
export function useUsers() {
  const { resources } = useServices();
  return useQuery({ queryKey: USERS_KEY, queryFn: () => resources.users.list() });
}

/** One person from the list (the form opens from it). */
export function useAdminUser(userId: string | undefined): { user: ApiAdminUser | null; query: ReturnType<typeof useUsers> } {
  const query = useUsers();
  const user = useMemo(() => (userId ? (query.data ?? []).find((u) => u.id === userId) ?? null : null), [query.data, userId]);
  return { user, query };
}

/** The changes an administrator makes (lib/users-admin userActions): sent only when connected. */
export function useUserActions() {
  const { resources, connectivity } = useServices();
  return useMemo(
    () =>
      userActions({
        api: {
          create: (body, key) => resources.users.create(body, key),
          update: (id, patch) => resources.users.update(id, patch),
          setStatus: (id, status) => resources.users.setStatus(id, status),
          remove: (id) => resources.users.remove(id),
          unlock: (id) => resources.users.unlock(id),
          resetPassword: (id, password) => resources.users.resetPassword(id, password),
        },
        isOnline: () => connectivity.isOnline(),
      }),
    [resources, connectivity],
  );
}

/**
 * After a change (made, refused or unanswered): the account as the server returned it goes into the
 * list at once, and the list and the people directory are asked for again.
 */
export function useAfterUserChange() {
  const qc = useQueryClient();
  return useCallback(
    (changed?: ApiAdminUser | { removed: string }) => {
      if (changed) {
        qc.setQueryData<ApiAdminUser[]>(USERS_KEY, (list) => {
          if (!list) return list;
          if ('removed' in changed) return list.filter((u) => u.id !== changed.removed);
          return list.some((u) => u.id === changed.id) ? list.map((u) => (u.id === changed.id ? { ...u, ...changed } : u)) : [changed, ...list];
        });
      }
      void qc.invalidateQueries({ queryKey: USERS_KEY });
      void qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
    },
    [qc],
  );
}
