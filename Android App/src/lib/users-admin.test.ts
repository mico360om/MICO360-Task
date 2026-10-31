import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import {
  ROLE_OPTIONS,
  USER_STATUSES,
  RESET_DONE,
  UserChangeNotSent,
  checkNewUser,
  checkResetPassword,
  checkUserEdit,
  createUserProblem,
  editFormOf,
  filterOptions,
  filterUsers,
  lockedNote,
  newUserBody,
  rolesText,
  saveProblem,
  statusAfterSaveText,
  statusChangeProblem,
  statusLabel,
  statusTone,
  unlockDoneText,
  unlockProblem,
  deleteProblem,
  deletedAlready,
  resetProblem,
  userCardLabel,
  userFullName,
  userPatch,
  usersLoadProblem,
  userActions,
  offersNewUser,
  StatusAfterSaveError,
  NEVER_EMPTY,
  NEW_USER_TEXT,
  SIGN_IN_SORTS,
  USERS_SUBTITLE,
  WELCOME_TEXT,
  createdNotice,
  selectedText,
  welcomeResultLines,
  welcomeProblem,
  welcomeSentNotice,
  type UserApi,
  type ApiAdminUser,
  type WelcomeOutcome,
} from './users-admin';
import { PASSWORD_RULE_ERROR } from './password-change';

// 6b review: "+ New" showed to someone who isn't an administrator while the list loaded (until the
// server's "only administrators" came back).
describe('“+ New” on User Management', () => {
  it('shows for an administrator at once, and for anyone else only once the server gave the list', () => {
    expect(offersNewUser({ isAdmin: true, listed: false, denied: false })).toBe(true); // loading
    expect(offersNewUser({ isAdmin: false, listed: false, denied: false })).toBe(false); // loading
    expect(offersNewUser({ isAdmin: false, listed: true, denied: false })).toBe(true); // made an administrator since signing in
  });
  it('never after the server’s “only administrators”', () => {
    expect(offersNewUser({ isAdmin: false, listed: false, denied: true })).toBe(false);
    expect(offersNewUser({ isAdmin: true, listed: false, denied: true })).toBe(false); // no longer one
  });
  it('the screen asks this rule, with the session’s roles and the list’s answer', () => {
    const screen = readFileSync(resolve(__dirname, '../screens/UsersScreen.tsx'), 'utf8');
    expect(screen).toMatch(/offersNewUser\(\{ isAdmin, listed: usersQ\.isSuccess, denied \}\)/);
    expect(screen).toMatch(/headerRight: showNew/);
  });
});

// 6b review: the temporary and reset passwords are someone else's — the phone's password manager
// must not offer to save them as the administrator's own.
describe('passwords set for someone else', () => {
  it('the temporary and the reset password are never offered to the password manager', () => {
    const form = readFileSync(resolve(__dirname, '../screens/UserFormScreen.tsx'), 'utf8');
    const fields = form.split('<TextField').filter((f) => /secureTextEntry/.test(f.split('/>')[0]!)).map((f) => f.split('/>')[0]!);
    expect(fields).toHaveLength(2);
    for (const f of fields) {
      expect(f).toMatch(/importantForAutofill="no"/);
      expect(f).toMatch(/autoComplete="off"/);
      expect(f).not.toMatch(/password-new|newPassword/);
    }
  });
});

const user = (over: Partial<ApiAdminUser> = {}): ApiAdminUser => ({
  id: 'u1',
  email: 'omar@mico360.com',
  username: 'omar',
  firstName: 'Omar',
  lastName: 'Ahmed',
  avatarUrl: null,
  status: 'ACTIVE',
  roles: ['EMPLOYEE'],
  ...over,
});

const refused = (status: number, code: string, message: string, details?: unknown) => new ApiError(status, code, message, details);

