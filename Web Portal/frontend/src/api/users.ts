import type { ApiClient } from '../lib/api-client';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface ApiUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: UserStatus;
  roles: string[];
  /** True while sign-in is locked after too many failed attempts (admins can unlock it). */
  locked?: boolean;
}

export interface NewUserInput {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  roleNames?: string[];
}

export interface UserPatch {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  /** When present, replaces the user's roles with exactly these role names. */
  roleNames?: string[];
}

export interface DirectoryUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** Last time the user held a live socket (presence: last active / delivered). */
  lastActiveAt?: string | null;
}

export function usersApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiUser[] }>('/users').then((r) => r.data),
    /** Minimal people directory available to any signed-in user (chat names, DM picker). */
    directory: () => client.get<{ data: DirectoryUser[] }>('/users/directory').then((r) => r.data),
    /** "Download my data": everything the system holds about the signed-in person (JSON file). */
    exportMine: () => client.getBlob('/users/me/export'),
    create: (input: NewUserInput) => client.post<{ data: ApiUser }>('/users', input).then((r) => r.data),
    update: (id: string, patch: UserPatch) => client.put<{ data: ApiUser }>(`/users/${id}`, patch).then((r) => r.data),
    setStatus: (id: string, status: UserStatus) => client.patch<{ data: ApiUser }>(`/users/${id}/status`, { status }).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/users/${id}`),
    /** Admin-only: clear a sign-in lock left by too many failed password attempts (audited server-side). */
    unlock: (id: string) => client.post<{ data?: ApiUser }>(`/users/${id}/unlock`),
    /** Admin-only: reset another user's password to a new value. */
    resetPassword: (id: string, password: string) => client.post<unknown>(`/users/${id}/password`, { password }),
    /**
     * Self-service: change your own password after supplying the current one. The server signs out
     * every other session and returns a fresh token pair for this one (store it, or the next
     * refresh fails and the user is logged out).
     */
    changePassword: (currentPassword: string, newPassword: string) =>
      client
        .post<{ data?: { accessToken?: string; refreshToken?: string } } | undefined>('/users/me/password', { currentPassword, newPassword })
        .then((r) => r?.data ?? null),
    /** Upload the signed-in user's profile image (returns the updated user). */
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return client.upload<{ data: ApiUser }>('/users/me/avatar', form).then((r) => r.data);
    },
    removeAvatar: () => client.del<{ data: ApiUser }>('/users/me/avatar').then((r) => r.data),
  };
}
