/**
 * User Management on the phone (6b), as the website's admin Users page and its New user / Manage
 * account dialogs: the list with the website's role and status names, finding people by name,
 * username or email, a status filter (and "Never signed in"), New user with a welcome email or a
 * temporary password, editing the details, roles and status, unlocking, deleting, setting a new
 * password and sending welcome emails (1.13; the sign-in words are lib/user-sign-in). The server decides who may do
 * any of it (administrators) and refuses what would break its rules (the last administrator); the
 * app shows those refusals in plain words. Pure TypeScript.
 *
 * Passwords are only passed through to the request: never kept, cached, logged or repeated back.
 */
import { ApiError, isNetworkError } from './api-client';
import { roleLabel } from './auth';
import { PASSWORD_RULE_ERROR, isStrongPassword } from './password-change';
import type { Tone } from './tone';
import { welcomeBatchSummary, type SignInSort } from './user-sign-in';

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
  /** Last sign-in (password, emailed code or fingerprint); null: never signed in. Admin list only. */
  lastLoginAt?: string | null;
  /** When an administrator last sent them a welcome email; null: never. Admin list only. */
  welcomeSentAt?: string | null;
}

/** What happened for one person's welcome email (the website's api/users.ts). */
export interface WelcomeOutcome {
  userId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  sent: boolean;
  sentAt?: string;
  /** Why it wasn't sent: the server's code (NOT_FOUND, ACCOUNT_SUSPENDED, TOO_SOON, …). */
  reason?: string;
  /** "the account is suspended": finishes "Not sent: …". */
  why?: string;
}

