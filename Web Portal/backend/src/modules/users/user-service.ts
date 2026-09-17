import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import type { NewUser, UpdateUserData, UserRepository, UserStatus, UserSummary } from './user-repository';

export interface UserServiceDeps {
  users: UserRepository;
  /** Revoke every live session for a user — any password change must log out old sessions. */
  revokeSessions?: (userId: string) => Promise<void>;
}

export function createUserService({ users, revokeSessions }: UserServiceDeps) {
  async function createUser(input: NewUser): Promise<UserSummary> {
    const existing = await users.findByEmailOrUsername(input.email, input.username);
    if (existing) throw new ConflictError('A user with this email or username already exists.', 'DUPLICATE_USER');
    const passwordHash = await hashPassword(input.password);
    return users.create({
      email: input.email,
      username: input.username,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      departmentId: input.departmentId,
      roleNames: input.roleNames ?? [],
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
    // Guard email/username uniqueness across other users before writing.
    if (patch.email !== undefined || patch.username !== undefined) {
      const email = patch.email ?? current.email;
      const username = patch.username ?? current.username;
      const clash = await users.findByEmailOrUsername(email, username);
      if (clash && clash.id !== id) {
        throw new ConflictError('A user with this email or username already exists.', 'DUPLICATE_USER');
      }
    }
    return users.update(id, patch);
  }

  /** Admin-only: overwrite a user's password with a freshly hashed value. */
  async function adminResetPassword(id: string, newPassword: string): Promise<void> {
    await getUser(id);
    await users.setPassword(id, await hashPassword(newPassword));
    await revokeSessions?.(id);
  }

  /** Self-service: change your own password after verifying the current one. */
  async function changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const hash = await users.getPasswordHash(id);
    if (!hash) throw new NotFoundError('User not found.');
    if (!(await verifyPassword(currentPassword, hash))) {
      throw new ValidationError('Current password is incorrect.');
    }
    await users.setPassword(id, await hashPassword(newPassword));
    await revokeSessions?.(id);
  }

  async function setUserStatus(id: string, status: UserStatus): Promise<UserSummary> {
    await getUser(id);
    return users.setStatus(id, status);
  }

  async function deleteUser(id: string): Promise<void> {
    await getUser(id);
    await users.softDelete(id);
  }

  async function setAvatar(id: string, avatarUrl: string | null): Promise<UserSummary> {
    await getUser(id);
    return users.setAvatar(id, avatarUrl);
  }

  return { createUser, listUsers, getUser, updateUser, setUserStatus, deleteUser, setAvatar, adminResetPassword, changeOwnPassword };
}

export type UserService = ReturnType<typeof createUserService>;
