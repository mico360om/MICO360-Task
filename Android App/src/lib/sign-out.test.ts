import { describe, it, expect, vi } from 'vitest';
import { createSignOut, type SignOutDeps } from './sign-out';
import type { Session } from './types';

const session = (refreshToken = 'rt-1'): Session => ({
  user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] },
  accessToken: 'at',
  refreshToken,
});

function setup(over: Partial<SignOutDeps> = {}) {
  const log: string[] = [];
  let current: Session | null = session();
  const deps: SignOutDeps = {
    getSession: () => current,
    revokeRefreshToken: vi.fn(async (t: string) => void log.push(`logout:${t}`)),
    unregisterPush: vi.fn(async () => void log.push(`push(token=${current?.accessToken ?? 'none'})`)),
    disarmBiometricLogin: vi.fn(async () => void log.push('biometric')),
    clearSession: vi.fn(async () => {
      log.push('session');
      current = null;
    }),
    clearQueryCache: vi.fn(() => void log.push('queries')),
    clearReadCache: vi.fn(async () => void log.push('read-cache')),
    clearQueuedChanges: vi.fn(async (u: string) => void log.push(`queue:${u}`)),
    networkTimeoutMs: 50,
    ...over,
  };
  return {
    deps,
    log,
    setSession: (s: Session | null) => {
      current = s;
    },
    signOut: createSignOut(deps),
  };
}

describe('createSignOut — the single sign-out routine (XP-01 / MOB-01 / MOB-11 / XP-02)', () => {
  it('explicit sign-out: unregisters push while still authenticated, revokes, disarms, then clears everything', async () => {
    const { log, signOut } = setup();
    await signOut.signOut('user');
    expect(log).toEqual([
      'push(token=at)', // before the session is cleared — the DELETE still carries a token
      'logout:rt-1',
      'biometric',
      'session',
      'queries',
      'read-cache',
      'queue:u1',
    ]);
  });

  it('expired session: no network calls, disarms and clears caches, but KEEPS the user’s queued changes', async () => {
    const { deps, log, signOut } = setup();
    await signOut.signOut('expired');
    expect(deps.revokeRefreshToken).not.toHaveBeenCalled();
    expect(deps.unregisterPush).not.toHaveBeenCalled();
    expect(log).toEqual(['biometric', 'session', 'queries', 'read-cache']);
    expect(deps.clearQueuedChanges).not.toHaveBeenCalled();
  });

  it('lock-screen sign-out revokes the session but keeps the owner’s queued changes', async () => {
    const { deps, log, signOut } = setup();
    await signOut.signOut('lock');
    expect(log).toEqual(['push(token=at)', 'logout:rt-1', 'biometric', 'session', 'queries', 'read-cache']);
    expect(deps.clearQueuedChanges).not.toHaveBeenCalled();
  });

  it('finishes the local clean-up even when the network steps fail (offline)', async () => {
    const { deps, log, signOut } = setup({
      unregisterPush: vi.fn(async () => {
        throw new Error('offline');
      }),
      revokeRefreshToken: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const onStepError = vi.fn();
    deps.onStepError = onStepError;
    await signOut.signOut('user');
    expect(log).toEqual(['biometric', 'session', 'queries', 'read-cache', 'queue:u1']);
    expect(onStepError).toHaveBeenCalledWith('push', expect.any(Error));
  });

  it('does not hang when a network step never answers', async () => {
    const { deps, signOut } = setup({ revokeRefreshToken: vi.fn(() => new Promise<never>(() => {})) });
    await signOut.signOut('user');
    expect(deps.clearSession).toHaveBeenCalled();
  });

  it('shares one run between concurrent callers', async () => {
    const { deps, signOut } = setup();
    await Promise.all([signOut.signOut('user'), signOut.signOut('expired'), signOut.signOut('user')]);
    expect(deps.clearSession).toHaveBeenCalledTimes(1);
    expect(signOut.isSigningOut()).toBe(false);
  });

  it('revokes a token that a silent refresh rotated in during sign-out', async () => {
    const h = setup();
    h.deps.revokeRefreshToken = vi.fn(async (t: string) => {
      h.log.push(`logout:${t}`);
      if (t === 'rt-1') h.setSession(session('rt-2')); // refresh landed right after the revoke
    });
    await createSignOut(h.deps).signOut('user');
    expect(h.log.filter((l) => l.startsWith('logout'))).toEqual(['logout:rt-1', 'logout:rt-2']);
  });

  it('still clears local state when nobody is signed in', async () => {
    const h = setup();
    h.setSession(null);
    await h.signOut.signOut('user');
    expect(h.deps.revokeRefreshToken).not.toHaveBeenCalled();
    expect(h.log).toEqual(['biometric', 'session', 'queries', 'read-cache']);
  });
});
