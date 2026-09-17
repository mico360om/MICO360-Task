import type { KeyValueStore } from './storage';

const KEY = 'mico360.biometricLogin';

/** A remembered credential that biometric login can restore a session from. */
export interface BiometricCredential {
  refreshToken: string;
  /** A label to show on the login button, e.g. the email/username. */
  label?: string;
}

/**
 * Biometric login (A1): stores the refresh token behind the OS keystore so a
 * signed-out user can restore their session with a fingerprint/face instead of
 * re-typing their password. Armed on login when biometrics are enabled; the
 * stored token is valid for the refresh-token lifetime (30 days).
 */
export function createBiometricLogin({ store }: { store: KeyValueStore }) {
  async function arm(refreshToken: string, label?: string): Promise<void> {
    if (!refreshToken) return;
    await store.setItem(KEY, JSON.stringify({ refreshToken, label } satisfies BiometricCredential));
  }

  async function getCredential(): Promise<BiometricCredential | null> {
    try {
      const raw = await store.getItem(KEY);
      return raw ? (JSON.parse(raw) as BiometricCredential) : null;
    } catch {
      return null;
    }
  }

  async function isArmed(): Promise<boolean> {
    return (await getCredential()) !== null;
  }

  async function disarm(): Promise<void> {
    await store.deleteItem(KEY);
  }

  return { arm, getCredential, isArmed, disarm };
}

export type BiometricLogin = ReturnType<typeof createBiometricLogin>;
