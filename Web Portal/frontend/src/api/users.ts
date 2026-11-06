import type { ApiClient } from '../lib/api-client';
import type { CompanyPeopleChange } from './companies';
import type { OnboardingStatus } from '../lib/onboarding';

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
  /** Onboarding: their first invitation; null: never invited. Admin list only. */
  invitedAt?: string | null;
  /** Onboarding: when the account became theirs (first sign-in, or a password set with a link). */
  activatedAt?: string | null;
  /** Onboarding: when their email address was confirmed; null: not verified. */
  emailVerifiedAt?: string | null;
  /** Onboarding: their newest invitation link that still works stops then; null: none works. */
  inviteExpiresAt?: string | null;
  /** Onboarding: Invited / Invite expired / Active / Locked / Deactivated (an older server sends none). */
  onboarding?: OnboardingStatus;
  /** Their companies, A–Z (an older server sends none). */
  companies?: UserCompany[];
  /** Their primary company: their emails' logo and name. */
  primaryCompanyId?: string | null;
  /** 1.22.3: an administrator's "Show my projects only" (off by default; an older server sends none). Admin list only. */
  myProjectsOnly?: boolean;
}

/** One of a person's companies, as the user list names it. */
export interface UserCompany {
  id: string;
  name: string;
  code: string;
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
  /** Their companies (absent: the picked company, else the site's only one). */
  companyIds?: string[];
  /** One of `companyIds` (absent: the first). */
  primaryCompanyId?: string | null;
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
  | 'DELIVERY_FAILED'
  | 'SERVER_ERROR';

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
  /** Onboarding: they had been invited before (this one replaced that link). */
  resent?: boolean;
}

/** Onboarding: an administrator's "Send password reset" (a link valid 1 hour). */
export interface PasswordResetSent {
  userId: string;
  email: string | null;
  sent: boolean;
  sentAt?: string;
}

/** Onboarding: an account an email, username or name already belongs to (the forms' duplicate check). */
export interface IdentityMatch {
  id: string;
  name: string;
  username: string;
  kind: 'client' | 'staff';
  organisation: string | null;
  status: UserStatus;
}

export interface IdentityQuery {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  organisation?: string | null;
  client?: boolean;
  /** The account being edited (never a clash with itself). */
  excludeId?: string;
}

export interface IdentityAnswer {
  email: IdentityMatch | null;
  username: IdentityMatch | null;
  sameName: IdentityMatch[];
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
  /** When present, exactly these companies. */
  companyIds?: string[];
  /** One of their companies (null: kept while still theirs, else the oldest one they keep). */
  primaryCompanyId?: string | null;
  /** 1.22.3: an administrator's "Show my projects only" (on is refused for anyone else). */
  myProjectsOnly?: boolean;
}

/** User Management's list: everyone, the people in one company, or those in none. */
export interface UserListFilter {
  companyId?: string | 'none';
}

/** Bulk assign: add these companies to (and take those from) up to 200 people. */
export interface CompanyAssignment {
  userIds: string[];
  addCompanyIds?: string[];
  removeCompanyIds?: string[];
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
  /**
   * companies: true when they share a company with me (administrators: everyone); false for someone
   * known only from a shared project or an old chat — named, but not offered outside projects.
   */
  colleague?: boolean;
}

export function usersApi(client: ApiClient) {
  return {
    list: (filter?: UserListFilter) =>
      client.get<{ data: ApiUser[] }>(filter?.companyId ? `/users?companyId=${encodeURIComponent(filter.companyId)}` : '/users').then((r) => r.data),
    /** Admin-only: several people's companies at once; who couldn't be changed comes back with why. */
    assignCompanies: (input: CompanyAssignment) => client.post<{ data: CompanyPeopleChange }>('/users/companies', input).then((r) => r.data),
    /** Minimal people directory available to any signed-in user (chat names, DM picker). */
    directory: () => client.get<{ data: DirectoryUser[] }>('/users/directory').then((r) => r.data),
    /** "Download my data": everything the system holds about the signed-in person (JSON file). */
    exportMine: () => client.getBlob('/users/me/export'),
    create: (input: NewUserInput): Promise<CreatedUser> =>
      client.post<{ data: ApiUser; meta?: { welcome?: WelcomeOutcome } }>('/users', input).then((r) => ({ user: r.data, welcome: r.meta?.welcome ?? null })),
    /** Admin-only: email one person a welcome (username + "Set your password" link). Refusals are errors with the reason. */
    sendWelcome: (id: string) => client.post<{ data: WelcomeOutcome }>(`/users/${id}/welcome-email`).then((r) => r.data),
    /** Admin-only: welcome emails for several people (up to 100); each one says whether it went. */
    sendWelcomes: (userIds: string[]) => client.post<{ data: WelcomeBatchResult }>('/users/welcome-emails', { userIds }).then((r) => r.data),
    update: (id: string, patch: UserPatch) => client.put<{ data: ApiUser }>(`/users/${id}`, patch).then((r) => r.data),
    /** Onboarding: a deactivation (or reactivation) may say why — audited with it. */
    setStatus: (id: string, status: UserStatus, reason?: string) =>
      client.patch<{ data: ApiUser }>(`/users/${id}/status`, { status, ...(reason?.trim() ? { reason: reason.trim() } : {}) }).then((r) => r.data),
    /** Admin-only: one person, as the list has them. */
    get: (id: string) => client.get<{ data: ApiUser }>(`/users/${encodeURIComponent(id)}`).then((r) => r.data),
    /** Onboarding: email them a reset link valid 1 hour (refusals are errors with the reason). */
    sendPasswordReset: (id: string) => client.post<{ data: PasswordResetSent }>(`/users/${encodeURIComponent(id)}/password-reset-email`).then((r) => r.data),
    /** Onboarding: confirm their email address by hand (a code can't reach them), with why. */
    markEmailVerified: (id: string, reason: string) => client.post<{ data: ApiUser }>(`/users/${encodeURIComponent(id)}/email-verified`, { reason }).then((r) => r.data),
    /** Onboarding: who already has this email, username or name (the forms ask while typing). */
    identityCheck: (q: IdentityQuery) => client.post<{ data: IdentityAnswer }>('/users/identity-check', q).then((r) => r.data),
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
