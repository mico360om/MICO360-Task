import { describe, it, expect, vi } from 'vitest';
import { forgetPreviousUser, LAST_USER_KEY, type UserSwitchDeps } from './user-switch';
import { createMemoryStore } from './storage';

function deps(state: { keyOwner?: string; armed?: boolean; lockOn?: boolean; lastUser?: string }) {
  const store = createMemoryStore(state.lastUser ? { [LAST_USER_KEY]: state.lastUser } : {});
  const d: UserSwitchDeps & { store: typeof store } = {
    store,
    lastUserStore: store,
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
    const d = deps({ keyOwner: 'u1', lastUser: 'u1', lockOn: true });
    await forgetPreviousUser('u1', d);
    expect(d.disarmKey).not.toHaveBeenCalled();
    expect(d.turnLockOff).not.toHaveBeenCalled();
  });

  it('someone else signing in turns off the previous person’s fingerprint sign-in and lock', async () => {
    const d = deps({ keyOwner: 'u1', lastUser: 'u1', lockOn: true });
    await forgetPreviousUser('u2', d);
    expect(d.disarmKey).toHaveBeenCalled();
    expect(d.turnLockOff).toHaveBeenCalled();
  });

  it('the same person keeps their lock after their fingerprint key was forgotten (password changed, key expired)', async () => {
    const d = deps({ lastUser: 'u1', lockOn: true });
    await forgetPreviousUser('u1', d);
    expect(d.turnLockOff).not.toHaveBeenCalled();
  });

  it('remembers who signed in, so the next person is compared with them', async () => {
    const d = deps({ lastUser: 'u1', lockOn: true });
    await forgetPreviousUser('u2', d);
    expect(await d.store.getItem(LAST_USER_KEY)).toBe('u2');
  });

  it('with no one remembered (first sign-in after updating from 1.2.0) the lock is kept', async () => {
    const d = deps({ lockOn: true });
    await forgetPreviousUser('u2', d);
    expect(d.turnLockOff).not.toHaveBeenCalled();
    expect(await d.store.getItem(LAST_USER_KEY)).toBe('u2');
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

  it('a phone-storage error never stops the sign-in, and the other steps still run', async () => {
    const d = deps({ keyOwner: 'u1', lastUser: 'u1', lockOn: true });
    d.disarmKey = vi.fn(async () => {
      throw new Error('keystore unavailable');
    });
    await expect(forgetPreviousUser('u2', d)).resolves.toBeUndefined();
    expect(d.turnLockOff).toHaveBeenCalled();
    expect(await d.store.getItem(LAST_USER_KEY)).toBe('u2');
  });

  it('even when reading the key or the lock fails', async () => {
    const d = deps({ lastUser: 'u1' });
    d.getKeyOwner = vi.fn(async () => {
      throw new Error('keystore unavailable');
    });
    d.isLockOn = vi.fn(async () => {
      throw new Error('keystore unavailable');
    });
    await expect(forgetPreviousUser('u2', d)).resolves.toBeUndefined();
  });
});
