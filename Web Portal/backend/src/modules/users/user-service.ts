import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { isStrongPassword } from '../../lib/password-policy';
import { WeakPasswordError } from '../auth/errors';
import type { NewUser, UpdateUserData, UserRepository, UserStatus, UserSummary } from './user-repository';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserServiceDeps {
  users: UserRepository;
  /** Revoke every live session for a user — any password change must log out old sessions. */
  revokeSessions?: (userId: string) => Promise<void>;
  /**
   * Called after a user's access is cut (suspend / deactivate, delete, role change, password
   * change) so live connections can be closed too (the realtime server disconnects their sockets).
   */
  onSessionsRevoked?: (userId: string) => void | Promise<void>;
  /** Issue a fresh session (access + refresh token) — used to keep the caller signed in after a self password change. */
  issueSession?: (user: { id: string; roles: string[]; tokenVersion: number }) => Promise<SessionTokens>;
}

const ADMIN = 'ADMIN';
const DEFAULT_ROLES = ['EMPLOYEE'];

const isActiveAdmin = (u: UserSummary) => u.status === 'ACTIVE' && u.roles.includes(ADMIN);
const sameRoles = (a: string[], b: string[]) => a.length === b.length && a.every((r) => b.includes(r)) && b.every((r) => a.includes(r));

export function createUserService({ users, revokeSessions, onSessionsRevoked, issueSession }: UserServiceDeps) {
  /** Never leave the system without an administrator who can sign in. */
  async function ensureAnotherActiveAdmin(id: string): Promise<void> {
    if ((await users.countActiveAdmins(id)) === 0) {
      throw new ConflictError('This is the last active administrator. Make someone else an administrator first.', 'LAST_ADMIN');
    }
  }

  function requireRoles(roleNames: string[] | undefined): string[] {
    const roles = [...new Set((roleNames ?? []).map((r) => r.trim()).filter(Boolean))];
    if (roles.length === 0) throw new ValidationError('At least one role is required.');
    return roles;
  }

  /** Cut every session: stale access tokens (version bump), refresh tokens, live sockets. */
  async function revokeAccess(id: string): Promise<number> {
    const version = await users.bumpTokenVersion(id);
    await revokeSessions?.(id);
    try {
      await onSessionsRevoked?.(id);
    } catch {
      // Closing sockets is best effort; the token checks above already cut access.
    }
    return version;
  }

  async function createUser(input: NewUser): Promise<UserSummary> {
    if (!isStrongPassword(input.password)) throw new WeakPasswordError();
    const roleNames = requireRoles(input.roleNames ?? DEFAULT_ROLES);
    const existing = await users.findByEmailOrUsername(input.email, input.username);
    if (existing) throw new ConflictError('A user with this email or username already exists.', 'DUPLICATE_USER');
    await users.releaseDeletedIdentity(input.email, input.username);
    const passwordHash = await hashPassword(input.password);
    return users.create({
      email: input.email,
      username: input.username,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      departmentId: input.departmentId,
      roleNames,
    });
  }

  async function listUsers(): Promise<UserSummary[]> {
    return users.list();
  }

  async function getUser(id: string): Promise<UserSummary> {
    const user = await users.findById(id);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  async function updateUser(id: string, patch: UpdateUserData): Promise<UserSummary> {
    const current = await getUser(id);
    const next: UpdateUserData = { ...patch };
    if (patch.roleNames !== undefined) {
      next.roleNames = requireRoles(patch.roleNames);
      if (isActiveAdmin(current) && !next.roleNames.includes(ADMIN)) await ensureAnotherActiveAdmin(id);
    }
    // Guard email/username uniqueness across other users before writing.
    if (patch.email !== undefined || patch.username !== undefined) {
      const email = patch.email ?? current.email;
      const username = patch.username ?? current.username;
      const clash = await users.findByEmailOrUsername(email, username);
      if (clash && clash.id !== id) {
        throw new ConflictError('A user with this email or username already exists.', 'DUPLICATE_USER');
      }
      await users.releaseDeletedIdentity(email, username);
    }
    const updated = await users.update(id, next);
    // Roles are embedded in access tokens: a real change ends the user's current sessions.
    if (next.roleNames !== undefined && !sameRoles(current.roles, updated.roles)) await revokeAccess(id);
    return updated;
  }

  /** Admin-only: overwrite a user's password (also lifts any lockout) and end their sessions. */
  async function adminResetPassword(id: string, newPassword: string): Promise<void> {
    if (!isStrongPassword(newPassword)) throw new WeakPasswordError();
    await getUser(id);
    await users.setPassword(id, await hashPassword(newPassword));
    await revokeAccess(id);
  }

  /**
   * Self-service: change your own password after verifying the current one. Every existing
   * session (including this one) is ended, and a fresh session is returned for the caller.
   */
  async function changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<SessionTokens | null> {
    const hash = await users.getPasswordHash(id);
    if (!hash) throw new NotFoundError('User not found.');
    if (!(await verifyPassword(currentPassword, hash))) {
      throw new ValidationError('Current password is incorrect.');
    }
    if (!isStrongPassword(newPassword)) throw new WeakPasswordError();
    await users.setPassword(id, await hashPassword(newPassword));
    const tokenVersion = await revokeAccess(id);
    if (!issueSession) return null;
    const user = await getUser(id);
    return issueSession({ id, roles: user.roles, tokenVersion });
  }

  async function setUserStatus(id: string, status: UserStatus): Promise<UserSummary> {
    const current = await getUser(id);
    if (status !== 'ACTIVE' && isActiveAdmin(current)) await ensureAnotherActiveAdmin(id);
    const updated = await users.setStatus(id, status);
    if (status !== 'ACTIVE') await revokeAccess(id);
    return updated;
  }

  async function deleteUser(id: string): Promise<void> {
    const current = await getUser(id);
    if (isActiveAdmin(current)) await ensureAnotherActiveAdmin(id);
    await users.softDelete(id);
    await revokeAccess(id);
  }

  /** Admin-only: lift a password lockout early. */
  async function unlockUser(id: string): Promise<UserSummary> {
    await getUser(id);
    return users.unlock(id);
  }

  async function setAvatar(id: string, avatarUrl: string | null): Promise<UserSummary> {
    await getUser(id);
    return users.setAvatar(id, avatarUrl);
  }

  return { createUser, listUsers, getUser, updateUser, setUserStatus, deleteUser, unlockUser, setAvatar, adminResetPassword, changeOwnPassword };
}

export type UserService = ReturnType<typeof createUserService>;
