import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '../lib/storage';

/** KeyValueStore backed by AsyncStorage — used for the offline read cache and mutation queue. */
export const asyncStore: KeyValueStore = {
  async getItem(key) {
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    await AsyncStorage.setItem(key, value);
  },
  async deleteItem(key) {
    await AsyncStorage.removeItem(key);
  },
};
