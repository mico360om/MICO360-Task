import type { KeyValueStore } from './storage';
import type { DevicePlatform } from './types';

const PUSH_TOKEN_KEY = 'mico360.pushToken';

export interface PushRegistrarDeps {
  /** Resolve the device's push token (wraps expo-notifications); null if unavailable/denied. */
  getPushToken: () => Promise<string | null>;
  registerToken: (token: string, platform: DevicePlatform) => Promise<void>;
  unregisterToken: (token: string) => Promise<void>;
  store: KeyValueStore;
  platform?: DevicePlatform;
}

export interface RegisterResult {
  token: string | null;
  /** True when a POST was actually made (new or rotated token). */
  registered: boolean;
}

/**
 * Registers this device's push token with the API on login and clears it on
 * logout (A6). It remembers the last token it sent so an unchanged token is not
 * re-POSTed, and only re-registers when the token rotates.
 */
export function createPushRegistrar(deps: PushRegistrarDeps) {
  const { getPushToken, registerToken, unregisterToken, store } = deps;
  const platform = deps.platform ?? 'ANDROID';

  async function register(): Promise<RegisterResult> {
    const token = await getPushToken();
    if (!token) return { token: null, registered: false };

    const last = await store.getItem(PUSH_TOKEN_KEY);
    if (last === token) return { token, registered: false };

    await registerToken(token, platform);
    await store.setItem(PUSH_TOKEN_KEY, token);
    return { token, registered: true };
  }

  async function unregister(): Promise<void> {
    const last = await store.getItem(PUSH_TOKEN_KEY);
    if (!last) return;
    await unregisterToken(last);
    await store.deleteItem(PUSH_TOKEN_KEY);
  }

  return { register, unregister };
}

export type PushRegistrar = ReturnType<typeof createPushRegistrar>;
