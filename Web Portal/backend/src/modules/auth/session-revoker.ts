/**
 * Ending every way a person is signed in — after a password change or reset, an administrator's reset,
 * a deactivation, a deletion or a role change (the user service and the password-reset service call
 * it, after the account change is saved and its token version raised).
 *
 * Review fixes (13 Nov 2026):
 * - #33: their unused emailed codes end too — open sign-in challenges and the emailed-code sign-in's
 *   login codes (before, only the challenges), so a code mailed a minute earlier no longer signs in.
 * - N1: the sign-in check forgets what it knew of the account (its 10-second cache), so an access
 *   token the change revoked is refused on its very next request, not up to 10 seconds later.
 */
export interface SessionRevokerDeps {
  /** Revoke every refresh token (and fingerprint key) of the person. */
  revokeTokens: (userId: string) => Promise<void>;
  /** End every emailed code they could still sign in with. */
  endCodes: (userId: string) => Promise<void>;
  /** Drop the sign-in check's cached account state (auth-guard `forgetUser`). */
  forgetAccountState: (userId: string) => void;
  onError?: (err: unknown, what: string, userId: string) => void;
}

export function createSessionRevoker({ revokeTokens, endCodes, forgetAccountState, onError }: SessionRevokerDeps) {
  return async function revokeSessions(userId: string): Promise<void> {
    try {
      await revokeTokens(userId);
      try {
        await endCodes(userId);
      } catch (err) {
        // Codes last 10 minutes and need an active account: logged, never undoing the revoke.
        onError?.(err, 'ending the emailed sign-in codes', userId);
      }
    } finally {
      // Whatever happened above, the account change itself is saved already: read it again next time.
      forgetAccountState(userId);
    }
  };
}
