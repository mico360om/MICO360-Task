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
  /** Last sign-in (password, emailed code or fingerprint); null: never signed in. Admin list only. */
  lastLoginAt?: string | null;
  /** When an administrator last sent them a welcome email; null: never. Admin list only. */
  welcomeSentAt?: string | null;
}

export interface NewUserInput {
  email: string;
  username: string;
  /** Optional with `sendWelcome` (they set their own with the email's link); required without it. */
  password?: string;
  firstName: string;
  lastName: string;
  roleNames?: string[];
  /** Email them their username and a one-time "Set your password" link (7 days). */
  sendWelcome?: boolean;
}

/** Why a person didn't get a welcome email (the server says it in words too: `why`). */
export type WelcomeRefusal =
  | 'NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'NO_EMAIL'
  | 'EMAIL_BLOCKED'
  | 'TOO_SOON'
  | 'DELIVERY_FAILED';

/** What happened for one person's welcome email. */
export interface WelcomeOutcome {
  userId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  sent: boolean;
  sentAt?: string;
  reason?: WelcomeRefusal;
  /** "the account is suspended": finishes "Not sent: …". */
  why?: string;
}

export interface WelcomeBatchResult {
  sent: number;
  notSent: number;
  results: WelcomeOutcome[];
}

/** A new account, and whether its welcome email went (null: none was asked for). */
export interface CreatedUser {
  user: ApiUser;
  welcome: WelcomeOutcome | null;
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
  /** False for an inactive or suspended account: still named in history, but not offered in pickers. */
  active?: boolean;
}

export function usersApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiUser[] }>('/users').then((r) => r.data),
    /** Minimal people directory available to any signed-in user (chat names, DM picker). */
    directory: () => client.get<{ data: DirectoryUser[] }>('/users/directory').then((r) => r.data),
    /** "Download my data": everything the system holds about the signed-in person (JSON file). */
    exportMine: () => client.getBlob('/users/me/export'),
    create: (input: NewUserInput): Promise<CreatedUser> =>
      client.post<{ data: ApiUser; meta?: { welcome?: WelcomeOutcome } }>('/users', input).then((r) => ({ user: r.data, welcome: r.meta?.welcome ?? null })),
    /** Admin-only: email one person a welcome (username + "Set your password" link). Refusals are errors with the reason. */
    sendWelcome: (id: string) => client.post<{ data: WelcomeOutcome }>(`/users/${id}/welcome-email`).then((r) => r.data),
    /** Admin-only: welcome emails for several people (up to 200); each one says whether it went. */
    sendWelcomes: (userIds: string[]) => client.post<{ data: WelcomeBatchResult }>('/users/welcome-emails', { userIds }).then((r) => r.data),
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
