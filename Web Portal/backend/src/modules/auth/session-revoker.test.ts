import { describe, it, expect } from 'vitest';
import { createSessionRevoker } from './session-revoker';

// Review fixes N1 and #33 (13 Nov 2026): ending someone's sessions (a password change or reset, an
// administrator's reset, a deactivation, a deletion, a role change) also ends their unused emailed
// sign-in codes, and the sign-in check forgets what it knew of the account at once (not 10 s later).
function make(fail: { tokens?: boolean; codes?: boolean } = {}) {
  const steps: string[] = [];
  const errors: string[] = [];
  const revoke = createSessionRevoker({
    revokeTokens: async (id) => {
      steps.push(`tokens ${id}`);
      if (fail.tokens) throw new Error('db down');
    },
    endCodes: async (id) => {
      steps.push(`codes ${id}`);
      if (fail.codes) throw new Error('db down');
    },
    forgetAccountState: (id) => void steps.push(`forget ${id}`),
    onError: (_err, what, id) => void errors.push(`${what} ${id}`),
  });
  return { revoke, steps, errors };
}

describe('createSessionRevoker', () => {
  it('ends the refresh tokens, every emailed code (challenges and login codes), then forgets the cached account', async () => {
    const { revoke, steps } = make();
    await revoke('u1');
    expect(steps).toEqual(['tokens u1', 'codes u1', 'forget u1']);
  });

  it('codes that can’t be ended are logged, never undo the revoke; the account is still forgotten', async () => {
    const { revoke, steps, errors } = make({ codes: true });
    await expect(revoke('u1')).resolves.toBeUndefined();
    expect(steps).toEqual(['tokens u1', 'codes u1', 'forget u1']);
    expect(errors).toEqual(['ending the emailed sign-in codes u1']);
  });

  it('a token failure is the caller’s error (as before), and the cached account is forgotten anyway', async () => {
    const { revoke, steps } = make({ tokens: true });
    await expect(revoke('u1')).rejects.toThrow('db down');
    expect(steps).toEqual(['tokens u1', 'forget u1']);
  });
});
