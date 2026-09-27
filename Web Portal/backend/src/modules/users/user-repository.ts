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
  roles: string[];
  /** True while a password lockout is in force; it lifts by itself at `lockedUntil`. */
  locked?: boolean;
  lockedUntil?: Date | null;
}

export interface NewUser {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null;
  roleNames?: string[];
}

export interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null;
  roleNames: string[];
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  departmentId?: string | null;
  /** When present, replaces the user's role set with exactly these role names. */
  roleNames?: string[];
}

export interface UserRepository {
  create(data: CreateUserData): Promise<UserSummary>;
  findById(id: string): Promise<UserSummary | null>;
  /** A non-deleted user holding this email or username. */
  findByEmailOrUsername(email: string, username: string): Promise<UserSummary | null>;
  list(): Promise<UserSummary[]>;
  update(id: string, patch: UpdateUserData): Promise<UserSummary>;
  setStatus(id: string, status: UserStatus): Promise<UserSummary>;
  setAvatar(id: string, avatarUrl: string | null): Promise<UserSummary>;
  /**
   * Overwrite the stored password hash (admin reset or self change). Also clears any lockout and
   * invalidates every outstanding password-reset link for the user.
   */
  setPassword(id: string, passwordHash: string): Promise<void>;
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