describe('the user list, as the website’s User Management', () => {
  const people = [
    user(),
    user({ id: 'u2', username: 'mariam', firstName: 'Mariam', lastName: 'Al Balushi', email: 'mariam@mico360.com', roles: ['ADMIN', 'EMPLOYEE'] }),
    user({ id: 'u3', username: 'layla', firstName: 'ليلى', lastName: 'Saeed', email: 'layla@x.org', status: 'INACTIVE' }),
    user({ id: 'u4', username: 'sami', firstName: 'Sami', lastName: '', email: 'sami@x.org', status: 'SUSPENDED', locked: true }),
  ];

  it('names roles and statuses in the website’s words', () => {
    expect(rolesText(['ADMIN', 'EMPLOYEE'])).toBe('Administrator, Employee');
    expect(rolesText(['EMPLOYEE'])).toBe('Employee');
    expect(rolesText([])).toBe('—');
    expect(USER_STATUSES.map((s) => statusLabel(s))).toEqual(['Active', 'Inactive', 'Suspended']);
    expect([statusTone('ACTIVE'), statusTone('INACTIVE'), statusTone('SUSPENDED')]).toEqual(['success', 'neutral', 'danger']);
    expect(ROLE_OPTIONS.map((r) => r.label)).toEqual(['Administrator', 'Employee']);
  });

  it('finds people by name, username or email, in any script and any case', () => {
    expect(filterUsers(people, { q: 'MARI', filter: 'ALL' }).map((u) => u.id)).toEqual(['u2']);
    expect(filterUsers(people, { q: 'mar', filter: 'ALL' }).map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(filterUsers(people, { q: 'x.org', filter: 'ALL' }).map((u) => u.id)).toEqual(['u3', 'u4']);
    expect(filterUsers(people, { q: 'ليلى', filter: 'ALL' }).map((u) => u.id)).toEqual(['u3']);
    expect(filterUsers(people, { q: 'omar ahmed', filter: 'ALL' }).map((u) => u.id)).toEqual(['u1']);
    expect(filterUsers(people, { q: '  ', filter: 'ALL' })).toHaveLength(4);
  });

  it('filters by status, and by a locked sign-in, keeping the server’s order', () => {
    expect(filterUsers(people, { q: '', filter: 'ACTIVE' }).map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(filterUsers(people, { q: '', filter: 'SUSPENDED' }).map((u) => u.id)).toEqual(['u4']);
    expect(filterUsers(people, { q: '', filter: 'LOCKED' }).map((u) => u.id)).toEqual(['u4']);
    expect(filterUsers(people, { q: 'sami', filter: 'ACTIVE' })).toEqual([]);
  });

  it('offers the filters with their counts; Locked only when someone is locked', () => {
    expect(filterOptions(people)).toEqual([
      { value: 'ALL', label: 'All', count: 4 },
      { value: 'ACTIVE', label: 'Active', count: 2 },
      { value: 'INACTIVE', label: 'Inactive', count: 1 },
      { value: 'SUSPENDED', label: 'Suspended', count: 1 },
      { value: 'NEVER', label: 'Never signed in', count: 4 },
      { value: 'LOCKED', label: 'Locked', count: 1, danger: true },
    ]);
    expect(filterOptions(people.slice(0, 2)).map((o) => o.value)).toEqual(['ALL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'NEVER']);
  });

  it('says how many accounts are locked, as the website does', () => {
    expect(lockedNote(people.slice(0, 2))).toBeNull();
    expect(lockedNote(people)).toBe('1 account is locked after too many failed sign-in attempts. Unlock it below once you’ve checked it was the account owner.');
    expect(lockedNote([...people, user({ id: 'u5', locked: true })])).toBe(
      '2 accounts are locked after too many failed sign-in attempts. Unlock them below once you’ve checked it was the account owner.',
    );
  });

  it('reads each person to TalkBack in one line', () => {
    expect(userFullName(people[3]!)).toBe('Sami');
    expect(userFullName(user({ firstName: '', lastName: '' }))).toBe('omar');
    expect(userCardLabel(people[0]!, false)).toBe('Omar Ahmed, @omar, omar@mico360.com, Employee, Active');
    expect(userCardLabel(people[3]!, false)).toBe('Sami, @sami, sami@x.org, Employee, Suspended, sign-in locked');
    expect(userCardLabel(people[1]!, true)).toBe('Mariam Al Balushi, @mariam, mariam@mico360.com, Administrator, Employee, Active, you');
  });

  it('says why the list didn’t load: not an administrator, offline, or anything else', () => {
    expect(usersLoadProblem(refused(403, 'FORBIDDEN', 'You do not have permission to do that.'))).toBe('Only administrators can manage users.');
    expect(usersLoadProblem(new NetworkError('Network request failed.'))).toBe('You’re offline — the user list needs a connection.');
    expect(usersLoadProblem(refused(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t load users.');
  });
});

describe('New user, as the website’s dialog', () => {
  const form = { firstName: 'Aisha', lastName: 'Khan', username: 'aisha', email: 'aisha@mico360.com', password: 'Temp1234', role: 'EMPLOYEE' as const, sendWelcome: false };
  const email = { emailEnabled: true };

  it('wants every field, then the password rule, and names the field to fix', () => {
    expect(checkNewUser(form, email)).toBeNull();
    expect(checkNewUser({ ...form, firstName: ' ' }, email)).toEqual({ field: 'firstName', message: 'Fill in every field.' });
    expect(checkNewUser({ ...form, email: '' }, email)).toEqual({ field: 'email', message: 'Fill in every field.' });
    expect(checkNewUser({ ...form, password: 'abcdefgh' }, email)).toEqual({ field: 'password', message: 'Use at least 8 characters, including a letter and a number.' });
    expect(checkNewUser({ ...form, password: 'a1' }, email)).toEqual({ field: 'password', message: 'Use at least 8 characters, including a letter and a number.' });
  });

  it('a temporary password is optional only when a welcome email can go', () => {
    expect(checkNewUser({ ...form, password: '', sendWelcome: true }, { emailEnabled: true })).toBeNull();
    expect(checkNewUser({ ...form, password: '', sendWelcome: false }, { emailEnabled: true })).toEqual({ field: 'password', message: 'Enter a temporary password, or turn on “Send a welcome email” so they can set their own.' });
    expect(checkNewUser({ ...form, password: '', sendWelcome: true }, { emailEnabled: false })).toEqual({ field: 'password', message: 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password.' });
    expect(checkNewUser({ ...form, password: 'short', sendWelcome: true }, { emailEnabled: true })?.message).toBe(PASSWORD_RULE_ERROR);
    // Every other field still first.
    expect(checkNewUser({ ...form, username: '', password: '' }, { emailEnabled: true })).toEqual({ field: 'username', message: 'Fill in every field.' });
  });

  it('sends the one role chosen, the names trimmed, the password exactly as typed (or none), and whether to send a welcome email', () => {
    expect(newUserBody({ ...form, firstName: ' Aisha ', password: ' Temp 1234 ', role: 'ADMIN' })).toEqual({
      firstName: 'Aisha',
      lastName: 'Khan',
      username: 'aisha',
      email: 'aisha@mico360.com',
      password: ' Temp 1234 ',
      roleNames: ['ADMIN'],
      sendWelcome: false,
    });
    expect(newUserBody({ ...form, password: '', sendWelcome: true })).not.toHaveProperty('password');
    expect(newUserBody({ ...form, password: '', sendWelcome: true }).sendWelcome).toBe(true);
    expect(newUserBody({ ...form, password: 'Temp-1234', sendWelcome: false })).toMatchObject({ password: 'Temp-1234', sendWelcome: false });
  });

  it('the account-ready notice says what happened to the welcome email', () => {
    const made = { username: 'sara', email: 'sara@mico360.com' } as ApiAdminUser;
    expect(createdNotice({ user: made, welcome: null })).toBe('sara’s account is ready.');
    expect(createdNotice({ user: made, welcome: { sent: true } as WelcomeOutcome })).toBe('sara’s account is ready. Welcome email sent to sara@mico360.com.');
    expect(createdNotice({ user: made, welcome: { sent: true, email: 'sara.ali@mico360.com' } as WelcomeOutcome })).toBe('sara’s account is ready. Welcome email sent to sara.ali@mico360.com.');
    expect(createdNotice({ user: made, welcome: { sent: false, why: 'the address bounced' } as WelcomeOutcome })).toBe('sara’s account is ready, but the welcome email wasn’t sent: the address bounced.');
    expect(createdNotice({ user: made, welcome: { sent: false } as WelcomeOutcome })).toBe('sara’s account is ready, but the welcome email wasn’t sent: it couldn’t be sent.');
  });

  it('email not set up on the server: the account wasn’t made, and the password is what to fill in', () => {
    expect(createUserProblem(refused(503, 'EMAIL_NOT_CONFIGURED', 'Email isn’t set up on this server yet…'))).toEqual({
      field: 'password',
      message: 'Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Give them a temporary password.',
    });
  });

  it('puts the server’s refusal in words that point at the detail to fix', () => {
    expect(createUserProblem(refused(400, 'WEAK_PASSWORD', 'Password must be…'))).toEqual({ field: 'password', message: 'Use at least 8 characters, including a letter and a number.' });
    expect(createUserProblem(refused(409, 'DUPLICATE_USER', 'A user with this email or username already exists.'))).toEqual({
      field: 'username',
      message: 'That email or username is already in use. Choose a different one.',
    });
    expect(createUserProblem(refused(400, 'VALIDATION', 'Invalid input.', { fieldErrors: { email: ['Invalid email'] } }))).toEqual({
      field: 'email',
      message: 'Enter a valid email address, like name@company.com.',
    });
    expect(createUserProblem(refused(400, 'VALIDATION', 'Invalid input.', { fieldErrors: { lastName: ['String must contain at most 191 character(s)'] } }))).toEqual({
      field: 'lastName',
      message: 'Check the last name: String must contain at most 191 character(s)',
    });
    expect(createUserProblem(refused(403, 'FORBIDDEN', 'You do not have permission to do that.'))).toEqual({ field: null, message: 'You don’t have permission to create accounts.' });
    expect(createUserProblem(refused(500, 'ERROR', 'Request failed (500)'))).toEqual({ field: null, message: 'Couldn’t create the account. Please try again.' });
  });

  it('never says “not created” for a try that got no answer — the same try is safe to send again', () => {
    expect(createUserProblem(new UserChangeNotSent())).toEqual({ field: null, message: 'You’re offline — accounts can be created when you’re connected.' });
    expect(createUserProblem(new NetworkError('The server took too long to respond.', { timedOut: true }))).toEqual({
      field: null,
      message: 'We couldn’t confirm the account was created. Tap Create user again: it won’t be made twice.',
      unsure: true,
    });
  });

  // 6b review: the server answers 409 IDEMPOTENCY_IN_PROGRESS while the first try (same key) is
  // still running. That is not "already in use": the account may be made, so the key is kept and
  // the same try sent again gets the first one's answer — never a second account.
  it('a try still being created on the server is “still creating”, its key kept — not “already in use”', () => {
    expect(createUserProblem(refused(409, 'IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed. Retry shortly.'))).toEqual({
      field: null,
      message: 'The account is still being created. Wait a moment, then tap Create user again: it won’t be made twice.',
      unsure: true,
    });
    // Any other conflict is still a name or email in use, and a fixed try is a new one.
    expect(createUserProblem(refused(409, 'CONFLICT', 'A user with this email or username already exists.'))).toEqual({
      field: 'username',
      message: 'That email or username is already in use. Choose a different one.',
    });
  });
});

describe('Edit a user, as the website’s Manage account dialog', () => {
  const omar = user({ roles: ['EMPLOYEE'], status: 'ACTIVE' });

  it('starts from the account as it is', () => {
    expect(editFormOf(omar)).toEqual({ firstName: 'Omar', lastName: 'Ahmed', username: 'omar', email: 'omar@mico360.com', status: 'ACTIVE', roles: ['EMPLOYEE'] });
  });

  it('wants the four details and at least one role (your own roles aren’t yours to change)', () => {
    const f = editFormOf(omar);
    expect(checkUserEdit(f, false)).toBeNull();
    expect(checkUserEdit({ ...f, email: ' ' }, false)).toEqual({ field: 'email', message: 'First name, last name, username and email are all required.' });
    expect(checkUserEdit({ ...f, roles: [] }, false)).toEqual({ field: null, message: 'Give the account at least one role.' });
    expect(checkUserEdit({ ...f, roles: [] }, true)).toBeNull();
  });

  it('never sends your own roles; anyone else’s are replaced by the ones ticked', () => {
    const f = { ...editFormOf(omar), firstName: ' Omar  ', roles: ['ADMIN', 'EMPLOYEE'] };
    expect(userPatch(f, false)).toEqual({ firstName: 'Omar', lastName: 'Ahmed', username: 'omar', email: 'omar@mico360.com', roleNames: ['ADMIN', 'EMPLOYEE'] });
    expect(userPatch(f, true)).toEqual({ firstName: 'Omar', lastName: 'Ahmed', username: 'omar', email: 'omar@mico360.com' });
  });

  it('shows the server’s own reason (the last administrator, a name in use), else the website’s', () => {
    expect(saveProblem(refused(409, 'LAST_ADMIN', 'This is the last active administrator. Make someone else an administrator first.'))).toBe(
      'This is the last active administrator. Make someone else an administrator first.',
    );
    expect(saveProblem(refused(400, 'VALIDATION', 'Invalid input.', { fieldErrors: { email: ['Invalid email'] } }))).toBe('Enter a valid email address, like name@company.com.');
    expect(saveProblem(refused(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t save. Check the details (email/username may already be in use).');
    expect(saveProblem(new UserChangeNotSent())).toBe('You’re offline — changes to accounts need a connection.');
    expect(saveProblem(new NetworkError('Network request failed.'))).toBe('We couldn’t confirm the change. Check your connection, then look at the list to see whether it was made.');
  });

  it('a status refused after the details were saved says both', () => {
    expect(statusAfterSaveText(refused(409, 'LAST_ADMIN', 'This is the last active administrator. Make someone else an administrator first.'))).toBe(
      'Profile saved, but the status couldn’t be changed. This is the last active administrator. Make someone else an administrator first.',
    );
    expect(statusAfterSaveText(refused(500, 'ERROR', 'Request failed (500)'))).toBe('Profile saved, but the status couldn’t be changed.');
  });
});

describe('Status, unlock, delete and password reset on the list', () => {
  const omar = user();

  it('changing a status: the server’s reason, else the website’s words', () => {
    expect(statusChangeProblem(refused(409, 'LAST_ADMIN', 'This is the last active administrator. Make someone else an administrator first.'))).toBe(
      'This is the last active administrator. Make someone else an administrator first.',
    );
    expect(statusChangeProblem(refused(502, 'ERROR', 'Request failed (502)'))).toBe('Couldn’t change the account status.');
    expect(statusChangeProblem(new UserChangeNotSent())).toBe('You’re offline — changes to accounts need a connection.');
  });

  it('unlocking says who can sign in again', () => {
    expect(unlockDoneText(omar)).toBe('omar can sign in again.');
    expect(unlockProblem(refused(404, 'NOT_FOUND', 'User not found.'), omar)).toBe('User not found.');
    expect(unlockProblem(refused(500, 'ERROR', 'Request failed (500)'), omar)).toBe('Couldn’t unlock omar.');
  });

  it('deleting: a user already gone counts as deleted (a second try after a lost answer)', () => {
    expect(deletedAlready(refused(404, 'NOT_FOUND', 'User not found.'))).toBe(true);
    expect(deletedAlready(refused(409, 'LAST_ADMIN', 'x'))).toBe(false);
    expect(deleteProblem(refused(409, 'LAST_ADMIN', 'This is the last active administrator. Make someone else an administrator first.'))).toBe(
      'This is the last active administrator. Make someone else an administrator first.',
    );
    expect(deleteProblem(refused(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t delete. Try again.');
  });

  it('a new password follows the rule; the reset is told as the website tells it', () => {
    expect(checkResetPassword('')).toBe('Use at least 8 characters, including a letter and a number.');
    expect(checkResetPassword('onlyletters')).toBe('Use at least 8 characters, including a letter and a number.');
    expect(checkResetPassword('Fake-pass-1')).toBeNull();
    expect(RESET_DONE).toBe('Password reset. Share the new password with the user securely.');
    expect(resetProblem(refused(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters and include a letter and a number.'))).toBe(
      'Password must be at least 8 characters and include a letter and a number.',
    );
    expect(resetProblem(refused(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t reset the password. Use at least 8 characters, including a letter and a number.');
    expect(resetProblem(new UserChangeNotSent())).toBe('You’re offline — changes to accounts need a connection.');
  });

  it('never repeats a password in what it says', () => {
    const typed = 'Fake-pass-1';
    for (const text of [resetProblem(refused(400, 'WEAK_PASSWORD', 'Too weak')), resetProblem(new NetworkError('x')), checkResetPassword('abc') ?? '']) {
      expect(text).not.toContain(typed);
    }
  });
});

/**
 * The website's User Management (Web Portal/frontend/src/pages/UsersPage.tsx and its dialogs): the
 * app says the same things. Skipped when the website's code isn't next to the app.
 */
const web = resolve(__dirname, '../../../Web Portal/frontend/src');
describe.skipIf(!existsSync(resolve(web, 'pages/UsersPage.tsx')))('in the website’s words', () => {
  const page = readFileSync(resolve(web, 'pages/UsersPage.tsx'), 'utf8');
  const create = readFileSync(resolve(web, 'components/CreateUserModal.tsx'), 'utf8');
  const edit = readFileSync(resolve(web, 'components/EditUserModal.tsx'), 'utf8');

  it('the role names and their hints', () => {
    for (const r of ROLE_OPTIONS) {
      expect(edit).toContain(`label: '${r.label}'`);
      expect(edit).toContain(`hint: '${r.hint}'`);
    }
  });

  it('the messages', () => {
    expect(create).toContain("'Fill in every field.'");
    expect(create).toContain("'That email or username is already in use. Choose a different one.'");
    expect(create).toContain("'Enter a valid email address, like name@company.com.'");
    expect(create).toContain("'You don’t have permission to create accounts.'");
    expect(create).toContain("'Couldn’t create the account. Please try again.'");
    expect(edit).toContain("'First name, last name, username and email are all required.'");
    expect(edit).toContain("'Give the account at least one role.'");
    expect(edit).toContain("'Couldn’t save. Check the details (email/username may already be in use).'");
    expect(edit).toContain('Profile saved, but the status couldn’t be changed.');
    expect(edit).toContain(`'${RESET_DONE}'`);
    expect(page).toContain("'Couldn’t change the account status.'");
    expect(page).toContain('can sign in again.');
    expect(page).toContain("'Couldn’t delete. Try again.'");
    expect(page).toContain('locked after too many failed sign-in attempts. Unlock');
  });

  it('the statuses', () => {
    for (const s of USER_STATUSES) expect(page).toContain(`<option value="${s}">${statusLabel(s)}</option>`);
  });
});

describe('sending user changes (userActions)', () => {
  const omar = user();
  const calls: string[] = [];
  const api = (over: Partial<UserApi> = {}): UserApi => ({
    create: async (body, key) => {
      calls.push(`create ${body.username} ${key}`);
      return { user: user({ id: 'new', username: body.username }), welcome: null };
    },
    update: async (id, patch) => {
      calls.push(`update ${id} ${JSON.stringify(patch)}`);
      return user({ ...omar, ...patch });
    },
    setStatus: async (id, status) => {
      calls.push(`status ${id} ${status}`);
      return user({ ...omar, status });
    },
    remove: async (id) => {
      calls.push(`remove ${id}`);
    },
    unlock: async (id) => {
      calls.push(`unlock ${id}`);
    },
    resetPassword: async (id) => {
      calls.push(`password ${id}`);
    },
    ...over,
  });
  const online = () => true;

  it('sends nothing while the phone knows it is offline', async () => {
    calls.length = 0;
    const a = userActions({ api: api(), isOnline: () => false });
    await expect(a.create({ firstName: 'A', lastName: 'B', username: 'ab', email: 'a@b.co', password: 'Temp1234', role: 'EMPLOYEE', sendWelcome: false }, 'k1')).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.save(omar, editFormOf(omar), false)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.setStatus(omar, 'INACTIVE')).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.unlock(omar)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.remove(omar)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.resetPassword(omar, 'Fake-pass-1')).rejects.toBeInstanceOf(UserChangeNotSent);
    expect(calls).toEqual([]);
  });

  it('creates with the try’s own key, so a second try after a lost answer makes no second account', async () => {
    calls.length = 0;
    const made = await userActions({ api: api(), isOnline: online }).create({ firstName: 'A', lastName: 'B', username: 'ab', email: 'a@b.co', password: 'Temp1234', role: 'ADMIN', sendWelcome: false }, 'key-1');
    expect(calls).toEqual(['create ab key-1']);
    expect(made).toEqual({ user: expect.objectContaining({ id: 'new' }), welcome: null });
  });

  it('saves the details, then the status only when it changed (never your own)', async () => {
    calls.length = 0;
    const a = userActions({ api: api(), isOnline: online });
    await a.save(omar, { ...editFormOf(omar), firstName: 'Omar K' }, false);
    expect(calls).toEqual([`update u1 ${JSON.stringify({ firstName: 'Omar K', lastName: 'Ahmed', username: 'omar', email: 'omar@mico360.com', roleNames: ['EMPLOYEE'] })}`]);
    calls.length = 0;
    const saved = await a.save(omar, { ...editFormOf(omar), status: 'SUSPENDED' }, false);
    expect(calls.map((c) => c.split(' ')[0])).toEqual(['update', 'status']);
    expect(saved.status).toBe('SUSPENDED');
    calls.length = 0;
    await a.save(omar, { ...editFormOf(omar), status: 'SUSPENDED' }, true);
    expect(calls.map((c) => c.split(' ')[0])).toEqual(['update']);
  });

  it('a status refused after the details were saved says the details are saved', async () => {
    const last = refused(409, 'LAST_ADMIN', 'This is the last active administrator. Make someone else an administrator first.');
    const a = userActions({ api: api({ setStatus: async () => Promise.reject(last) }), isOnline: online });
    const err = await a.save(omar, { ...editFormOf(omar), status: 'INACTIVE' }, false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatusAfterSaveError);
    expect((err as StatusAfterSaveError).saved.id).toBe('u1');
    expect(statusAfterSaveText((err as StatusAfterSaveError).inner)).toContain('This is the last active administrator.');
  });

  it('each change goes as the person who made it: Save’s details and status both, even if someone else signs in between (lib/owned-write)', async () => {
    const sent: string[] = [];
    let signedIn = 'admin-a';
    const as = (who: string): UserApi =>
      api({
        update: async (id, patch) => {
          sent.push(`${who} update ${id}`);
          signedIn = 'admin-b'; // someone else signs in while the details are on their way
          return user({ ...omar, ...patch });
        },
        setStatus: async (id, status) => {
          sent.push(`${who} status ${id}`);
          return user({ ...omar, status });
        },
      });
    const a = userActions({ api: () => as(signedIn), isOnline: online });
    await a.save(omar, { ...editFormOf(omar), status: 'SUSPENDED' }, false);
    expect(sent).toEqual(['admin-a update u1', 'admin-a status u1']);
    // The next change is made by whoever is signed in then.
    sent.length = 0;
    await a.setStatus(omar, 'ACTIVE');
    expect(sent).toEqual(['admin-b status u1']);
  });

  it('deleting someone already gone counts as deleted', async () => {
    const a = userActions({ api: api({ remove: async () => Promise.reject(refused(404, 'NOT_FOUND', 'User not found.')) }), isOnline: online });
    await expect(a.remove(omar)).resolves.toBeUndefined();
    const b = userActions({ api: api({ remove: async () => Promise.reject(refused(409, 'LAST_ADMIN', 'x')) }), isOnline: online });
    await expect(b.remove(omar)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('sign-ins and welcome emails on the list (1.13)', () => {
  const people = [
    user({ id: 'u1', lastLoginAt: '2026-10-24T05:12:00Z' }),
    user({ id: 'u2', username: 'sara', lastLoginAt: null }),
    user({ id: 'u3', username: 'layla', status: 'INACTIVE' }),
  ];

  it('"Never signed in" finds those who never did', () => {
    expect(filterUsers(people, { q: '', filter: 'NEVER' }).map((u) => u.id)).toEqual(['u2', 'u3']);
    expect(filterUsers(people, { q: '', filter: 'NEVER' }).every((u) => !u.lastLoginAt)).toBe(true);
    expect(filterOptions(people).map((o) => o.label)).toContain('Never signed in');
    expect(filterOptions(people).find((o) => o.value === 'NEVER')?.count).toBe(2);
    expect(NEVER_EMPTY).toBe('Everyone has signed in at least once.');
  });

  it('the sorts, the selection and the notices, in the website’s words', () => {
    expect(SIGN_IN_SORTS.map((s) => s.value)).toEqual(['newest', 'signin-latest', 'signin-earliest']);
    expect([selectedText(1), selectedText(3)]).toEqual(['1 selected', '3 selected']);
    expect(welcomeSentNotice({ username: 'sara', email: 'sara@mico360.com' })).toBe('Welcome email sent to sara (sara@mico360.com).');
    expect(USERS_SUBTITLE).toBe('Create and edit accounts, assign roles, control access, reset passwords and send welcome emails.');
  });

  it('a batch’s answer lists who didn’t get one and why, each once (two may read alike); none sent is an error', () => {
    const r = {
      sent: 1,
      notSent: 3,
      results: [
        { userId: 'u1', username: 'sara', name: 'Sara Ali', email: 's@x.co', sent: true },
        { userId: 'u2', username: 'omar', name: 'Omar', email: 'o@x.co', sent: false, why: 'the account is suspended' },
        { userId: 'u3', username: null, name: 'Layla', email: null, sent: false },
        { userId: 'u4', username: null, name: null, email: null, sent: false, why: 'it was not found' },
      ],
    };
    expect(welcomeResultLines(r)).toEqual({
      summary: 'Sent 1. 3 not sent:',
      lines: [
        { key: 'u2-1', text: 'omar: the account is suspended' },
        { key: 'u3-2', text: 'Layla: not sent' },
        { key: 'u4-3', text: 'Someone: it was not found' },
      ],
      error: false,
    });
    expect(welcomeResultLines({ sent: 0, notSent: 1, results: [r.results[1]!] }).error).toBe(true);
    expect(welcomeResultLines({ sent: 2, notSent: 0, results: [] })).toEqual({ summary: 'Sent 2.', lines: [], error: false });
  });

  it('why a welcome email didn’t go: offline (never sent), no answer, the server’s reason, or the website’s fallback', () => {
    expect(welcomeProblem(new UserChangeNotSent())).toBe('You’re offline — changes to accounts need a connection.');
    expect(welcomeProblem(new NetworkError('Network request failed.'))).toBe('We couldn’t confirm the change. Check your connection, then look at the list to see whether it was made.');
    expect(welcomeProblem(refused(409, 'TOO_SOON', 'A welcome email was sent to sara less than a minute ago.'))).toBe('A welcome email was sent to sara less than a minute ago.');
    expect(welcomeProblem(refused(503, 'EMAIL_NOT_CONFIGURED', 'Email isn’t set up on this server yet.'))).toBe('Email isn’t set up on this server yet.');
    expect(welcomeProblem(refused(500, 'ERROR', 'Request failed (500)'))).toBe(WELCOME_TEXT.failed);
  });
});

describe.skipIf(!existsSync(resolve(web, 'pages/UsersPage.tsx')) || !existsSync(resolve(web, 'components/CreateUserModal.tsx')))('the website’s welcome and sign-in words', () => {
  const w = readFileSync(resolve(web, 'pages/UsersPage.tsx'), 'utf8') + readFileSync(resolve(web, 'components/CreateUserModal.tsx'), 'utf8');
  it('Users page and new-user form', () => {
    // The website writes the limit as {MAX_WELCOME_BATCH} inside its sentence.
    const asWritten = (t: string) => t.replace('up to 100 welcome', 'up to {MAX_WELCOME_BATCH} welcome');
    for (const t of [...Object.values(WELCOME_TEXT), ...Object.values(NEW_USER_TEXT).map((x) => x.trim()), NEVER_EMPTY, USERS_SUBTITLE, ...SIGN_IN_SORTS.map((s) => s.label), 'Never signed in', 'Last sign-in', 'account is ready']) {
      expect(w, t).toContain(asWritten(t));
    }
    for (const t of ['Enter a temporary password, or turn on “Send a welcome email” so they can set their own.', 'Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password.', 'Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Give them a temporary password.', 'it couldn’t be sent', 'Welcome email sent to ${u.username} (${out.email ?? u.email}).', "text: `${x.username ?? x.name ?? 'Someone'}: ${x.why ?? 'not sent'}`", 'error: r.sent === 0 && r.notSent > 0']) {
      expect(w, t).toContain(t);
    }
  });
});
