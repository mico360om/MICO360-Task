import { describe, it, expect, vi } from 'vitest';
import {
  PASSWORD_RULE_ERROR,
  PASSWORD_RULE_HINT,
  PasswordChangeNotSent,
  checkPasswordChange,
  PASSWORD_WIPE_AFTER_MS,
  createPasswordWipe,
  createChangeGate,
  createPasswordChange,
  isStrongPassword,
  lateOutcomeFor,
  lateOutcomeText,
  passwordChangeProblem,
  refreshRaceOutcome,
  refusedRefreshOutcome,
  settleRefusedRefresh,
} from './password-change';
import { ApiError, NetworkError } from './api-client';
import type { Session } from './types';

describe('password change: the server’s rule, in the website’s words', () => {
  it('needs 8 characters with a letter and a number (the server’s isStrongPassword)', () => {
    expect(isStrongPassword('abcd1234')).toBe(true);
    expect(isStrongPassword('Ab1')).toBe(false);
    expect(isStrongPassword('abcdefgh')).toBe(false);
    expect(isStrongPassword('12345678')).toBe(false);
    expect(PASSWORD_RULE_HINT).toBe('At least 8 characters, with a letter and a number.');
    expect(PASSWORD_RULE_ERROR).toBe('Use at least 8 characters, including a letter and a number.');
  });

  it('checks the form before anything is sent, naming the field to fix', () => {
    expect(checkPasswordChange({ current: '', next: 'abcd1234', confirm: 'abcd1234' })).toEqual({ field: 'current', message: 'Enter your current password.' });
    expect(checkPasswordChange({ current: 'old-pass1', next: 'short1', confirm: 'short1' })).toEqual({ field: 'next', message: PASSWORD_RULE_ERROR });
    expect(checkPasswordChange({ current: 'old-pass1', next: 'abcd1234', confirm: 'abcd1235' })).toEqual({ field: 'confirm', message: 'The new passwords don’t match.' });
    expect(checkPasswordChange({ current: 'old-pass1', next: 'abcd1234', confirm: 'abcd1234' })).toBeNull();
  });

  it('shows the server’s reason for a wrong current password or a weak new one, on the right field', () => {
    expect(passwordChangeProblem(new ApiError(400, 'VALIDATION', 'Current password is incorrect.'))).toEqual({ field: 'current', message: 'Current password is incorrect.' });
    expect(passwordChangeProblem(new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters and include a letter and a number.'))).toEqual({
      field: 'next',
      message: 'Password must be at least 8 characters and include a letter and a number.',
    });
  });

  it('falls back to the website’s message, and says plainly when offline or asked to wait', () => {
    expect(passwordChangeProblem(new ApiError(400, 'ERROR', 'Request failed (400)'))).toEqual({ field: null, message: 'Couldn’t change your password. Check that your current password is correct.' });
    expect(passwordChangeProblem(new ApiError(500, 'INTERNAL', 'Something broke'))).toEqual({ field: null, message: 'Couldn’t change your password. Check that your current password is correct.' });
    expect(passwordChangeProblem(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'))).toEqual({
      field: null,
      message: 'Too many requests. Please wait a moment and try again.',
    });
  });

  it('a change whose answer was lost may have happened: it never says "not changed" then (6a review)', () => {
    const unsure = { field: null, message: 'We couldn’t confirm the change. If you’re asked to sign in, use your new password.', unsure: true };
    expect(passwordChangeProblem(new NetworkError('Network request failed.'))).toEqual(unsure);
    expect(passwordChangeProblem(new NetworkError('The server took too long to respond.', { timedOut: true }))).toEqual(unsure);
  });

  it('only a change that never left the phone (offline before sending) says it can be changed when connected', async () => {
    const { d } = deps();
    const change = createPasswordChange({ ...d, isOnline: () => false });
    const e = await change('old-pass1', 'abcd1234').catch((err: unknown) => err);
    expect(d.send).not.toHaveBeenCalled();
    expect(e).toBeInstanceOf(PasswordChangeNotSent);
    expect(passwordChangeProblem(e)).toEqual({ field: null, message: 'You’re offline — your password can be changed when you’re connected.' });
    await expect(createPasswordChange({ ...d, isOnline: () => true })('old-pass1', 'abcd1234')).resolves.toMatchObject({ keptHere: true });
  });
});

