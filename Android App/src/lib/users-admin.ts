/**
 * User Management on the phone (6b), as the website's admin Users page and its New user / Manage
 * account dialogs: the list with the website's role and status names, finding people by name,
 * username or email, a status filter, New user with a temporary password, editing the details,
 * roles and status, unlocking, deleting and setting a new password. The server decides who may do
 * any of it (administrators) and refuses what would break its rules (the last administrator); the
 * app shows those refusals in plain words. Pure TypeScript.
 *
 * Passwords are only passed through to the request: never kept, cached, logged or repeated back.
 */
import { ApiError, isNetworkError } from './api-client';
import { roleLabel } from './auth';
import { PASSWORD_RULE_ERROR, isStrongPassword } from './password-change';
import type { Tone } from './tone';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

/** A person as GET /users gives them to an administrator. */
export interface ApiAdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: UserStatus;
  roles: string[];
  /** Sign-in is locked after too many failed attempts (an administrator can unlock it). */
  locked?: boolean;
}

export const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

const STATUS_LABEL: Record<UserStatus, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended' };
const STATUS_TONE: Record<UserStatus, Tone> = { ACTIVE: 'success', INACTIVE: 'neutral', SUSPENDED: 'danger' };

export const statusLabel = (s: UserStatus): string => STATUS_LABEL[s] ?? s;
export const statusTone = (s: UserStatus): Tone => STATUS_TONE[s] ?? 'neutral';

/** The roles an account can have, with the website's words for each. */
export const ROLE_OPTIONS: readonly { value: 'ADMIN' | 'EMPLOYEE'; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Administrator', hint: 'Full access — manage users, settings and every project.' },
  { value: 'EMPLOYEE', label: 'Employee', hint: 'Works on assigned tasks and projects.' },
];

/** "Administrator, Employee"; a dash for none. */
export function rolesText(roles: readonly string[]): string {
  return roles.length ? roles.map(roleLabel).join(', ') : '—';
}

/** "First Last", else the username. */
export function userFullName(u: Pick<ApiAdminUser, 'firstName' | 'lastName' | 'username'>): string {
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;
}

// ── The list ─────────────────────────────────────────────────────────────────

export type UserFilter = 'ALL' | UserStatus | 'LOCKED';

/** The people matching the words typed (name, username or email) and the filter, in the server's order. */
export function filterUsers(users: readonly ApiAdminUser[], { q, filter }: { q: string; filter: UserFilter }): ApiAdminUser[] {
  const words = q.trim().toLowerCase();
  return users.filter((u) => {
    if (filter === 'LOCKED' ? !u.locked : filter !== 'ALL' && u.status !== filter) return false;
    if (!words) return true;
    return [userFullName(u), u.username, u.email].some((t) => (t ?? '').toLowerCase().includes(words));
  });
}

/** The filter chips with their counts; "Locked" only while someone is locked. */
export function filterOptions(users: readonly ApiAdminUser[]): { value: UserFilter; label: string; count: number; danger?: boolean }[] {
  const out: { value: UserFilter; label: string; count: number; danger?: boolean }[] = [
    { value: 'ALL', label: 'All', count: users.length },
    ...USER_STATUSES.map((s) => ({ value: s as UserFilter, label: statusLabel(s), count: users.filter((u) => u.status === s).length })),
  ];
  const locked = users.filter((u) => u.locked).length;
  if (locked > 0) out.push({ value: 'LOCKED', label: 'Locked', count: locked, danger: true });
  return out;
}

/** The website's note above the list while accounts are locked (null: none). */
export function lockedNote(users: readonly ApiAdminUser[]): string | null {
  const n = users.filter((u) => u.locked).length;
  if (n === 0) return null;
  return `${n} account${n === 1 ? ' is' : 's are'} locked after too many failed sign-in attempts. Unlock ${n === 1 ? 'it' : 'them'} below once you’ve checked it was the account owner.`;
}

