import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from '../lib/storage';

/** KeyValueStore backed by the OS keystore (expo-secure-store) — used for the auth session/tokens. */
export const secureStore: KeyValueStore = {
  async getItem(key) {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Keystore entries bound to biometric authentication (MOB-01): `requireAuthentication: true`
 * generates a key that only unlocks after a strong (Class 3) biometric match via BiometricPrompt —
 * the device PIN cannot unlock it — and the key is invalidated when new biometrics are enrolled.
 * Reading and writing show the OS prompt, so this store is only used while the user is present.
 * A dedicated keychainService keeps it apart from the ordinary (non-biometric) entries.
 */
const BIOMETRIC_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'mico360.biometric-login',
  requireAuthentication: true,
  authenticationPrompt: 'Confirm your fingerprint to sign in to MICO360 Tasks',
};

export const biometricSecureStore: KeyValueStore = {
  async getItem(key) {
    return SecureStore.getItemAsync(key, BIOMETRIC_OPTIONS);
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(key, value, BIOMETRIC_OPTIONS);
  },
  async deleteItem(key) {
    await SecureStore.deleteItemAsync(key, BIOMETRIC_OPTIONS);
  },
};

/** Can this device hold biometric-bound keystore entries (strong biometrics enrolled)? */
export function canUseBiometricKeystore(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}