export interface WelcomeBatchResult {
  sent: number;
  notSent: number;
  results: WelcomeOutcome[];
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

export type UserFilter = 'ALL' | UserStatus | 'NEVER' | 'LOCKED';

/** The page's words (the website's PageHeader subtitle). */
export const USERS_SUBTITLE = 'Create and edit accounts, assign roles, control access, reset passwords and send welcome emails.';

/** "Never signed in" with nobody in it. */
export const NEVER_EMPTY = 'Everyone has signed in at least once.';

/** The website's "Sort" choices. */
export const SIGN_IN_SORTS: { value: SignInSort; label: string }[] = [
  { value: 'newest', label: 'Newest accounts first' },
  { value: 'signin-latest', label: 'Last sign-in, latest first' },
  { value: 'signin-earliest', label: 'Last sign-in, earliest first' },
];

const keptBy = (u: ApiAdminUser, filter: UserFilter): boolean => {
  if (filter === 'LOCKED') return !!u.locked;
  if (filter === 'NEVER') return !u.lastLoginAt;
  return filter === 'ALL' || u.status === filter;
};

/** The people matching the words typed (name, username or email) and the filter, in the server's order. */
export function filterUsers(users: readonly ApiAdminUser[], { q, filter }: { q: string; filter: UserFilter }): ApiAdminUser[] {
  const words = q.trim().toLowerCase();
  return users.filter((u) => {
    if (!keptBy(u, filter)) return false;
    if (!words) return true;
    return [userFullName(u), u.username, u.email].some((t) => (t ?? '').toLowerCase().includes(words));
  });
}

/** The filter chips with their counts; "Never signed in" always (as the website's Show); "Locked" only while someone is locked. */
export function filterOptions(users: readonly ApiAdminUser[]): { value: UserFilter; label: string; count: number; danger?: boolean }[] {
  const out: { value: UserFilter; label: string; count: number; danger?: boolean }[] = [
    { value: 'ALL', label: 'All', count: users.length },
    ...USER_STATUSES.map((s) => ({ value: s as UserFilter, label: statusLabel(s), count: users.filter((u) => u.status === s).length })),
    { value: 'NEVER', label: 'Never signed in', count: users.filter((u) => !u.lastLoginAt).length },
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

/**
 * Does User Management show "+ New" (6b review)? For an administrator (the session's roles) at
 * once; for anyone else only once the server gave the list (made an administrator since signing
 * in) — never while it loads, and never after the server's "only administrators".
 */
export function offersNewUser(state: { isAdmin: boolean; listed: boolean; denied: boolean }): boolean {
  return !state.denied && (state.isAdmin || state.listed);
}

// ── Welcome emails (1.13) ────────────────────────────────────────────────────

/** The website's words for welcome emails (UsersPage.tsx). */
export const WELCOME_TEXT = {
  send: 'Send welcome email',
  sendMany: 'Send welcome emails',
  pickNever: 'Select everyone who has never signed in',
  nobody: 'No one to pick: everyone active has signed in, or was sent a welcome email in the last 7 days',
  clear: 'Clear selection',
  tooMany: 'You can send up to 100 welcome emails at a time. Choose fewer people.',
  body: 'Each gets their username and a link to set their password, valid for 7 days. Any password they already have keeps working until they use the link, and an earlier welcome link stops working.',
  emailOff: 'Email isn’t set up on this server, so welcome emails can’t be sent. An administrator needs to add the email (Mailjet) keys.',
  failed: 'Couldn’t send the welcome email. Try again.',
} as const;

/** After one person's send: "Welcome email sent to sara (sara@mico360.com)." */
export function welcomeSentNotice(o: { username: string; email: string }): string {
  return `Welcome email sent to ${o.username} (${o.email}).`;
}

/**
 * How a batch went, as the website says it: "Sent 11. 1 not sent:" and a line for each person not
 * sent one, with why (keyed by person and place: two may read alike); an error when none went.
 */
export function welcomeResultLines(r: WelcomeBatchResult): { summary: string; lines: { key: string; text: string }[]; error: boolean } {
  const lines = r.results
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !x.sent)
    .map(({ x, i }) => ({ key: `${x.userId}-${i}`, text: `${x.username ?? x.name ?? 'Someone'}: ${x.why ?? 'not sent'}` }));
  return { summary: welcomeBatchSummary(r), lines, error: r.sent === 0 && r.notSent > 0 };
}

/** "3 selected". */
export function selectedText(n: number): string {
  return `${n} selected`;
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

/** The server's words for a welcome email it didn't send (refused, too soon, email not set up, not delivered). */
const WELCOME_CODES = new Set(['NOT_FOUND', 'ACCOUNT_INACTIVE', 'ACCOUNT_SUSPENDED', 'ACCOUNT_LOCKED', 'NO_EMAIL', 'EMAIL_BLOCKED', 'TOO_SOON', 'DELIVERY_FAILED', 'SERVER_ERROR', 'EMAIL_NOT_CONFIGURED']);

/** Why a welcome email (or a batch) didn't go: offline (never sent), no answer, the server's reason, or the website's fallback. */
export function welcomeProblem(error: unknown): string {
  if (error instanceof UserChangeNotSent) return OFFLINE;
  if (isNetworkError(error)) return UNSURE;
  if (error instanceof ApiError && WELCOME_CODES.has(error.code ?? '') && error.message) return error.message;
  return reason(error, WELCOME_TEXT.failed);
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
  /** The temporary password: sent as typed (none: they set their own with the welcome email's link). */
  password: string;
  role: 'EMPLOYEE' | 'ADMIN';
  /** Send a welcome email (on unless email isn't set up on the server). */
  sendWelcome: boolean;
}

/** The New user form's welcome email and password words (the website's CreateUserModal). */
export const NEW_USER_TEXT = {
  welcome: 'Send a welcome email',
  welcomeHint: 'They get their username and a link to set their own password (it works for 7 days).',
  welcomeOffHint: 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password instead.',
  password: 'Temp password',
  optional: ' (optional)',
  leaveEmpty: 'Or leave it empty: they choose their own with the link.',
} as const;

/** A new account, and whether its welcome email went (null: none was asked for). */
export interface CreatedUser {
  user: ApiAdminUser;
  welcome: WelcomeOutcome | null;
}

/** What the list says once a new account is made: whether its welcome email went, and why not. */
export function createdNotice({ user, welcome }: CreatedUser): string {
  const whose = user.username ? `${user.username}’s account is ready` : 'The account is ready';
  if (!welcome) return `${whose}.`;
  if (welcome.sent) return `${whose}. Welcome email sent to ${welcome.email ?? user.email}.`;
  return `${whose}, but the welcome email wasn’t sent: ${welcome.why ?? 'it couldn’t be sent'}.`;
}

export type NewUserField = 'firstName' | 'lastName' | 'username' | 'email' | 'password';
const NEW_USER_FIELDS: readonly NewUserField[] = ['firstName', 'lastName', 'username', 'email', 'password'];

/**
 * What's wrong before it is sent, and the field to fix (null: send it), as the website's form: every
 * detail first; then a password, unless a welcome email goes (they set their own with its link —
 * never when email isn't set up on the server); a typed password meets the server's own rule.
 */
export function checkNewUser(f: NewUserForm, o: { emailEnabled: boolean }): { field: NewUserField; message: string } | null {
  const empty = NEW_USER_FIELDS.find((k) => k !== 'password' && !f[k].trim());
  if (empty) return { field: empty, message: 'Fill in every field.' };
  if (!f.password && !(f.sendWelcome && o.emailEnabled)) {
    // Only point at the welcome email when it can be turned on.
    return {
      field: 'password',
      message: o.emailEnabled
        ? 'Enter a temporary password, or turn on “Send a welcome email” so they can set their own.'
        : 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password.',
    };
  }
  if (f.password && !isStrongPassword(f.password)) return { field: 'password', message: PASSWORD_RULE_ERROR };
  return null;
}

/** POST /users: the details trimmed (the server trims them too), the password as typed (none when empty), the one role chosen, and the welcome email. */
export function newUserBody(f: NewUserForm) {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    username: f.username.trim(),
    email: f.email.trim(),
    ...(f.password ? { password: f.password } : {}),
    roleNames: [f.role],
    sendWelcome: f.sendWelcome,
  };
}

/** Why the account wasn't created, pointing at the detail to fix. */
export function createUserProblem(error: unknown): { field: NewUserField | null; message: string; unsure?: true } {
  if (error instanceof UserChangeNotSent) return { field: null, message: 'You’re offline — accounts can be created when you’re connected.' };
  // Sent with its own key: the same try again is answered with the first one's result, never a second account.
  if (isNetworkError(error)) return { field: null, message: 'We couldn’t confirm the account was created. Tap Create user again: it won’t be made twice.', unsure: true };
  if (error instanceof ApiError) {
    // The first try (same key) is still running on the server (6b review): not a refusal — the key
    // is kept, so tapping again gets that try's answer.
    if (error.code === 'IDEMPOTENCY_IN_PROGRESS') {
      return { field: null, message: 'The account is still being created. Wait a moment, then tap Create user again: it won’t be made twice.', unsure: true };
    }
    if (error.code === 'WEAK_PASSWORD') return { field: 'password', message: PASSWORD_RULE_ERROR };
    // The phone thought email was set up (the screen asks the server's settings again).
    if (error.code === 'EMAIL_NOT_CONFIGURED') {
      return { field: 'password', message: 'Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Give them a temporary password.' };
    }
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

// ── Sending the changes ──────────────────────────────────────────────────────

/** The requests (resources.users). */
export interface UserApi {
  create(body: ReturnType<typeof newUserBody>, idempotencyKey: string): Promise<CreatedUser>;
  update(id: string, patch: ReturnType<typeof userPatch>): Promise<ApiAdminUser>;
  setStatus(id: string, status: UserStatus): Promise<ApiAdminUser>;
  remove(id: string): Promise<void>;
  unlock(id: string): Promise<unknown>;
  resetPassword(id: string, password: string): Promise<unknown>;
}

/** The details were saved; then the status change was refused (or got no answer). */
export class StatusAfterSaveError extends Error {
  readonly saved: ApiAdminUser;
  readonly inner: unknown;
  constructor(saved: ApiAdminUser, inner: unknown) {
    super('Saved, but the status was not changed.');
    this.name = 'StatusAfterSaveError';
    this.saved = saved;
    this.inner = inner;
  }
}

/**
 * The changes an administrator makes, as the website sends them: nothing is sent while the phone
 * knows it is offline (they need a connection, as on the website); a new account carries its try's
 * key; Save sends the details, then the status if it changed (never your own); a delete answered
 * "not found" was already done.
 *
 * `api` may be asked for per change (a function): the server as the person signed in when the change
 * is made (lib/owned-write). All of one change's requests — Save's details, then its status — then go
 * as that person only, never with the session of someone who signed in between them.
 */
export function userActions({ api, isOnline }: { api: UserApi | (() => UserApi); isOnline: () => boolean }) {
  const online = () => {
    if (!isOnline()) throw new UserChangeNotSent();
  };
  const now = typeof api === 'function' ? api : () => api;
  return {
    async create(form: NewUserForm, idempotencyKey: string): Promise<CreatedUser> {
      online();
      return now().create(newUserBody(form), idempotencyKey);
    },
    async save(user: ApiAdminUser, form: UserEditForm, isSelf: boolean): Promise<ApiAdminUser> {
      online();
      const as = now();
      const saved = await as.update(user.id, userPatch(form, isSelf));
      if (isSelf || form.status === user.status) return saved;
      try {
        return await as.setStatus(user.id, form.status);
      } catch (e) {
        throw new StatusAfterSaveError(saved, e);
      }
    },
    async setStatus(user: ApiAdminUser, status: UserStatus): Promise<ApiAdminUser> {
      online();
      return now().setStatus(user.id, status);
    },
    async unlock(user: ApiAdminUser): Promise<void> {
      online();
      await now().unlock(user.id);
    },
    async remove(user: ApiAdminUser): Promise<void> {
      online();
      try {
        await now().remove(user.id);
      } catch (e) {
        if (!deletedAlready(e)) throw e;
      }
    },
    async resetPassword(user: ApiAdminUser, password: string): Promise<void> {
      online();
      await now().resetPassword(user.id, password);
    },
  };
}
