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
    create: (input: NewUserInput) => client.post<{ data: ApiUser }>('/users', input).then((r) => r.data),
    update: (id: string, patch: UserPatch) => client.put<{ data: ApiUser }>(`/users/${id}`, patch).then((r) => r.data),
    setStatus: (id: string, status: UserStatus) => client.patch<{ data: ApiUser }>(`/users/${id}/status`, { status }).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/users/${id}`),
    /** Admin-only: reset another user's password to a new value. */
    resetPassword: (id: string, password: string) => client.post<unknown>(`/users/${id}/password`, { password }),
    /** Self-service: change your own password after supplying the current one. */
    changePassword: (currentPassword: string, newPassword: string) =>
      client.post<unknown>('/users/me/password', { currentPassword, newPassword }),
    /** Upload the signed-in user's profile image (returns the updated user). */
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return client.upload<{ data: ApiUser }>('/users/me/avatar', form).then((r) => r.data);
    },
    removeAvatar: () => client.del<{ data: ApiUser }>('/users/me/avatar').then((r) => r.data),
  };
}
