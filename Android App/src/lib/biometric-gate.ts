import type { KeyValueStore } from './storage';

const BIOMETRIC_KEY = 'mico360.biometric';

export interface BiometricGateDeps {
  /** Hardware present AND a biometric enrolled (wraps expo-local-authentication). */
  isAvailable: () => Promise<boolean>;
  /** Present the OS biometric prompt; resolves true on success. */
  authenticate: () => Promise<boolean>;
  store: KeyValueStore;
}

export type UnlockReason = 'disabled' | 'unavailable' | 'failed';
export interface UnlockResult {
  ok: boolean;
  reason?: UnlockReason;
}

/**
 * Optional biometric app-unlock (A1). The user opts in (only possible when
 * hardware is available); once enabled, `unlock()` gates the app behind the OS
 * biometric prompt. If the hardware later disappears, unlock fails as
 * `unavailable` so the app falls back to password login rather than locking out.
 */
export function createBiometricGate({ isAvailable, authenticate, store }: BiometricGateDeps) {
  async function isEnabled(): Promise<boolean> {
    return (await store.getItem(BIOMETRIC_KEY)) === '1';
  }

  async function setEnabled(on: boolean): Promise<void> {
    if (on) {
      if (!(await isAvailable())) throw new Error('Biometrics unavailable on this device.');
      await store.setItem(BIOMETRIC_KEY, '1');
    } else {
      await store.deleteItem(BIOMETRIC_KEY);
    }
  }

  async function unlock(): Promise<UnlockResult> {
    if (!(await isEnabled())) return { ok: true, reason: 'disabled' };
    if (!(await isAvailable())) return { ok: false, reason: 'unavailable' };
    const ok = await authenticate();
    return ok ? { ok: true } : { ok: false, reason: 'failed' };
  }

  return { isEnabled, setEnabled, unlock };
}

export type BiometricGate = ReturnType<typeof createBiometricGate>;
