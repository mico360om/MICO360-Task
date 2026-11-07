import { randomBytes } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { emailProblem, nameProblem, sameEmail, usernameProblem } from '../../lib/account-rules';
import { hashPassword, verifyPassword } from '../../lib/password';
import { isStrongPassword } from '../../lib/password-policy';
import { WeakPasswordError } from '../auth/errors';
import { assertRoleSet, assertSameKind, isClientRoles } from '../clients/client-kind';
import type { NewUser, TemporaryPasswordMark, UpdateUserData, UserListFilter, UserRepository, UserStatus, UserSummary } from './user-repository';
import { MY_PROJECTS_ONLY_REFUSED } from './user-preferences';

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
  /** Forget the user's phones (push device tokens), so a revoked account stops getting notifications. */
  forgetDevices?: (userId: string) => Promise<void>;
  /** After a user is deleted: remove what only they could see (their MICO AI chats). */
  onDeleted?: (userId: string) => Promise<void>;
  /** After a person's first name, last name or username changed (the task search finds them by it). */
  onRenamed?: (userId: string) => void | Promise<void>;
  /** 1.23: after an account is made inactive, suspended or deleted: forget what it connected (Microsoft Teams). */
  onDeactivated?: (userId: string) => Promise<void>;
  /**
   * Onboarding: an account's email address changed (not just its case). It is set back to not verified
   * already; this tells the old address and records it. Its errors are swallowed: the change stands.
   */
  onEmailChanged?: (userId: string, from: string, to: string, actor: { id: string; ip: string | null } | null) => Promise<void>;
}

/** Onboarding: a duplicate is refused naming the field (and, for an email, whose it is) — 409 DUPLICATE_USER. */
export class DuplicateAccountError extends ConflictError {
  constructor(field: 'email' | 'username', holder: UserSummary) {
    const name = `${holder.firstName} ${holder.lastName}`.trim() || holder.username;
    const client = isClientRoles(holder.roles);
    super(field === 'email' ? `This email address is already used by ${name}${client ? ' (client)' : ''}.` : 'This username is taken.', 'DUPLICATE_USER', {
      field,
      userId: holder.id,
      name,
      kind: client ? 'client' : 'staff',
    });
  }
}

/** Onboarding: a detail that breaks its rule — 400 VALIDATION naming the field (and in fieldErrors). */
export function fieldProblem(field: string, message: string): ValidationError {
  return new ValidationError(message, { field, fieldErrors: { [field]: [message] } });
}

const ADMIN = 'ADMIN';
const DEFAULT_ROLES = ['EMPLOYEE'];

const isActiveAdmin = (u: UserSummary) => u.status === 'ACTIVE' && u.roles.includes(ADMIN);
const sameRoles = (a: string[], b: string[]) => a.length === b.length && a.every((r) => b.includes(r)) && b.every((r) => a.includes(r));

/** How long after a self-service password change the old live sockets are closed (see revokeAccess). */
const OWN_CHANGE_SOCKET_GRACE_MS = 5000;

