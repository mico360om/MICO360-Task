import { describe, it, expect, vi } from 'vitest';
import { forgetPreviousUser, type UserSwitchDeps } from './user-switch';

function deps(state: { keyOwner?: string; armed?: boolean; lockOn?: boolean }) {
  const d: UserSwitchDeps = {
    getKeyOwner: vi.fn(async () => state.keyOwner),
    isKeyArmed: vi.fn(async () => state.armed ?? Boolean(state.keyOwner)),
    disarmKey: vi.fn(async () => {}),
    isLockOn: vi.fn(async () => state.lockOn ?? false),
    turnLockOff: vi.fn(async () => {}),
  };
  return d;
}

describe('forgetPreviousUser — the phone’s fingerprint sign-in and lock belong to one person', () => {
  it('the same person signing in again keeps both', async () => {
    const d = deps({ keyOwner: 'u1', lockOn: true });
    await forgetPreviousUser('u1', d);
    expect(d.disarmKey).not.toHaveBeenCalled();
    expect(d.turnLockOff).not.toHaveBeenCalled();
  });

  it('someone else signing in turns off the previous person’s fingerprint sign-in and lock', async () => {
    const d = deps({ keyOwner: 'u1', lockOn: true });
    await forgetPreviousUser('u2', d);
    expect(d.disarmKey).toHaveBeenCalled();
    expect(d.turnLockOff).toHaveBeenCalled();
  });

  it('a lock with no known owner (older build) is turned off for whoever signs in', async () => {
    const d = deps({ lockOn: true });
    await forgetPreviousUser('u2', d);
    expect(d.turnLockOff).toHaveBeenCalled();
    expect(d.disarmKey).not.toHaveBeenCalled();
  });

  it('a key with no known owner (older build) is forgotten', async () => {
    const d = deps({ armed: true });
    await forgetPreviousUser('u2', d);
    expect(d.disarmKey).toHaveBeenCalled();
  });

  it('nothing set: nothing happens', async () => {
    const d = deps({});
    await forgetPreviousUser('u2', d);
    expect(d.disarmKey).not.toHaveBeenCalled();
    expect(d.turnLockOff).not.toHaveBeenCalled();
  });
});