/** What TalkBack reads for a person on the list. */
export function userCardLabel(u: ApiAdminUser, isSelf: boolean): string {
  return [userFullName(u), `@${u.username}`, u.email, rolesText(u.roles), statusLabel(u.status), u.locked ? 'sign-in locked' : null, isSelf ? 'you' : null]
    .filter(Boolean)
    .join(', ');
}

/** Why the list didn't load. */
export function usersLoadProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'Only administrators can manage users.';
  if (isNetworkError(error)) return 'You’re offline — the user list needs a connection.';
  return 'Couldn’t load users.';
}

// ── Why a change wasn't made ─────────────────────────────────────────────────

/** The phone knew it was offline, so the change was never sent: nothing changed. */
export class UserChangeNotSent extends Error {
  constructor() {
    super('Not sent: offline.');
    this.name = 'UserChangeNotSent';
  }
}

const OFFLINE = 'You’re offline — changes to accounts need a connection.';
/** Sent, but no answer came back: it may have been made. */
const UNSURE = 'We couldn’t confirm the change. Check your connection, then look at the list to see whether it was made.';

/** The server's own reason for refusing (the website's rule), else the fallback. */
function reason(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.message && error.code !== 'ERROR' && !/^Request failed/.test(error.message)) {
    return error.message;
  }
  return fallback;
}

const FIELD_NAMES: Record<string, string> = { firstName: 'first name', lastName: 'last name', username: 'username', email: 'email', password: 'password', roleNames: 'role' };

/** A field the server found wrong (its validation details), as the website words it. */
function fieldIssue(error: ApiError): { field: string; message: string } | null {
  const fields = (error.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors ?? {};
  if (fields.email?.length) return { field: 'email', message: 'Enter a valid email address, like name@company.com.' };
  const [field, messages] = Object.entries(fields).find(([, m]) => m?.length) ?? [];
  if (field && messages?.[0]) return { field, message: `Check the ${FIELD_NAMES[field] ?? field}: ${messages[0]}` };
  return null;
}

// ── New user ─────────────────────────────────────────────────────────────────

export interface NewUserForm {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  /** The temporary password: sent as typed. */
  password: string;
  role: 'EMPLOYEE' | 'ADMIN';
}

export type NewUserField = 'firstName' | 'lastName' | 'username' | 'email' | 'password';
const NEW_USER_FIELDS: readonly NewUserField[] = ['firstName', 'lastName', 'username', 'email', 'password'];

/** What's wrong before it is sent, and the field to fix (null: send it). The server's own password rule. */
export function checkNewUser(f: NewUserForm): { field: NewUserField; message: string } | null {
  const empty = NEW_USER_FIELDS.find((k) => (k === 'password' ? !f.password : !f[k].trim()));
  if (empty) return { field: empty, message: 'Fill in every field.' };
  if (!isStrongPassword(f.password)) return { field: 'password', message: PASSWORD_RULE_ERROR };
  return null;
}

/** POST /users: the details trimmed (the server trims them too), the password as typed, the one role chosen. */
export function newUserBody(f: NewUserForm) {
  return { firstName: f.firstName.trim(), lastName: f.lastName.trim(), username: f.username.trim(), email: f.email.trim(), password: f.password, roleNames: [f.role] };
}

/** Why the account wasn't created, pointing at the detail to fix. */
export function createUserProblem(error: unknown): { field: NewUserField | null; message: string; unsure?: true } {
  if (error instanceof UserChangeNotSent) return { field: null, message: 'You’re offline — accounts can be created when you’re connected.' };
  // Sent with its own key: the same try again is answered with the first one's result, never a second account.
  if (isNetworkError(error)) return { field: null, message: 'We couldn’t confirm the account was created. Tap Create user again: it won’t be made twice.', unsure: true };
  if (error instanceof ApiError) {
    if (error.code === 'WEAK_PASSWORD') return { field: 'password', message: PASSWORD_RULE_ERROR };
    if (error.code === 'DUPLICATE_USER' || error.status === 409) return { field: 'username', message: 'That email or username is already in use. Choose a different one.' };
    const issue = fieldIssue(error);
    if (issue) return { field: (NEW_USER_FIELDS as readonly string[]).includes(issue.field) ? (issue.field as NewUserField) : null, message: issue.message };
    if (error.status === 403) return { field: null, message: 'You don’t have permission to create accounts.' };
  }
  return { field: null, message: 'Couldn’t create the account. Please try again.' };
}

// ── Edit ─────────────────────────────────────────────────────────────────────

export interface UserEditForm {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: UserStatus;
  roles: string[];
}

export type UserEditField = 'firstName' | 'lastName' | 'username' | 'email';

export function editFormOf(u: ApiAdminUser): UserEditForm {
  return { firstName: u.firstName, lastName: u.lastName, username: u.username, email: u.email, status: u.status, roles: [...u.roles] };
}

/** What's wrong before saving (null: save). Your own roles aren't sent, so they aren't checked. */
export function checkUserEdit(f: UserEditForm, isSelf: boolean): { field: UserEditField | null; message: string } | null {
  const empty = (['firstName', 'lastName', 'username', 'email'] as const).find((k) => !f[k].trim());
  if (empty) return { field: empty, message: 'First name, last name, username and email are all required.' };
  if (!isSelf && f.roles.length === 0) return { field: null, message: 'Give the account at least one role.' };
  return null;
}

/** PUT /users/:id. Your own roles are never sent, so they can't change from here (as on the website). */
export function userPatch(f: UserEditForm, isSelf: boolean) {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    username: f.username.trim(),
    email: f.email.trim(),
    ...(isSelf ? {} : { roleNames: [...f.roles] }),
  };
}

