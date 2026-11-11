import { describe, it, expect, vi, afterEach } from 'vitest';
import { createUserService, type UserServiceDeps } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { WeakPasswordError } from '../auth/errors';
import { verifyPassword } from '../../lib/password';

function make(extra: Partial<UserServiceDeps> = {}) {
  const mem = createMemoryUserRepository();
  const revoked: string[] = [];
  const disconnected: string[] = [];
  const svc = createUserService({
    users: mem.repo,
    revokeSessions: async (id) => { revoked.push(id); },
    onSessionsRevoked: (id) => { disconnected.push(id); },
    ...extra,
  });
  return { svc, mem, revoked, disconnected };
}

const person = (o: Record<string, unknown> = {}) => ({ email: 'a@x', username: 'ada', password: 'Password1!', firstName: 'Ada', lastName: 'L', roleNames: ['EMPLOYEE'], ...o });

describe('UserService', () => {
  it('creates a user with a hashed password and roles', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person());
    expect(u.username).toBe('ada');
    expect(u.roles).toEqual(['EMPLOYEE']);
    expect(mem.hashOf(u.id)).toBeTruthy();
    expect(mem.hashOf(u.id)).not.toBe('Password1!');
  });

  it('defaults a new user to the EMPLOYEE role and refuses an empty role list', async () => {
    const { svc } = make();
    const { roleNames, ...noRoles } = person();
    void roleNames; // dropped on purpose: createUser must default it
    expect((await svc.createUser(noRoles)).roles).toEqual(['EMPLOYEE']);
    await expect(svc.createUser(person({ email: 'b@x', username: 'b', roleNames: [] }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates an account without a password: it gets an unusable random one until the person sets theirs', async () => {
    const { svc, mem } = make();
    const a = await svc.createUser(person({ password: undefined }));
    const b = await svc.createUser(person({ email: 'b@x', username: 'bo', password: undefined }));
    const hashA = mem.hashOf(a.id)!;
    expect(hashA).toMatch(/^\$2[aby]\$/); // a real bcrypt hash, so a sign-in attempt takes the usual time
    expect(hashA).not.toBe(mem.hashOf(b.id));
    for (const guess of ['', 'undefined', 'null', 'Password1!']) expect(await verifyPassword(guess, hashA)).toBe(false);
  });

  it('enforces the password policy on create', async () => {
    const { svc } = make();
    await expect(svc.createUser(person({ password: '123456' }))).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(svc.createUser(person({ password: 'aaaaaaaa' }))).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('rejects a duplicate email or username', async () => {
    const { svc } = make();
    await svc.createUser(person());
    await expect(svc.createUser(person({ username: 'other' }))).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets a deleted user’s email and username be used again', async () => {
    const { svc } = make();
    const first = await svc.createUser(person({ roleNames: ['EMPLOYEE'] }));
    await svc.deleteUser(first.id);
    const again = await svc.createUser(person());
    expect(again.email).toBe('a@x');
    expect(again.id).not.toBe(first.id);
  });

  it('frees the identity of accounts deleted before deletes renamed them', async () => {
    const { svc, mem } = make();
    const first = await svc.createUser(person());
    mem.legacyDelete(first.id);
    await expect(svc.createUser(person())).resolves.toMatchObject({ email: 'a@x' });
  });

  it('throws NotFound for an unknown user', async () => {
    await expect(make().svc.getUser('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets a user status and ends their sessions when leaving ACTIVE', async () => {
    const { svc, mem, revoked, disconnected } = make();
    const u = await svc.createUser(person());
    const suspended = await svc.setUserStatus(u.id, 'SUSPENDED');
    expect(suspended.status).toBe('SUSPENDED');
    expect(mem.tokenVersion(u.id)).toBe(1);
    expect(revoked).toEqual([u.id]);
    expect(disconnected).toEqual([u.id]);
  });

  it('does not revoke sessions when re-activating a user', async () => {
    const { svc, revoked } = make();
    const u = await svc.createUser(person());
    await svc.setUserStatus(u.id, 'ACTIVE');
    expect(revoked).toEqual([]);
  });

  it('updates profile details, email, username and roles', async () => {
    const { svc } = make();
    const u = await svc.createUser(person());
    const updated = await svc.updateUser(u.id, { firstName: 'Ada', email: 'ada@new.co', username: 'ada2', roleNames: ['MANAGER', 'EMPLOYEE'] });
    expect(updated.firstName).toBe('Ada');
    expect(updated.email).toBe('ada@new.co');
    expect(updated.username).toBe('ada2');
    expect(updated.roles).toEqual(['MANAGER', 'EMPLOYEE']);
  });

  it('ends sessions on a real role change only (the edit dialog always resends roles)', async () => {
    const { svc, mem, revoked } = make();
    const u = await svc.createUser(person());
    await svc.updateUser(u.id, { firstName: 'Ada', roleNames: ['EMPLOYEE'] });
    expect(revoked).toEqual([]);
    await svc.updateUser(u.id, { roleNames: ['ADMIN'] });
    expect(revoked).toEqual([u.id]);
    expect(mem.tokenVersion(u.id)).toBe(1);
  });

  it('requires at least one role on update', async () => {
    const { svc } = make();
    const u = await svc.createUser(person());
    await expect(svc.updateUser(u.id, { roleNames: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an update whose new email collides with another user', async () => {
    const { svc } = make();
    await svc.createUser(person({ email: 'taken@x', username: 'taken' }));
    const u = await svc.createUser(person({ email: 'me@x', username: 'me' }));
    await expect(svc.updateUser(u.id, { email: 'taken@x' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows an update that keeps the user’s own email/username unchanged', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ email: 'me@x', username: 'me' }));
    const updated = await svc.updateUser(u.id, { firstName: 'Mo', email: 'me@x' });
    expect(updated.firstName).toBe('Mo');
  });

  it('lets an admin reset a user’s password to a fresh hash, lifting the lock and ending sessions', async () => {
    const { svc, mem, revoked } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    mem.lock(u.id, new Date(Date.now() + 60 * 60_000));
    expect((await svc.getUser(u.id)).locked).toBe(true);
    const before = mem.hashOf(u.id);
    await svc.adminResetPassword(u.id, 'BrandNew1!');
    expect(mem.hashOf(u.id)).toBeTruthy();
    expect(mem.hashOf(u.id)).not.toBe(before);
    expect(mem.hashOf(u.id)).not.toBe('BrandNew1!');
    expect((await svc.getUser(u.id)).locked).toBe(false);
    expect(revoked).toEqual([u.id]);
    expect(mem.tokenVersion(u.id)).toBe(1);
  });

  it('enforces the password policy on admin reset and self change', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    await expect(svc.adminResetPassword(u.id, '123456')).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(svc.changeOwnPassword(u.id, 'OldPass1!', 'aaaaaa')).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('throws NotFound when resetting an unknown user’s password', async () => {
    await expect(make().svc.adminResetPassword('nope', 'BrandNew1!')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('changes own password, ends every old session and returns a fresh one for the caller', async () => {
    const issued: { id: string; roles: string[]; tokenVersion: number }[] = [];
    const { svc, mem, revoked } = make({
      issueSession: async (user) => {
        issued.push(user);
        return { accessToken: 'new-access', refreshToken: 'new-refresh' };
      },
    });
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    const before = mem.hashOf(u.id);
    const session = await svc.changeOwnPassword(u.id, 'OldPass1!', 'NextPass1!');
    expect(mem.hashOf(u.id)).not.toBe(before);
    expect(revoked).toEqual([u.id]);
    expect(session).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(issued).toEqual([{ id: u.id, roles: ['EMPLOYEE'], tokenVersion: 1 }]); // issued after the bump
  });

  describe('live connections after a password change', () => {
    afterEach(() => vi.useRealTimers());

    it('your own change closes them a moment later, so the answer (with the new session) arrives first', async () => {
      // Closed at once, this page reconnected with its old — now refused — session before the answer
      // came back, and on a slow connection the person was signed out of the page they had just used.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { svc, revoked, disconnected } = make({ issueSession: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }) });
      const u = await svc.createUser(person({ password: 'OldPass1!' }));
      await svc.changeOwnPassword(u.id, 'OldPass1!', 'NextPass1!');
      expect(revoked).toEqual([u.id]);      // old tokens are refused immediately
      expect(disconnected).toEqual([]);     // …the sockets follow shortly
      await vi.advanceTimersByTimeAsync(10_000);
      expect(disconnected).toEqual([u.id]);
    });

    it('an administrator’s reset, or a suspension, closes them immediately', async () => {
      const { svc, disconnected } = make();
      const u = await svc.createUser(person());
      await svc.adminResetPassword(u.id, 'NextPass1!');
      expect(disconnected).toEqual([u.id]);
    });
  });

  it('rejects a self password change when the current password is wrong', async () => {
    const { svc } = make();
    const u = await svc.createUser(person({ password: 'OldPass1!' }));
    await expect(svc.changeOwnPassword(u.id, 'WrongPass!', 'NextPass1!')).rejects.toBeInstanceOf(ValidationError);
  });

  it('lets an admin unlock a locked account', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person());
    mem.lock(u.id, new Date(Date.now() + 60 * 60_000));
    const unlocked = await svc.unlockUser(u.id);
    expect(unlocked.locked).toBe(false);
  });

  it('deletes the person’s own data that only they could see (their MICO AI chats) when they are deleted', async () => {
    const gone: string[] = [];
    const { svc } = make({ onDeleted: async (id) => void gone.push(id) });
    const u = await svc.createUser(person());
    await svc.deleteUser(u.id);
    expect(gone).toEqual([u.id]);
  });

  it('1.23: an account made inactive, suspended or deleted loses what it connected (its Microsoft Teams connection); reactivating does not call it', async () => {
    const stopped: string[] = [];
    const { svc } = make({ onDeactivated: async (id) => void stopped.push(id) });
    const a = await svc.createUser(person({ email: 'a1@x', username: 'a1' }));
    const b = await svc.createUser(person({ email: 'b1@x', username: 'b1' }));
    const c = await svc.createUser(person({ email: 'c1@x', username: 'c1' }));
    await svc.setUserStatus(a.id, 'SUSPENDED');
    await svc.setUserStatus(b.id, 'INACTIVE');
    await svc.deleteUser(c.id);
    await svc.setUserStatus(a.id, 'ACTIVE');
    expect(stopped).toEqual([a.id, b.id, c.id]);
  });

  it('ends sessions when a user is deleted', async () => {
    const { svc, revoked } = make();
    const u = await svc.createUser(person());
    await svc.deleteUser(u.id);
    expect(revoked).toEqual([u.id]);
  });
});

describe('UserService — set-password links stop working when the account changes hands or stops', () => {
  it('a changed email ends every unused set-password link (welcome or reset): the old address can’t use one', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person({ email: 'sara@typo.co' }));
    await svc.updateUser(u.id, { email: 'sara@x.co' });
    expect(mem.linksEnded(u.id)).toBe(1);
  });

  it('an edit that keeps the email (names, roles, the same address) leaves the links alone', async () => {
    const { svc, mem } = make();
    const u = await svc.createUser(person());
    await svc.updateUser(u.id, { firstName: 'Ada B', roleNames: ['EMPLOYEE'] });
    await svc.updateUser(u.id, { email: 'a@x' });
    expect(mem.linksEnded(u.id)).toBe(0);
  });

  it('an account made inactive or suspended, or deleted, ends them; making it active again does not', async () => {
    const { svc, mem } = make();
    const a = await svc.createUser(person());
    const b = await svc.createUser(person({ email: 'b@x', username: 'bo' }));
    const c = await svc.createUser(person({ email: 'c@x', username: 'cy' }));
    await svc.setUserStatus(a.id, 'SUSPENDED');
    await svc.setUserStatus(b.id, 'INACTIVE');
    await svc.deleteUser(c.id);
    expect([mem.linksEnded(a.id), mem.linksEnded(b.id), mem.linksEnded(c.id)]).toEqual([1, 1, 1]);
    await svc.setUserStatus(a.id, 'ACTIVE');
    expect(mem.linksEnded(a.id)).toBe(1);
  });
});

describe('UserService — never lose the last active administrator', () => {
  async function withAdmins(count: number) {
    const h = make();
    const admins = [];
    for (let i = 0; i < count; i++) admins.push(await h.svc.createUser(person({ email: `admin${i}@x`, username: `admin${i}`, roleNames: ['ADMIN'] })));
    return { ...h, admins };
  }

  it('refuses to remove the ADMIN role from the last active admin', async () => {
    const { svc, admins } = await withAdmins(1);
    await expect(svc.updateUser(admins[0]!.id, { roleNames: ['EMPLOYEE'] })).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 409 });
  });

  it('refuses to deactivate, suspend or delete the last active admin', async () => {
    const { svc, admins } = await withAdmins(1);
    await expect(svc.setUserStatus(admins[0]!.id, 'INACTIVE')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(svc.setUserStatus(admins[0]!.id, 'SUSPENDED')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(svc.deleteUser(admins[0]!.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('allows it while another active admin remains', async () => {
    const { svc, admins } = await withAdmins(2);
    await expect(svc.updateUser(admins[0]!.id, { roleNames: ['EMPLOYEE'] })).resolves.toMatchObject({ roles: ['EMPLOYEE'] });
    await expect(svc.setUserStatus(admins[1]!.id, 'INACTIVE')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('does not count an inactive admin as the remaining one', async () => {
    const { svc, admins } = await withAdmins(2);
    await svc.setUserStatus(admins[1]!.id, 'SUSPENDED');
    await expect(svc.deleteUser(admins[0]!.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
});

describe('UserService — a user’s phones are forgotten when their access is revoked', () => {
  const setup = async () => {
    const forgotten: string[] = [];
    const h = make({ forgetDevices: async (id) => { forgotten.push(id); } });
    // A second active admin, so ada may lose the role or be disabled.
    await h.svc.createUser(person({ email: 'boss@x', username: 'boss', roleNames: ['ADMIN'] }));
    const ada = await h.svc.createUser(person());
    return { ...h, forgotten, ada };
  };

  it('an admin password reset, a role change, disabling and deleting forget the user’s phones', async () => {
    const { svc, forgotten, ada } = await setup();
    await svc.adminResetPassword(ada.id, 'Password2!');
    await svc.updateUser(ada.id, { roleNames: ['ADMIN'] });
    await svc.setUserStatus(ada.id, 'INACTIVE');
    await svc.deleteUser(ada.id);
    expect(forgotten).toEqual([ada.id, ada.id, ada.id, ada.id]);
  });

  it('changing your own password forgets your phones too (a lost phone shows notifications without the app running)', async () => {
    const { svc, forgotten, revoked, ada } = await setup();
    await svc.changeOwnPassword(ada.id, 'Password1!', 'Password2!');
    expect(revoked).toContain(ada.id);
    expect(forgotten).toEqual([ada.id]);
  });

  it('a role list that doesn’t change keeps the phones', async () => {
    const { svc, forgotten, ada } = await setup();
    await svc.updateUser(ada.id, { roleNames: ['EMPLOYEE'] });
    expect(forgotten).toEqual([]);
  });
});

describe('UserService — a new name reaches the task search', () => {
  it('tells onRenamed when the first name, last name or username changes — not for other edits', async () => {
    const renamed: string[] = [];
    const { svc } = make({ onRenamed: (id) => void renamed.push(id) });
    const u = await svc.createUser(person());
    await svc.updateUser(u.id, { firstName: 'Ada' }); // the same name
    await svc.updateUser(u.id, { email: 'ada@new.example' });
    expect(renamed).toEqual([]);
    await svc.updateUser(u.id, { lastName: 'Lovelace' });
    await svc.updateUser(u.id, { username: 'ada.l' });
    expect(renamed).toEqual([u.id, u.id]);
  });
});

describe('UserService — “Show my projects only” (1.22.3, set from Manage account)', () => {
  it('a new person starts with it off', async () => {
    const { svc } = make();
    expect((await svc.createUser(person({ roleNames: ['ADMIN'] }))).myProjectsOnly).toBe(false);
  });

  it('an administrator’s may be turned on and off; a non-administrator’s only off', async () => {
    const { svc } = make();
    const boss = await svc.createUser(person({ roleNames: ['ADMIN'] }));
    const emp = await svc.createUser(person({ email: 'e@x', username: 'emp' }));
    await expect(svc.updateUser(boss.id, { myProjectsOnly: true })).resolves.toMatchObject({ myProjectsOnly: true });
    await expect(svc.updateUser(boss.id, { myProjectsOnly: false })).resolves.toMatchObject({ myProjectsOnly: false });
    await expect(svc.updateUser(emp.id, { myProjectsOnly: true })).rejects.toMatchObject({ status: 403, message: 'Only administrators have this setting.' });
    await expect(svc.getUser(emp.id)).resolves.toMatchObject({ myProjectsOnly: false });
    await expect(svc.updateUser(emp.id, { myProjectsOnly: false })).resolves.toMatchObject({ myProjectsOnly: false });
  });

  it('a refused change saves nothing else either', async () => {
    const { svc } = make();
    const emp = await svc.createUser(person());
    await expect(svc.updateUser(emp.id, { firstName: 'Adele', myProjectsOnly: true })).rejects.toMatchObject({ status: 403 });
    await expect(svc.getUser(emp.id)).resolves.toMatchObject({ firstName: 'Ada' });
  });

  it('taken off the Administrator role, it is turned off with it (made an administrator again, it starts off)', async () => {
    const { svc } = make();
    await svc.createUser(person({ email: 'k@x', username: 'keeper', roleNames: ['ADMIN'] }));
    const boss = await svc.createUser(person({ roleNames: ['ADMIN'] }));
    await svc.updateUser(boss.id, { myProjectsOnly: true });
    await expect(svc.updateUser(boss.id, { roleNames: ['EMPLOYEE'] })).resolves.toMatchObject({ roles: ['EMPLOYEE'], myProjectsOnly: false });
    await expect(svc.updateUser(boss.id, { roleNames: ['ADMIN'] })).resolves.toMatchObject({ roles: ['ADMIN'], myProjectsOnly: false });
  });
});

describe('UserService — Training Center: “Reports to” and the Training manager permission', () => {
  async function setup() {
    const { svc, mem } = make();
    const ada = await svc.createUser(person());
    const boss = await svc.createUser(person({ email: 'b@x', username: 'boss', firstName: 'Bea' }));
    const client = await svc.createUser(person({ email: 'c@x', username: 'cli', roleNames: ['CLIENT'] }));
    return { svc, mem, ada, boss, client };
  }

  it('a new person reports to nobody and is not a Training manager', async () => {
    const { ada } = await setup();
    expect(ada).toMatchObject({ reportsToId: null, trainingManager: false });
  });

  it('“Reports to” an active staff account is kept; null clears it', async () => {
    const { svc, ada, boss } = await setup();
    await expect(svc.updateUser(ada.id, { reportsToId: boss.id })).resolves.toMatchObject({ reportsToId: boss.id });
    await expect(svc.getUser(ada.id)).resolves.toMatchObject({ reportsToId: boss.id });
    await expect(svc.updateUser(ada.id, { reportsToId: null })).resolves.toMatchObject({ reportsToId: null });
  });

  it('refuses themselves, a client, someone inactive or deleted, and an unknown id (400 naming the field); nothing saved', async () => {
    const { svc, ada, boss, client } = await setup();
    const refused = (reportsToId: string) => svc.updateUser(ada.id, { firstName: 'Adele', reportsToId });
    await expect(refused(ada.id)).rejects.toMatchObject({ status: 400, details: { field: 'reportsToId' }, message: 'A person can’t report to themselves.' });
    await expect(refused(client.id)).rejects.toMatchObject({ status: 400, details: { field: 'reportsToId' }, message: 'A client account can’t be someone’s “Reports to”.' });
    await expect(refused('nobody')).rejects.toMatchObject({ status: 400, details: { field: 'reportsToId' }, message: 'Choose an active staff account for “Reports to”.' });
    await svc.setUserStatus(boss.id, 'INACTIVE');
    await expect(refused(boss.id)).rejects.toMatchObject({ status: 400, details: { field: 'reportsToId' } });
    const gone = await svc.createUser(person({ email: 'g@x', username: 'gone' }));
    await svc.deleteUser(gone.id);
    await expect(refused(gone.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.getUser(ada.id)).resolves.toMatchObject({ firstName: 'Ada', reportsToId: null });
  });

  it('a staff member may be made a Training manager and back', async () => {
    const { svc, ada } = await setup();
    await expect(svc.updateUser(ada.id, { trainingManager: true })).resolves.toMatchObject({ trainingManager: true });
    await expect(svc.updateUser(ada.id, { trainingManager: false })).resolves.toMatchObject({ trainingManager: false });
  });

  it('a client account gets neither (400); turning the permission off is harmless', async () => {
    const { svc, boss, client } = await setup();
    await expect(svc.updateUser(client.id, { trainingManager: true })).rejects.toMatchObject({ status: 400, details: { field: 'trainingManager' } });
    await expect(svc.updateUser(client.id, { reportsToId: boss.id })).rejects.toMatchObject({ status: 400, details: { field: 'reportsToId' } });
    await expect(svc.updateUser(client.id, { trainingManager: false, reportsToId: null })).resolves.toMatchObject({ trainingManager: false, reportsToId: null });
  });

  it('the Training manager permission changes no roles and ends no sessions', async () => {
    const { svc, revoked } = make();
    const u = await svc.createUser(person());
    await svc.updateUser(u.id, { trainingManager: true });
    expect(revoked).toEqual([]);
    await expect(svc.getUser(u.id)).resolves.toMatchObject({ roles: ['EMPLOYEE'] });
  });
});
