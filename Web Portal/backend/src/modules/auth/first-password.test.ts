import { describe, it, expect } from 'vitest';
import { createFirstPassword, type FirstPasswordRepo, type FirstPasswordState } from './first-password';
import { InvalidCredentialsError, PasswordChangeExpiredError, PasswordChangeRequiredError, SameAsTemporaryPasswordError, TemporaryPasswordExpiredError, WeakPasswordError } from './errors';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const START = new Date('2026-11-07T08:00:00Z').getTime();

/** Plain stand-in hashing: "h:<password>" (the module never reads a hash, it only hands them over). */
const hashPassword = async (p: string) => `h:${p}`;
const verifyPassword = async (p: string, h: string) => h === `h:${p}`;

function harness(start: Partial<FirstPasswordState> = {}) {
  let clock = START;
  const state: FirstPasswordState = { mustChange: true, expiresAt: new Date(clock + 7 * DAY), passwordHash: 'h:Kite-Mango-Fern-Ripple-472', tokenVersion: 3, active: true, cancelled: false, ...start };
  const completed: { userId: string; newHash: string }[] = [];
  const repo: FirstPasswordRepo = {
    async state(userId) {
      return userId === 'u1' ? { ...state } : null;
    },
    async complete(userId, expectedHash, newHash) {
      if (userId !== 'u1' || state.passwordHash !== expectedHash || !state.mustChange) return false;
      Object.assign(state, { passwordHash: newHash, mustChange: false, expiresAt: null, tokenVersion: state.tokenVersion + 1 });
      completed.push({ userId, newHash });
      return true;
    },
  };
  const fp = createFirstPassword({ repo, key: 'test-key', hashPassword, verifyPassword, now: () => new Date(clock) });
  return { fp, state, completed, advance: (ms: number) => (clock += ms) };
}

describe('the forced change at the first sign-in after a temporary password', () => {
  it('nothing to do for anyone without a temporary password (no existing account is ever forced)', async () => {
    const h = harness({ mustChange: false, expiresAt: null });
    await h.fp.refuseUnusable('u1');
    expect(await h.fp.gate('u1', true)).toBeNull();
    expect(await h.fp.gate('u1', false)).toBeNull();
    expect(await h.fp.gate('nobody', false)).toBeNull();
  });

  it('the website gets a step ticket; the app and the extension are told to use the website first', async () => {
    const h = harness();
    const step = await h.fp.gate('u1', true);
    expect(step?.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(step?.expiresAt).toBe(new Date(START + 15 * MIN).toISOString());
    // The ticket never holds the password or its hash.
    const body = Buffer.from(step!.ticket.split('.')[0]!, 'base64url').toString();
    expect(body).not.toContain('Kite');
    expect(body).not.toContain(h.state.passwordHash);
    await expect(h.fp.gate('u1', false)).rejects.toBeInstanceOf(PasswordChangeRequiredError);
  });

  it('an unused temporary password past its lifetime stops working', async () => {
    const h = harness();
    await h.fp.refuseUnusable('u1');
    h.advance(7 * DAY);
    await expect(h.fp.refuseUnusable('u1')).rejects.toBeInstanceOf(TemporaryPasswordExpiredError);
  });

  it('the change: the password rules, not the temporary one, then the mark is gone and the ticket is spent', async () => {
    const h = harness();
    const { ticket } = (await h.fp.gate('u1', true))!;
    await expect(h.fp.change(ticket, 'short1')).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(h.fp.change(ticket, 'Kite-Mango-Fern-Ripple-472')).rejects.toBeInstanceOf(SameAsTemporaryPasswordError);
    expect(await h.fp.change(ticket, 'MyOwnPass99')).toBe('u1');
    expect(h.completed).toEqual([{ userId: 'u1', newHash: 'h:MyOwnPass99' }]);
    expect(h.state.mustChange).toBe(false);
    // Used once: the password it was made for is gone.
    await expect(h.fp.change(ticket, 'AnotherOne77')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
  });

  it('a ticket lasts 15 minutes, is for its account only, and can’t be altered', async () => {
    const h = harness();
    const { ticket } = (await h.fp.gate('u1', true))!;
    const [body, sig] = ticket.split('.');
    const forged = Buffer.from(Buffer.from(body!, 'base64url').toString().replace('u1', 'u2')).toString('base64url');
    await expect(h.fp.change(`${forged}.${sig}`, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    await expect(h.fp.change(`${body}.${sig}x`, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    await expect(h.fp.change('nonsense', 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    // Another server key never accepts it.
    const other = createFirstPassword({ repo: { state: async () => ({ ...h.state }), complete: async () => true }, key: 'other-key', hashPassword, verifyPassword, now: () => new Date(START) });
    await expect(other.change(ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    h.advance(15 * MIN + 1);
    await expect(h.fp.change(ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    expect(h.completed).toEqual([]);
  });

  it('a new temporary password or every sign-in ended (a deactivation, a reset) ends an open step', async () => {
    const h = harness();
    const { ticket } = (await h.fp.gate('u1', true))!;
    h.state.tokenVersion += 1;
    await expect(h.fp.change(ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    const again = (await h.fp.gate('u1', true))!;
    h.state.passwordHash = 'h:Another-Temp-Word-Here-123';
    await expect(h.fp.change(again.ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
    expect(h.completed).toEqual([]);
  });

  it('a deactivated account can’t finish the step', async () => {
    const h = harness();
    const { ticket } = (await h.fp.gate('u1', true))!;
    h.state.active = false;
    await expect(h.fp.change(ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(PasswordChangeExpiredError);
  });

  // Security review (1.23.6) findings 1 and 2.
  it('a cancelled invitation: the password signs nobody in (the same answer as a wrong one)', async () => {
    const h = harness({ cancelled: true, mustChange: false, expiresAt: null });
    await expect(h.fp.refuseUnusable('u1')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('the lifetime is checked again when the step is given after a password sign-in and when it is used', async () => {
    const h = harness({ expiresAt: new Date(START + 10 * MIN) });
    const { ticket } = (await h.fp.gate('u1', true))!;
    h.advance(11 * MIN);
    await expect(h.fp.change(ticket, 'MyOwnPass99')).rejects.toBeInstanceOf(TemporaryPasswordExpiredError);
    await expect(h.fp.gate('u1', true)).rejects.toBeInstanceOf(TemporaryPasswordExpiredError);
    // After an emailed sign-in code (the mailbox is proven) the step is still given, and works.
    const viaCode = (await h.fp.gate('u1', true, { viaEmailCode: true }))!;
    expect(await h.fp.change(viaCode.ticket, 'MyOwnPass99')).toBe('u1');
  });
});
