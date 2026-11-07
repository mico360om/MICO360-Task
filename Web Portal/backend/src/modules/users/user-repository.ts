import type { OnboardingStatus } from './onboarding-status';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface UserSummary {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: UserStatus;
  departmentId: string | null;
  /** Last time the user held a live socket (presence). */
  lastActiveAt?: Date | null;
  /** Last sign-in (password, emailed code or fingerprint); null: never signed in. Admin views only. */
  lastLoginAt?: Date | null;
  /** When an administrator last sent them a welcome email; null: never. Admin views only. */
  welcomeSentAt?: Date | null;
  /** Onboarding: their first invitation (welcome email); null: never invited. Admin views only. */
  invitedAt?: Date | null;
  /** Onboarding: when the account became theirs (first sign-in, or a password set with a link). */
  activatedAt?: Date | null;
  /** Onboarding: when their email address was confirmed; null: not verified. Admin views only. */
  emailVerifiedAt?: Date | null;
  /** Onboarding: their newest invitation link that still works stops then; null: none works. */
  inviteExpiresAt?: Date | null;
  /** Onboarding: Invited / Invite expired / Active / Locked / Deactivated (modules/users/onboarding-status). */
  onboarding?: OnboardingStatus;
  /**
   * 1.23.6: a temporary password still to be changed at the first sign-in; when and by whom it was set
   * (never the value) and when it stops working unused. Admin views only.
   */
  mustChangePassword?: boolean;
  temporaryPasswordSetAt?: Date | null;
  temporaryPasswordSetBy?: { id: string; name: string } | null;
  temporaryPasswordExpiresAt?: Date | null;
  /** 1.23.6: when an administrator cancelled the invitation (null: not cancelled). Admin views only. */
  invitationCancelledAt?: Date | null;
  roles: string[];
  /** True while a password lockout is in force; it lifts by itself at `lockedUntil`. */
  locked?: boolean;
  lockedUntil?: Date | null;
  /** companies: the companies they belong to (A–Z) and their primary company (their emails' branding). */
  companies?: { id: string; name: string; code: string }[];
  primaryCompanyId?: string | null;
  /**
   * "Show my projects only" (1.22, an administrator's setting; off by default): their lists show only
   * the projects they own, manage or are on the team of. Admin views (and their own answers) only.
   */
  myProjectsOnly?: boolean;
}

/**
 * 1.23.6: a temporary password (an administrator gave it): changed at the first sign-in, stops working
 * unused at `expiresAt`. Who set it and when are kept, never the value.
 */
export interface TemporaryPasswordMark {
  at: Date;
  setById: string | null;
  expiresAt: Date;
}

export interface NewUser {
  email: string;
  username: string;
  /** Absent: the account gets an unusable random password until the person sets one (welcome link). */
  password?: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null;
  roleNames?: string[];
  /** companies: the companies they join and their primary company (User Management's rules decide them). */
  companyIds?: string[];
  primaryCompanyId?: string | null;
  /** 1.23.6: `password` is a temporary one (always, from User Management and the client form). */
  temporary?: TemporaryPasswordMark;
}

export interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null;
  roleNames: string[];
  /** companies: written with the person, in the same write. */
  companyIds?: string[];
  primaryCompanyId?: string | null;
  /** 1.23.6: the password is a temporary one. */
  temporary?: TemporaryPasswordMark;
}

/** companies: people in one company, or (`'none'`) people in no company. */
export interface UserListFilter {
  companyId?: string;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  departmentId?: string | null;
  /** When present, replaces the user's role set with exactly these role names. */
  roleNames?: string[];
  /** 1.22.3: "Show my projects only", set from User Management (administrators' only). */
  myProjectsOnly?: boolean;
  /** Onboarding: null when the email changes (they confirm the new one at their next sign-in). */
  emailVerifiedAt?: Date | null;
}

export interface UserRepository {
  create(data: CreateUserData): Promise<UserSummary>;
  findById(id: string): Promise<UserSummary | null>;
  /** A non-deleted user holding this email or username. */
  findByEmailOrUsername(email: string, username: string): Promise<UserSummary | null>;
  list(filter?: UserListFilter): Promise<UserSummary[]>;
  update(id: string, patch: UpdateUserData): Promise<UserSummary>;
  setStatus(id: string, status: UserStatus): Promise<UserSummary>;
  setAvatar(id: string, avatarUrl: string | null): Promise<UserSummary>;
  /**
   * Overwrite the stored password hash (admin reset or self change). Also clears any lockout and
   * invalidates every outstanding password-reset link for the user. 1.23.6: with `temporary` it is a
   * temporary password (changed at the first sign-in; a cancelled invitation ends); without, the
   * person's own (any temporary-password mark is cleared).
   */
  setPassword(id: string, passwordHash: string, temporary?: TemporaryPasswordMark): Promise<void>;
  /**
   * End the person's unused set-password links (welcome and password-reset): their email changed or
   * the account stopped, so a link already sent must not set a password.
   */
  endPasswordLinks(id: string): Promise<void>;
  /**
   * Remember when an administrator last sent the person a welcome email. 1.23.6: a new invitation ends a
   * cancel, and an unused temporary password stops (one way in or the other, never both).
   */
  markWelcomeSent(id: string, at: Date): Promise<void>;
  /**
   * 1.23.6 "Cancel invitation": their unused links end, an unused temporary password stops working
   * (`unusableHash` replaces it) and the cancel is kept, until a new invitation or temporary password.
   */
  cancelInvitation(id: string, at: Date, unusableHash: string): Promise<void>;
  /** Read the stored password hash for verification; null if the user is gone. */
  getPasswordHash(id: string): Promise<string | null>;
  /** Soft delete. Frees the email and username so they can be used for a new account. */
  softDelete(id: string): Promise<void>;
  /** Increment the user's token version (revokes every access token); returns the new version. */
  bumpTokenVersion(id: string): Promise<number>;
  /** Clear the failed-attempt counter and any lock. */
  unlock(id: string): Promise<UserSummary>;
  /** ACTIVE, non-deleted users with the ADMIN role, optionally not counting one user. */
  countActiveAdmins(excludeId?: string): Promise<number>;
  /** Rename soft-deleted accounts that still hold this email or username (deleted before renaming existed). */
  releaseDeletedIdentity(email: string, username: string): Promise<void>;
}
