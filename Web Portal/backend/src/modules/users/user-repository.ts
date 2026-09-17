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
  findByEmailOrUsername(email: string, username: string): Promise<UserSummary | null>;
  list(): Promise<UserSummary[]>;
  update(id: string, patch: UpdateUserData): Promise<UserSummary>;
  setStatus(id: string, status: UserStatus): Promise<UserSummary>;
  setAvatar(id: string, avatarUrl: string | null): Promise<UserSummary>;
  /** Overwrite the stored password hash (admin reset or self change). */
  setPassword(id: string, passwordHash: string): Promise<void>;
  /** Read the stored password hash for verification; null if the user is gone. */
  getPasswordHash(id: string): Promise<string | null>;
  softDelete(id: string): Promise<void>;
}