export function createUserService({ users, revokeSessions, onSessionsRevoked, issueSession, forgetDevices, onDeleted, onRenamed, onDeactivated, onEmailChanged }: UserServiceDeps) {
  /** Refuse an email or username someone else holds (case and spaces don't matter), naming the field. */
  async function assertFree(email: string, username: string, selfId?: string): Promise<void> {
    const clash = await users.findByEmailOrUsername(email.trim(), username.trim());
    if (!clash || clash.id === selfId) return;
    if (sameEmail(clash.email, email)) throw new DuplicateAccountError('email', clash);
    throw new DuplicateAccountError('username', clash);
  }

  /** Never leave the system without an administrator who can sign in. */
  async function ensureAnotherActiveAdmin(id: string): Promise<void> {
    if ((await users.countActiveAdmins(id)) === 0) {
      throw new ConflictError('This is the last active administrator. Make someone else an administrator first.', 'LAST_ADMIN');
    }
  }

  function requireRoles(roleNames: string[] | undefined): string[] {
    const roles = [...new Set((roleNames ?? []).map((r) => r.trim()).filter(Boolean))];
    if (roles.length === 0) throw new ValidationError('At least one role is required.');
    // 1.23: the Client role is never mixed with a staff role.
    assertRoleSet(roles);
    return roles;
  }

  /**
   * Cut every session: stale access tokens (version bump), refresh tokens, live sockets.
   *
   * `socketsAfterMs`: close the live sockets that much later instead of now. Used when the person
   * changes their own password — their page gets a fresh session in the answer, and a socket closed
   * before that answer arrives reconnects with the old, refused session and signs them out. The old
   * tokens are refused at once either way; a socket only receives live updates.
   */
  async function revokeAccess(id: string, socketsAfterMs = 0): Promise<number> {
    const version = await users.bumpTokenVersion(id);
    await revokeSessions?.(id);
    // Their phones stop getting notifications, after changing your own password too: a lost phone
    // shows notifications without the app running. A phone still in use re-registers when signed in.
    try {
      await forgetDevices?.(id);
    } catch {
      // Best effort: the sessions are already revoked.
    }
    const closeSockets = async () => {
      try {
        await onSessionsRevoked?.(id);
      } catch {
        // Closing sockets is best effort; the token checks above already cut access.
      }
    };
    if (socketsAfterMs > 0) {
      const timer = setTimeout(() => void closeSockets(), socketsAfterMs);
      (timer as { unref?: () => void }).unref?.();
    } else {
      await closeSockets();
    }
    return version;
  }

  async function createUser(input: NewUser): Promise<UserSummary> {
    if (input.password !== undefined && !isStrongPassword(input.password)) throw new WeakPasswordError();
    const roleNames = requireRoles(input.roleNames ?? DEFAULT_ROLES);
    await assertFree(input.email, input.username);
    await users.releaseDeletedIdentity(input.email, input.username);
    // No password given (a welcome email lets them set one): a real hash of a secret no one knows, so
    // no password signs in, and a try takes the usual time.
    const passwordHash = await hashPassword(input.password ?? randomBytes(32).toString('base64url'));
    return users.create({
      email: input.email,
      username: input.username,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      departmentId: input.departmentId,
      roleNames,
      ...(input.companyIds !== undefined ? { companyIds: input.companyIds, primaryCompanyId: input.primaryCompanyId ?? null } : {}),
      // 1.23.6: a password given now is a temporary one (only with a password: none means a link).
      ...(input.temporary && input.password !== undefined ? { temporary: input.temporary } : {}),
    });
  }

  async function listUsers(filter?: UserListFilter): Promise<UserSummary[]> {
    return filter ? users.list(filter) : users.list();
  }

  async function getUser(id: string): Promise<UserSummary> {
    const user = await users.findById(id);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  async function updateUser(id: string, patch: UpdateUserData, actor: { id: string; ip: string | null } | null = null): Promise<UserSummary> {
    const current = await getUser(id);
    const next: UpdateUserData = { ...patch };
    if (patch.roleNames !== undefined) {
      next.roleNames = requireRoles(patch.roleNames);
      // 1.23: staff stay staff and clients stay clients (make a new account instead).
      assertSameKind(current.roles, next.roleNames);
      if (isActiveAdmin(current) && !next.roleNames.includes(ADMIN)) await ensureAnotherActiveAdmin(id);
    }
    // 1.22.3 "Show my projects only" (User Management): an administrator's setting — judged by the
    // roles this change leaves them with. Off is always allowed; taken off the Administrator role,
    // it goes off with it (made an administrator again later, they start with every project).
    const willBeAdmin = (next.roleNames ?? current.roles).includes(ADMIN);
    if (patch.myProjectsOnly === true && !willBeAdmin) throw new ForbiddenError(MY_PROJECTS_ONLY_REFUSED);
    if (!willBeAdmin && current.myProjectsOnly === true && patch.myProjectsOnly === undefined) next.myProjectsOnly = false;
    // Guard email/username uniqueness across other users before writing.
    if (patch.email !== undefined || patch.username !== undefined) {
      const email = patch.email ?? current.email;
      const username = patch.username ?? current.username;
      await assertFree(email, username, id);
      await users.releaseDeletedIdentity(email, username);
    }
    // Onboarding: the detail rules bite on what changes only (an older username or name still saves).
    const emailChanged = patch.email !== undefined && !sameEmail(patch.email, current.email);
    if (emailChanged) {
      const problem = emailProblem(patch.email!);
      if (problem) throw fieldProblem('email', problem);
    }
    if (patch.username !== undefined && patch.username.trim() !== current.username) {
      const problem = usernameProblem(patch.username);
      if (problem) throw fieldProblem('username', problem);
    }
    for (const k of ['firstName', 'lastName'] as const) {
      if (patch[k] !== undefined && patch[k]!.trim() !== current[k]) {
        const problem = nameProblem(patch[k]!, k);
        if (problem) throw fieldProblem(k, problem);
      }
    }
    // Onboarding: a new address isn't verified: they confirm it with a code at their next sign-in (their
    // open sessions, the app and the extension keep working until then).
    if (emailChanged) next.emailVerifiedAt = null;
    const updated = await users.update(id, next);
    // A link already sent to the old address (a welcome or reset email) must not set this account's
    // password: a mistyped address could belong to someone else.
    if (emailChanged) {
      await users.endPasswordLinks(id);
      try {
        await onEmailChanged?.(id, current.email, updated.email, actor);
      } catch {
        // Telling the old address is best effort: the change stands.
      }
    }
    // Roles are embedded in access tokens: a real change ends the user's current sessions.
    if (next.roleNames !== undefined && !sameRoles(current.roles, updated.roles)) await revokeAccess(id);
    if (updated.firstName !== current.firstName || updated.lastName !== current.lastName || updated.username !== current.username) await onRenamed?.(id);
    return updated;
  }

  /** Admin-only: overwrite a user's password (also lifts any lockout) and end their sessions. */
  async function adminResetPassword(id: string, newPassword: string, temporary?: TemporaryPasswordMark): Promise<void> {
    if (!isStrongPassword(newPassword)) throw new WeakPasswordError();
    await getUser(id);
    await users.setPassword(id, await hashPassword(newPassword), temporary);
    await revokeAccess(id);
  }

  /**
   * 1.23.6 "Cancel invitation": for someone who has never signed in. Their links stop, an unused
   * temporary password stops, and no way in works (link, Forgot password, emailed code) until a new
   * invitation or a temporary password.
   */
  async function cancelInvitation(id: string, at: Date = new Date()): Promise<UserSummary> {
    const user = await getUser(id);
    if (user.activatedAt || user.lastLoginAt) throw new ConflictError('They have signed in already, so there is no invitation to cancel. Deactivate the account instead.');
    if (user.invitationCancelledAt) return user;
    await users.cancelInvitation(id, at, await hashPassword(randomBytes(32).toString('base64url')));
    await revokeAccess(id);
    return getUser(id);
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
    const tokenVersion = await revokeAccess(id, OWN_CHANGE_SOCKET_GRACE_MS);
    if (!issueSession) return null;
    const user = await getUser(id);
    return issueSession({ id, roles: user.roles, tokenVersion });
  }

  async function setUserStatus(id: string, status: UserStatus): Promise<UserSummary> {
    const current = await getUser(id);
    if (status !== 'ACTIVE' && isActiveAdmin(current)) await ensureAnotherActiveAdmin(id);
    const updated = await users.setStatus(id, status);
    if (status !== 'ACTIVE') {
      // A stopped account's welcome or reset link must not set a password (or work once it's reactivated).
      await users.endPasswordLinks(id);
      await revokeAccess(id);
      await onDeactivated?.(id);
    }
    return updated;
  }

  async function deleteUser(id: string): Promise<void> {
    const current = await getUser(id);
    if (isActiveAdmin(current)) await ensureAnotherActiveAdmin(id);
    await users.softDelete(id);
    await users.endPasswordLinks(id);
    await revokeAccess(id);
    await onDeactivated?.(id);
    await onDeleted?.(id);
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

  return { createUser, listUsers, getUser, updateUser, setUserStatus, deleteUser, unlockUser, setAvatar, adminResetPassword, changeOwnPassword, cancelInvitation };
}

export type UserService = ReturnType<typeof createUserService>;
