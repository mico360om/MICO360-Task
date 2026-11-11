import type { ApiClient } from '../lib/api-client';
import type { CompanyPeopleChange } from './companies';
import type { OnboardingStatus } from '../lib/onboarding';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

/** GET /users/me: the signed-in person as the header shows them. */
export interface OwnUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roles: string[];
  avatarUrl: string | null;
}

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
  /**
   * 1.23.6: a temporary password still to be changed at the first sign-in; when and by whom it was set
   * (never the value) and when it stops working unused. Admin views only.
   */
  mustChangePassword?: boolean;
  temporaryPasswordSetAt?: string | null;
  temporaryPasswordSetBy?: { id: string; name: string } | null;
  temporaryPasswordExpiresAt?: string | null;
  /** 1.23.6: when an administrator cancelled the invitation (null: not cancelled). */
  invitationCancelledAt?: string | null;
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

/** 1.23.6: a temporary password made on the server: four words and a number, or 16 characters. */
export type TemporaryPasswordStyle = 'words' | 'characters';

/**
 * 1.23.6: how a new person gets in — one way, never both: an invitation link (`sendWelcome`) or a
 * temporary password made on the server (`generatePassword`, shown once). `inviteDays`: how long
 * either lasts (1, 3, 7 or 14; absent: System Settings').
 */
export interface WayInInput {
  sendWelcome?: boolean;
  generatePassword?: TemporaryPasswordStyle;
  inviteDays?: number;
}

export interface NewUserInput extends WayInInput {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roleNames?: string[];
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
  | 'DAILY_LIMIT'
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
  /** 1.23.6: when the link stops working. */
  expiresAt?: string;
  reason?: WelcomeRefusal;
  /** "the account is suspended": finishes "Not sent: …". */
  why?: string;
}

/** 1.23.6: a temporary password made on the server (shown once) and when it stops working unused. */
export interface TemporaryPasswordMade {
  temporaryPassword: string;
  expiresAt: string;
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
  /** 1.23.6: a temporary password made on the server — in this answer only (show it once). */
  temporaryPassword?: string;
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
      client
        .post<{ data: ApiUser; meta?: { welcome?: WelcomeOutcome; temporaryPassword?: string } }>('/users', input)
        .then((r) => ({ user: r.data, welcome: r.meta?.welcome ?? null, ...(r.meta?.temporaryPassword ? { temporaryPassword: r.meta.temporaryPassword } : {}) })),
    /** Admin-only: email one person a welcome (username + "Set your password" link). Refusals are errors with the reason. 1.23.6: `days` — this link's lifetime. */
    sendWelcome: (id: string, days?: number) => client.post<{ data: WelcomeOutcome }>(`/users/${id}/welcome-email`, days ? { days } : {}).then((r) => r.data),
    /** 1.23.6 "Cancel invitation": the link (and any unused temporary password) stops; no way in until a new one. */
    cancelInvitation: (id: string) => client.post<{ data: ApiUser }>(`/users/${encodeURIComponent(id)}/invitation/cancel`).then((r) => r.data),
    /** 1.23.6: a temporary password made on the server, shown once (they must change it at the first sign-in). */
    makeTemporaryPassword: (id: string, style: TemporaryPasswordStyle, days?: number) =>
      client.post<{ data: TemporaryPasswordMade }>(`/users/${encodeURIComponent(id)}/password`, { generate: style, ...(days ? { days } : {}) }).then((r) => r.data),
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
    /** The signed-in person's own name and current photo (the header reads it on every load). */
    me: () => client.get<{ data: OwnUser }>('/users/me').then((r) => r.data),
  };
}
