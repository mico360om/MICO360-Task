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
  type UserApi,
  type ApiAdminUser,
} from './users-admin';

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
      { value: 'LOCKED', label: 'Locked', count: 1, danger: true },
    ]);
    expect(filterOptions(people.slice(0, 2)).map((o) => o.value)).toEqual(['ALL', 'ACTIVE', 'INACTIVE', 'SUSPENDED']);
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
  const form = { firstName: 'Aisha', lastName: 'Khan', username: 'aisha', email: 'aisha@mico360.com', password: 'Temp1234', role: 'EMPLOYEE' as const };

  it('wants every field, then the password rule, and names the field to fix', () => {
    expect(checkNewUser(form)).toBeNull();
    expect(checkNewUser({ ...form, firstName: ' ' })).toEqual({ field: 'firstName', message: 'Fill in every field.' });
    expect(checkNewUser({ ...form, email: '' })).toEqual({ field: 'email', message: 'Fill in every field.' });
    expect(checkNewUser({ ...form, password: '' })).toEqual({ field: 'password', message: 'Fill in every field.' });
    expect(checkNewUser({ ...form, password: 'abcdefgh' })).toEqual({ field: 'password', message: 'Use at least 8 characters, including a letter and a number.' });
    expect(checkNewUser({ ...form, password: 'a1' })).toEqual({ field: 'password', message: 'Use at least 8 characters, including a letter and a number.' });
  });

  it('sends the one role chosen, the names trimmed and the password exactly as typed', () => {
    expect(newUserBody({ ...form, firstName: ' Aisha ', password: ' Temp 1234 ', role: 'ADMIN' })).toEqual({
      firstName: 'Aisha',
      lastName: 'Khan',
      username: 'aisha',
      email: 'aisha@mico360.com',
      password: ' Temp 1234 ',
      roleNames: ['ADMIN'],
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
      return user({ id: 'new', username: body.username });
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
    await expect(a.create({ firstName: 'A', lastName: 'B', username: 'ab', email: 'a@b.co', password: 'Temp1234', role: 'EMPLOYEE' }, 'k1')).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.save(omar, editFormOf(omar), false)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.setStatus(omar, 'INACTIVE')).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.unlock(omar)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.remove(omar)).rejects.toBeInstanceOf(UserChangeNotSent);
    await expect(a.resetPassword(omar, 'Fake-pass-1')).rejects.toBeInstanceOf(UserChangeNotSent);
    expect(calls).toEqual([]);
  });

  it('creates with the try’s own key, so a second try after a lost answer makes no second account', async () => {
    calls.length = 0;
    await userActions({ api: api(), isOnline: online }).create({ firstName: 'A', lastName: 'B', username: 'ab', email: 'a@b.co', password: 'Temp1234', role: 'ADMIN' }, 'key-1');
    expect(calls).toEqual(['create ab key-1']);
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

  it('deleting someone already gone counts as deleted', async () => {
    const a = userActions({ api: api({ remove: async () => Promise.reject(refused(404, 'NOT_FOUND', 'User not found.')) }), isOnline: online });
    await expect(a.remove(omar)).resolves.toBeUndefined();
    const b = userActions({ api: api({ remove: async () => Promise.reject(refused(409, 'LAST_ADMIN', 'x')) }), isOnline: online });
    await expect(b.remove(omar)).rejects.toBeInstanceOf(ApiError);
  });
});
