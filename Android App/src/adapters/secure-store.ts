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