const signedIn = (): Session => ({ user: { id: 'u1', email: 'a@x.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: null }, accessToken: 'old-access', refreshToken: 'old-refresh' });

function deps(opts: { reply?: { accessToken?: string; refreshToken?: string } | null; armed?: boolean; fail?: unknown } = {}) {
  const order: string[] = [];
  let session: Session | null = signedIn();
  const d = {
    send: vi.fn(async () => {
      order.push('send');
      if (opts.fail) throw opts.fail;
      return opts.reply === undefined ? { accessToken: 'new-access', refreshToken: 'new-refresh' } : opts.reply;
    }),
    session: {
      getSession: () => session,
      setSession: vi.fn(async (s: Session) => {
        order.push('setSession');
        session = s;
      }),
    },
    registerPush: vi.fn(async () => {
      order.push(`registerPush:${session?.accessToken}`);
    }),
    fingerprint: {
      isArmed: vi.fn(async () => opts.armed ?? false),
      disarm: vi.fn(async () => {
        order.push('disarm');
      }),
    },
  };
  return { d, order, current: () => session };
}

describe('password change: what happens to the session afterwards (as on the website)', () => {
  it('keeps this phone signed in with the fresh tokens the server hands back, and says other devices were signed out', async () => {
    const { d, current } = deps();
    const result = await createPasswordChange(d)('old-pass1', 'abcd1234');
    expect(d.send).toHaveBeenCalledWith('old-pass1', 'abcd1234');
    expect(current()).toEqual({ ...signedIn(), accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(result).toEqual({ keptHere: true, fingerprintStopped: false, message: 'Password changed. Other devices have been signed out; you’re still signed in here.' });
  });

  it('registers this phone for notifications again with the new session (the server forgets every phone)', async () => {
    const { d, order } = deps();
    await createPasswordChange(d)('old-pass1', 'abcd1234');
    expect(order).toEqual(['send', 'setSession', 'registerPush:new-access']);
  });

  it('turns the ended fingerprint sign-in off on this phone and says how to turn it back on', async () => {
    const { d, order } = deps({ armed: true });
    const result = await createPasswordChange(d)('old-pass1', 'abcd1234');
    expect(order).toContain('disarm');
    expect(result.fingerprintStopped).toBe(true);
    expect(result.message).toBe(
      'Password changed. Other devices have been signed out; you’re still signed in here. Fingerprint sign-in has stopped on this phone; you can turn it back on in Settings.',
    );
  });

  it('when the server hands back no session, says the next sign-in needs the new password', async () => {
    const { d, current } = deps({ reply: {} });
    const result = await createPasswordChange(d)('old-pass1', 'abcd1234');
    expect(d.session.setSession).not.toHaveBeenCalled();
    expect(d.registerPush).not.toHaveBeenCalled();
    expect(current()?.refreshToken).toBe('old-refresh');
    expect(result).toEqual({ keptHere: false, fingerprintStopped: false, message: 'Password changed. You’ll be asked to sign in again with your new password shortly.' });
  });

  it('a refused change leaves the session, the fingerprint key and notifications as they were', async () => {
    const { d, current } = deps({ armed: true, fail: new ApiError(400, 'VALIDATION', 'Current password is incorrect.') });
    await expect(createPasswordChange(d)('wrong-pass1', 'abcd1234')).rejects.toBeInstanceOf(ApiError);
    expect(current()?.refreshToken).toBe('old-refresh');
    expect(d.fingerprint.disarm).not.toHaveBeenCalled();
    expect(d.registerPush).not.toHaveBeenCalled();
  });

  it('a notification sign-up that fails after the change doesn’t turn the change into an error', async () => {
    const { d } = deps();
    d.registerPush.mockRejectedValueOnce(new NetworkError('offline'));
    await expect(createPasswordChange(d)('old-pass1', 'abcd1234')).resolves.toMatchObject({ keptHere: true });
  });
});

const as = (userId: string, refreshToken: string) => ({ refreshToken, user: { id: userId } });

describe('a session refresh refused after this phone already holds a new session', () => {
  it('counts as done when the token it sent was replaced meanwhile (a password change here)', () => {
    expect(refusedRefreshOutcome('invalid', as('u1', 'old-refresh'), as('u1', 'new-refresh'))).toBe('ok');
  });

  it('still ends the session when nothing replaced it, or it is gone', () => {
    expect(refusedRefreshOutcome('invalid', as('u1', 'old-refresh'), as('u1', 'old-refresh'))).toBe('invalid');
    expect(refusedRefreshOutcome('invalid', as('u1', 'old-refresh'), null)).toBe('invalid');
    expect(refusedRefreshOutcome('transient', as('u1', 'old-refresh'), as('u1', 'new-refresh'))).toBe('transient');
  });

  it('never replays one person’s request with someone else’s session (6a review)', () => {
    expect(refusedRefreshOutcome('invalid', as('u1', 'old-refresh'), as('u2', 'their-refresh'))).toBe('changed');
    expect(refreshRaceOutcome(as('u1', 'old-refresh'), as('u2', 'their-refresh'))).toBe('changed');
    expect(refreshRaceOutcome(as('u1', 'old-refresh'), as('u1', 'newer-refresh'))).toBe('ok');
    expect(refreshRaceOutcome(as('u1', 'old-refresh'), null)).toBe('invalid');
  });
});

describe('a refresh refused while a password change is on its way (6a review)', () => {
  it('waits for the change: once its fresh session is kept, the request is tried with it, not signed out', async () => {
    const gate = createChangeGate();
    let held = as('u1', 'old-refresh');
    let answer!: () => void;
    const change = gate.run(
      () =>
        new Promise<void>((resolve) => {
          answer = () => {
            held = as('u1', 'fresh-refresh');
            resolve();
          };
        }),
    );
    expect(gate.busy()).toBe(true);
    const outcome = settleRefusedRefresh('invalid', as('u1', 'old-refresh'), { gate, held: () => held, signingOut: () => false, waitMs: 20_000 });
    answer();
    await change;
    expect(await outcome).toBe('ok');
    expect(gate.busy()).toBe(false);
  });

  it('waits no longer than its limit (the change itself may be waiting on this refresh)', async () => {
    vi.useFakeTimers();
    try {
      const gate = createChangeGate();
      void gate.run(() => new Promise<void>(() => {}));
      const outcome = settleRefusedRefresh('invalid', as('u1', 'old-refresh'), { gate, held: () => as('u1', 'old-refresh'), signingOut: () => false, waitMs: 20_000 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await outcome).toBe('invalid');
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a change on its way it decides at once; signing out ends it', async () => {
    const gate = createChangeGate();
    expect(await settleRefusedRefresh('invalid', as('u1', 'a'), { gate, held: () => as('u1', 'b'), signingOut: () => false, waitMs: 20_000 })).toBe('ok');
    expect(await settleRefusedRefresh('invalid', as('u1', 'a'), { gate, held: () => as('u1', 'b'), signingOut: () => true, waitMs: 20_000 })).toBe('invalid');
    expect(await settleRefusedRefresh('transient', as('u1', 'a'), { gate, held: () => as('u1', 'a'), signingOut: () => false, waitMs: 20_000 })).toBe('transient');
  });

  it('the change runs through the gate, and a sign-out that began meanwhile isn’t undone by it', async () => {
    const gate = createChangeGate();
    const { d, current } = deps();
    let signingOut = false;
    d.send.mockImplementationOnce(async () => {
      expect(gate.busy()).toBe(true);
      signingOut = true;
      return { accessToken: 'new-access', refreshToken: 'new-refresh' };
    });
    const result = await createPasswordChange({ ...d, gate, isSigningOut: () => signingOut })('old-pass1', 'abcd1234');
    expect(d.session.setSession).not.toHaveBeenCalled();
    expect(current()?.refreshToken).toBe('old-refresh');
    expect(result).toEqual({ keptHere: false, fingerprintStopped: false, message: 'Password changed. Sign in again with your new password.' });
    expect(gate.busy()).toBe(false);
  });
});

describe('the password fields don’t outlive their use (6a review)', () => {
  it('stay while you copy a password from a password manager; are emptied after a minute away (5b review #8)', () => {
    let now = 0;
    const wipe = createPasswordWipe({ afterMs: PASSWORD_WIPE_AFTER_MS, now: () => now });
    // Off to the password manager and back within a minute: kept.
    expect(wipe.onAppState('inactive')).toBe(false);
    expect(wipe.onAppState('background')).toBe(false);
    now = 20_000;
    expect(wipe.onAppState('active')).toBe(false);
    // Away for longer: emptied on the way back.
    now = 30_000;
    expect(wipe.onAppState('background')).toBe(false);
    now = 30_000 + PASSWORD_WIPE_AFTER_MS;
    expect(wipe.onAppState('active')).toBe(true);
    expect(PASSWORD_WIPE_AFTER_MS).toBe(60_000);
    // Coming back active without having left: nothing to wipe.
    expect(wipe.onAppState('active')).toBe(false);
  });

  it('a change that finishes after the screen was left still says how it went', () => {
    expect(lateOutcomeText({ ok: true, result: { keptHere: true, fingerprintStopped: false, message: 'Password changed. Other devices have been signed out; you’re still signed in here.' } })).toBe(
      'Password changed. Other devices have been signed out; you’re still signed in here.',
    );
    expect(lateOutcomeText({ ok: false, error: new ApiError(400, 'VALIDATION', 'Current password is incorrect.') })).toBe('Your password wasn’t changed: Current password is incorrect.');
    expect(lateOutcomeText({ ok: false, error: new NetworkError('lost') })).toBe('We couldn’t confirm the change. If you’re asked to sign in, use your new password.');
  });
});

describe('a password change whose answer comes after someone else signed in (5b review #1)', () => {
  it('never stores the first person’s fresh tokens under the second person: nothing of theirs changes, and the fresh token is revoked', async () => {
    const { d, current } = deps({ armed: true });
    const revoke = vi.fn(async () => {});
    const bee: Session = { user: { id: 'u2', email: 'b@x.test', username: 'bee', roles: ['EMPLOYEE'], avatarUrl: null }, accessToken: 'b-access', refreshToken: 'b-refresh' };
    // A taps Change password; while it is on its way A signs out and B signs in.
    d.send.mockImplementationOnce(async () => {
      await d.session.setSession(bee);
      return { accessToken: 'a-fresh-access', refreshToken: 'a-fresh-refresh' };
    });
    d.session.setSession.mockClear();
    const result = await createPasswordChange({ ...d, revoke })('old-pass1', 'abcd1234');
    expect(current()).toEqual(bee);
    expect(d.session.setSession).toHaveBeenCalledTimes(1); // only B's own sign-in
    expect(d.registerPush).not.toHaveBeenCalled();
    expect(d.fingerprint.disarm).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('a-fresh-refresh');
    expect(result).toEqual({ keptHere: false, fingerprintStopped: false, message: null });
  });

  it('a fresh session that isn’t kept (a sign-out under way) is revoked too', async () => {
    const { d } = deps();
    const revoke = vi.fn(async () => {});
    let signingOut = false;
    d.send.mockImplementationOnce(async () => {
      signingOut = true;
      return { accessToken: 'new-access', refreshToken: 'new-refresh' };
    });
    await createPasswordChange({ ...d, revoke, isSigningOut: () => signingOut })('old-pass1', 'abcd1234');
    expect(revoke).toHaveBeenCalledWith('new-refresh');
  });

  it('the same person still gets the fresh session, and nothing is revoked', async () => {
    const { d, current } = deps();
    const revoke = vi.fn(async () => {});
    await createPasswordChange({ ...d, revoke })('old-pass1', 'abcd1234');
    expect(current()?.refreshToken).toBe('new-refresh');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('nothing is said to the next person about the first person’s change', () => {
    expect(lateOutcomeText({ ok: true, result: { keptHere: false, fingerprintStopped: false, message: null } })).toBeNull();
  });
});

describe('a late outcome is told only to the person who asked (5b review #1)', () => {
  it('says nothing once someone else is signed in; says it on the sign-in screen (nobody) or to the same person', () => {
    const lost = { ok: false as const, error: new ApiError(400, 'VALIDATION', 'Current password is incorrect.') };
    expect(lateOutcomeFor(lost, 'u1', 'u2')).toBeNull();
    expect(lateOutcomeFor(lost, 'u1', null)).toBe('Your password wasn’t changed: Current password is incorrect.');
    expect(lateOutcomeFor(lost, 'u1', 'u1')).toBe('Your password wasn’t changed: Current password is incorrect.');
    const done = { ok: true as const, result: { keptHere: false, fingerprintStopped: false, message: 'Password changed. Sign in again with your new password.' } };
    expect(lateOutcomeFor(done, 'u1', 'u2')).toBeNull();
    expect(lateOutcomeFor(done, 'u1', null)).toBe('Password changed. Sign in again with your new password.');
  });
});

describe('closing an unused fresh session never holds the refresh gate (4b review #15)', () => {
  it('the change ends (and the gate frees) while the revoke is still on its way', async () => {
    const { d } = deps();
    let signingOut = false;
    d.send.mockImplementationOnce(async () => {
      signingOut = true;
      return { accessToken: 'new-access', refreshToken: 'new-refresh' };
    });
    // A revoke that never answers (a hanging connection).
    const revoke = vi.fn(() => new Promise<void>(() => {}));
    const gate = createChangeGate();
    const done = createPasswordChange({ ...d, revoke, gate, isSigningOut: () => signingOut })('old-pass1', 'abcd1234');
    const result = await Promise.race([done.then(() => 'ended'), new Promise((r) => setTimeout(() => r('held'), 50))]);
    expect(result).toBe('ended');
    expect(revoke).toHaveBeenCalledWith('new-refresh');
  });
});
