import type { KeyValueStore } from './storage';

const SECRET_KEY = 'mico360.biometricLogin';
const MARKER_KEY = 'mico360.biometricLogin.armed';

/** A remembered credential that biometric login can restore a session from. */
export interface BiometricCredential {
  refreshToken: string;
  /** A label to show on the login button, e.g. the email/username. */
  label?: string;
}

export interface BiometricLoginDeps {
  /**
   * Holds the refresh token. In the app this is SecureStore with `requireAuthentication: true`:
   * the keystore key only unlocks after a strong (Class 3) biometric match — no device PIN — so
   * reading or writing it shows the OS biometric prompt (MOB-01).
   */
  secretStore: KeyValueStore;
  /** Holds only the non-secret "armed" marker + label, readable without a prompt. */
  markerStore: KeyValueStore;
}

/**
 * Biometric login (A1): a fingerprint sign-in key behind a biometric-bound keystore key, so a
 * signed-out user can sign in again with a fingerprint instead of re-typing their password.
 *
 * The key comes from POST /auth/biometric-credential: a refresh token marked for fingerprint
 * sign-in, in a rotation family of its own. Silent session refreshes never spend it and signing in
 * with it (/auth/biometric-sign-in) doesn't either, so it survives sign-outs and keeps working until
 * the user turns it off, signs in as someone else, changes their password or an admin resets it.
 *
 * Security rules (MOB-01):
 * - the key is only ever readable behind the strong-biometric prompt;
 * - it is never re-written silently in the background (a write would need a biometric prompt), so
 *   it is armed only while the user is present — when they switch the feature on in Settings;
 * - a sign-in as a different user disarms it.
 */
export function createBiometricLogin({ secretStore, markerStore }: BiometricLoginDeps) {
  async function arm(refreshToken: string, label?: string, userId?: string): Promise<void> {
    if (!refreshToken) return;
    await secretStore.setItem(SECRET_KEY, JSON.stringify({ refreshToken, label } satisfies BiometricCredential));
    await markerStore.setItem(MARKER_KEY, JSON.stringify({ label: label ?? null, userId: userId ?? null }));
  }

  /** Whose key it is (a sign-in as anyone else disarms it). Never prompts. */
  async function getUserId(): Promise<string | undefined> {
    try {
      const raw = await markerStore.getItem(MARKER_KEY);
      const id = raw ? (JSON.parse(raw) as { userId?: unknown }).userId : undefined;
      return typeof id === 'string' && id ? id : undefined;
    } catch {
      return undefined;
    }
  }

  /** Is a credential remembered? Never prompts. */
  async function isArmed(): Promise<boolean> {
    try {
      return (await markerStore.getItem(MARKER_KEY)) !== null;
    } catch {
      return false;
    }
  }

  /** The label for the "Sign in with biometrics (…)" button. Never prompts. */
  async function getLabel(): Promise<string | undefined> {
    try {
      const raw = await markerStore.getItem(MARKER_KEY);
      const label = raw ? (JSON.parse(raw) as { label?: unknown }).label : undefined;
      return typeof label === 'string' && label ? label : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Read the credential. With the biometric-bound store this shows the strong-biometric prompt;
   * resolves null when the user cancels, the key was invalidated (fingerprints changed) or nothing
   * is stored — in which case the remembered sign-in is forgotten.
   */
  async function getCredential(): Promise<BiometricCredential | null> {
    let raw: string | null = null;
    try {
      raw = await secretStore.getItem(SECRET_KEY);
    } catch {
      return null; // cancelled / failed prompt — keep it armed so the user can try again
    }
    if (!raw) {
      await disarm(); // invalidated by a biometric enrollment change, or never stored
      return null;
    }
    try {
      const cred = JSON.parse(raw) as BiometricCredential;
      return cred.refreshToken ? cred : null;
    } catch {
      await disarm();
      return null;
    }
  }

  async function disarm(): Promise<void> {
    await Promise.all([
      secretStore.deleteItem(SECRET_KEY).catch(() => {}),
      markerStore.deleteItem(MARKER_KEY).catch(() => {}),
      // Builds before MOB-01 kept the token WITHOUT biometric binding under this key in the
      // ordinary keystore — make sure no such copy survives.
      markerStore.deleteItem(SECRET_KEY).catch(() => {}),
    ]);
  }

  /** One-time cleanup of the unprotected credential older builds stored (call at start-up). */
  async function purgeLegacy(): Promise<void> {
    await markerStore.deleteItem(SECRET_KEY).catch(() => {});
  }

  return { arm, isArmed, getLabel, getUserId, getCredential, disarm, purgeLegacy };
}

export type BiometricLogin = ReturnType<typeof createBiometricLogin>;
