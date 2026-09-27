import type { KeyValueStore } from './storage';
import type { DevicePlatform } from './types';

const PUSH_TOKEN_KEY = 'mico360.pushToken';

export interface PushRegistrarDeps {
  /** Resolve the device's push token (wraps expo-notifications); null if unavailable/denied. */
  getPushToken: () => Promise<string | null>;
  registerToken: (token: string, platform: DevicePlatform) => Promise<unknown>;
  unregisterToken: (token: string) => Promise<unknown>;
  store: KeyValueStore;
  platform?: DevicePlatform;
}

export interface RegisterResult {
  token: string | null;
  /** True when the token was sent to the API. */
  registered: boolean;
}

/**
 * Registers this device's push token with the API and removes it on sign-out (A6, NTF-01, MOB-11).
 *
 * - `register()` always POSTs the token — on every launch while signed in, on sign-in, and when
 *   the OS rotates the token (pass the new token in). The server re-assigns a token that was
 *   registered to a previous user, so a shared phone never keeps delivering user A's
 *   notifications to user B. (Skipping "unchanged" tokens was exactly what left A registered.)
 * - `unregister()` must be awaited BEFORE the session is cleared (it needs the access token), and
 *   it always forgets the local record, even when the server call fails.
 */
export function createPushRegistrar(deps: PushRegistrarDeps) {
  const { getPushToken, registerToken, unregisterToken, store } = deps;
  const platform = deps.platform ?? 'ANDROID';

  async function register(rotatedToken?: string | null): Promise<RegisterResult> {
    const token = rotatedToken || (await getPushToken());
    if (!token) return { token: null, registered: false };
    await registerToken(token, platform);
    await store.setItem(PUSH_TOKEN_KEY, token).catch(() => {});
    return { token, registered: true };
  }

  async function unregister(): Promise<void> {
    const last = await store.getItem(PUSH_TOKEN_KEY).catch(() => null);
    if (!last) return;
    try {
      await unregisterToken(last);
    } finally {
      await store.deleteItem(PUSH_TOKEN_KEY).catch(() => {});
    }
  }

  return { register, unregister, lastToken: () => store.getItem(PUSH_TOKEN_KEY) };
}

export type PushRegistrar = ReturnType<typeof createPushRegistrar>;