/** Is the form different from the account? */
export function editChanged(u: ApiAdminUser, f: UserEditForm): boolean {
  const a = editFormOf(u);
  return (
    a.firstName !== f.firstName ||
    a.lastName !== f.lastName ||
    a.username !== f.username ||
    a.email !== f.email ||
    a.status !== f.status ||
    a.roles.length !== f.roles.length ||
    a.roles.some((r) => !f.roles.includes(r))
  );
}

/** Why the details weren't saved. */
export function saveProblem(error: unknown): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return UNSURE;
  if (error instanceof ApiError) {
    const issue = fieldIssue(error);
    if (issue) return issue.message;
  }
  return reason(error, 'Couldn’t save. Check the details (email/username may already be in use).');
}

/** The details were saved, then the status change was refused. */
export function statusAfterSaveText(error: unknown): string {
  const why = error instanceof UserChangeNotSent ? OFFLINE : isNetworkError(error) ? UNSURE : reason(error, '');
  return `Profile saved, but the status couldn’t be changed. ${why}`.trim();
}

// ── Status, unlock, delete, password ─────────────────────────────────────────

export function statusChangeProblem(error: unknown): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return UNSURE;
  return reason(error, 'Couldn’t change the account status.');
}

export const unlockDoneText = (u: Pick<ApiAdminUser, 'username'>): string => `${u.username} can sign in again.`;

export function unlockProblem(error: unknown, u: Pick<ApiAdminUser, 'username'>): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return UNSURE;
  return reason(error, `Couldn’t unlock ${u.username}.`);
}

/** A delete answered "not found": already gone (a try again after a lost answer) — it counts as done. */
export function deletedAlready(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function deleteProblem(error: unknown): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return UNSURE;
  return reason(error, 'Couldn’t delete. Try again.');
}

/** The new password breaks the server's rule (null: send it). */
export function checkResetPassword(password: string): string | null {
  return isStrongPassword(password) ? null : PASSWORD_RULE_ERROR;
}

export const RESET_DONE = 'Password reset. Share the new password with the user securely.';

export function resetProblem(error: unknown): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return 'We couldn’t confirm the reset. Check your connection, then reset the password again.';
  return reason(error, `Couldn’t reset the password. ${PASSWORD_RULE_ERROR}`);
}
