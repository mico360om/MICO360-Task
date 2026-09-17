/**
 * A minimal async key/value store. Real adapters wrap `expo-secure-store` (for
 * the auth session/tokens) and `@react-native-async-storage/async-storage` (for
 * the offline cache); tests inject an in-memory implementation.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async deleteItem(key) {
      data.delete(key);
    },
  };
}
