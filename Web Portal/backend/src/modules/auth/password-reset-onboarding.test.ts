import { describe, it, expect, beforeEach } from 'vitest';
import { createPasswordResetService, type PasswordResetStore, type ResetRecord, type ResetUserRepo } from './password-reset-service';
import { generateResetToken, hashResetToken } from '../../lib/reset-token';

/**
 * Onboarding additions to the set-password links: what a link is (for "This invitation has expired —
 * ask <company> to send a new one"), what using one tells the rest of the server (it confirms the email
 * address; an invitation activates the account), and an administrator's "Send password reset".
 */
type Row = ResetRecord & { purpose: 'PASSWORD_RESET' | 'WELCOME'; createdAt: Date };
let clock: number;
let rows: Row[];
let people: Map<string, { id: string; email: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; activated: boolean; cancelled?: boolean; temporary?: boolean }>;
let mails: { to: string; link: string; opts?: Record<string, unknown> }[];
let used: { userId: string; purpose: string }[];
let failSend: boolean;
let mailOn: boolean;
let seq: number;
const MIN = 60_000;

function store(): PasswordResetStore {
  return {
    async create(data) {
      for (const r of rows) if (r.userId === data.userId && r.purpose === 'PASSWORD_RESET' && r.consumedAt === null) r.consumedAt = new Date(clock);
      rows.push({ id: `r${seq++}`, consumedAt: null, createdAt: new Date(clock), purpose: 'PASSWORD_RESET', ...data });
    },
    async findActiveByHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash && r.consumedAt === null) ?? null;
    },
    async findAnyByHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash) ?? null;
    },
    async countIssuedSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.purpose === 'PASSWORD_RESET' && r.createdAt >= since).length;
    },
    async consume(id) {
      const r = rows.find((x) => x.id === id && x.consumedAt === null);
      if (!r) return false;
      r.consumedAt = new Date(clock);
      return true;
    },
    async consumeAllForUser(userId) {
      for (const r of rows) if (r.userId === userId && r.consumedAt === null) r.consumedAt = new Date(clock);
    },
  };
}
function users(): ResetUserRepo {
  return {
    async findActiveByIdentifier(identifier) {
      const p = [...people.values()].find((x) => x.email === identifier && x.status === 'ACTIVE');
      return p ? { id: p.id, email: p.email } : null;
    },
    async isActive(id) {
      return people.get(id)?.status === 'ACTIVE';
    },
    async setPasswordAndUnlock() {},
    async findById(id) {
      const p = people.get(id);
      return p ? { id: p.id, email: p.email, status: p.status, invitationCancelled: p.cancelled === true, mustChangePassword: p.temporary === true } : null;
    },
    async isActivated(id) {
      return people.get(id)?.activated ?? false;
    },
  };
}
function make() {
  return createPasswordResetService({
    store: store(),
    users: users(),
    ttlSeconds: 3600,
    appUrl: 'https://tasks.test/',
    hashPassword: async (p) => `h:${p}`,
    now: () => new Date(clock),
    runInBackground: (task) => void task(),
    companyName: async (id) => (id === 'cli' ? 'Prolens Projects LLC' : null),
    onLinkUsed: async (userId, purpose) => void used.push({ userId, purpose }),
    emailOptions: async () => ({ brand: { companyName: 'Prolens' } }),
    mailer: {
      isConfigured: () => mailOn,
      async sendPasswordReset(to, link, opts) {
        if (failSend) throw new Error('down');
        mails.push({ to, link, ...(opts ? { opts: opts as Record<string, unknown> } : {}) });
      },
    },
  });
}
function link(userId: string, purpose: Row['purpose'], o: Partial<Row> = {}) {
  const { token, tokenHash } = generateResetToken();
  rows.push({ id: `r${seq++}`, userId, tokenHash, purpose, expiresAt: new Date(clock + 7 * 24 * 60 * MIN), consumedAt: null, createdAt: new Date(clock), ...o });
  return token;
}

beforeEach(() => {
  clock = Date.parse('2026-11-07T08:00:00Z');
  rows = [];
  mails = [];
  used = [];
  failSend = false;
  mailOn = true;
  seq = 0;
  people = new Map([
    ['cli', { id: 'cli', email: 'saif@oxy.com', status: 'ACTIVE', activated: false }],
    ['emp', { id: 'emp', email: 'emp@x.co', status: 'ACTIVE', activated: true }],
    ['off', { id: 'off', email: 'off@x.co', status: 'INACTIVE', activated: true }],
    ['sus', { id: 'sus', email: 'sus@x.co', status: 'SUSPENDED', activated: true }],
  ]);
});

describe('What a set-password link is (the page asks before the password is typed)', () => {
  it('a live invitation: live, welcome, with the company’s name', async () => {
    const token = link('cli', 'WELCOME');
    expect(await make().linkStatus(token)).toEqual({ kind: 'welcome', state: 'live', company: 'Prolens Projects LLC' });
  });

  it('an expired invitation (7 days on), or one replaced by a resend: expired, still naming the company', async () => {
    const token = link('cli', 'WELCOME');
    clock += 7 * 24 * 60 * MIN;
    expect(await make().linkStatus(token)).toEqual({ kind: 'welcome', state: 'expired', company: 'Prolens Projects LLC' });
    const voided = link('cli', 'WELCOME', { consumedAt: new Date(clock) });
    expect((await make().linkStatus(voided)).state).toBe('expired');
  });

  it('an invitation already used (the account is theirs now): used', async () => {
    const token = link('cli', 'WELCOME', { consumedAt: new Date(clock) });
    people.get('cli')!.activated = true;
    expect((await make().linkStatus(token)).state).toBe('used');
  });

  it('a link of an account deactivated since: expired (nothing more is said)', async () => {
    const token = link('off', 'WELCOME');
    expect((await make().linkStatus(token)).state).toBe('expired');
  });

  it('a reset link: reset; an unknown token: unknown, no company', async () => {
    expect((await make().linkStatus(link('emp', 'PASSWORD_RESET'))).kind).toBe('reset');
    expect(await make().linkStatus('not-a-real-token')).toEqual({ kind: null, state: 'unknown', company: null });
  });
});

describe('Using a link tells the rest of the server (it confirms the email address)', () => {
  it('an invitation link used: onLinkUsed(user, WELCOME); a reset link: PASSWORD_RESET', async () => {
    const svc = make();
    await svc.resetPassword(link('cli', 'WELCOME'), 'NewPassword1');
    await svc.resetPassword(link('emp', 'PASSWORD_RESET'), 'NewPassword1');
    expect(used).toEqual([{ userId: 'cli', purpose: 'WELCOME' }, { userId: 'emp', purpose: 'PASSWORD_RESET' }]);
  });

  it('a refused link (expired) tells nothing', async () => {
    const token = link('cli', 'WELCOME');
    clock += 7 * 24 * 60 * MIN;
    await expect(make().resetPassword(token, 'NewPassword1')).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    expect(used).toEqual([]);
  });
});

describe('Send password reset (an administrator, for any active account)', () => {
  it('emails a reset link valid 1 hour, marked as sent by an administrator; earlier unused reset links stop', async () => {
    const svc = make();
    const older = link('emp', 'PASSWORD_RESET', { createdAt: new Date(clock - 2 * MIN) });
    const out = await svc.sendForAdministrator('emp');
    expect(out).toEqual({ userId: 'emp', email: 'emp@x.co', sent: true, sentAt: new Date(clock).toISOString() });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('emp@x.co');
    expect(mails[0]!.opts).toMatchObject({ byAdministrator: true, brand: { companyName: 'Prolens' } });
    const token = new URL(mails[0]!.link).searchParams.get('token')!;
    expect(mails[0]!.link.startsWith('https://tasks.test/reset?token=')).toBe(true);
    const row = rows.find((r) => r.tokenHash === hashResetToken(token))!;
    expect(row.expiresAt.getTime() - clock).toBe(60 * MIN);
    expect((await svc.linkStatus(older)).state).toBe('expired');
    // Only its hash is stored.
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('a locked account can be sent one (setting the password unlocks it)', async () => {
    expect((await make().sendForAdministrator('cli')).sent).toBe(true);
  });

  it('refusals are answers with the reason: inactive, suspended, unknown, a second within the minute', async () => {
    const svc = make();
    expect(await svc.sendForAdministrator('off')).toMatchObject({ sent: false, reason: 'ACCOUNT_INACTIVE' });
    expect(await svc.sendForAdministrator('sus')).toMatchObject({ sent: false, reason: 'ACCOUNT_SUSPENDED' });
    expect(await svc.sendForAdministrator('ghost')).toMatchObject({ sent: false, reason: 'NOT_FOUND' });
    await svc.sendForAdministrator('emp');
    clock += 30_000;
    expect(await svc.sendForAdministrator('emp')).toMatchObject({ sent: false, reason: 'TOO_SOON' });
    clock += 31_000;
    expect((await svc.sendForAdministrator('emp')).sent).toBe(true);
    expect(mails).toHaveLength(2);
  });

  it('an email that can’t go: not sent (DELIVERY_FAILED) and its link never works', async () => {
    failSend = true;
    const svc = make();
    expect(await svc.sendForAdministrator('emp')).toMatchObject({ sent: false, reason: 'DELIVERY_FAILED' });
    expect(rows.every((r) => r.consumedAt !== null)).toBe(true);
  });

  // Security review finding 6: never a reset link beside a cancelled invitation or a temporary password.
  it('refused for a cancelled invitation and for a temporary password still to change, with plain reasons', async () => {
    people.set('cxl', { id: 'cxl', email: 'cxl@x.co', status: 'ACTIVE', activated: false, cancelled: true });
    people.set('tmp', { id: 'tmp', email: 'tmp@x.co', status: 'ACTIVE', activated: false, temporary: true });
    const svc = make();
    expect(await svc.sendForAdministrator('cxl')).toMatchObject({ sent: false, reason: 'INVITATION_CANCELLED', why: 'the invitation was cancelled (send a new invitation or set a temporary password)' });
    expect(await svc.sendForAdministrator('tmp')).toMatchObject({ sent: false, reason: 'TEMPORARY_PASSWORD', why: 'they have a temporary password to change at their first sign-in (send an invitation instead; it replaces the temporary password)' });
    expect(mails).toEqual([]);
    expect(rows).toEqual([]);
  });
});
