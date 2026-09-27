import { describe, it, expect, vi } from 'vitest';
import { createPushRegistrar } from './push-registrar';
import { createMemoryStore } from './storage';

const deps = (over: Partial<Parameters<typeof createPushRegistrar>[0]> = {}) => ({
  getPushToken: vi.fn(async () => 'expo-token-1' as string | null),
  registerToken: vi.fn(async (_token: string, _platform: string) => {}),
  unregisterToken: vi.fn(async (_token: string) => {}),
  store: createMemoryStore(),
  ...over,
});

describe('createPushRegistrar (A6 push registration / NTF-01 / MOB-11)', () => {
  it('registers the device push token and remembers it', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    const res = await r.register();
    expect(res).toEqual({ token: 'expo-token-1', registered: true });
    expect(o.registerToken).toHaveBeenCalledWith('expo-token-1', 'ANDROID');
    expect(await o.store.getItem('mico360.pushToken')).toBe('expo-token-1');
  });

  it('re-registers an unchanged token on every launch / sign-in so the server assigns it to the current user', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.register(); // user A
    const res = await r.register(); // next launch, or user B signing in on the same phone
    expect(res.registered).toBe(true);
    expect(o.registerToken).toHaveBeenCalledTimes(2);
  });

  it('registers a rotated token handed over by the OS token listener', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.register('rotated-2');
    expect(o.getPushToken).not.toHaveBeenCalled();
    expect(o.registerToken).toHaveBeenLastCalledWith('rotated-2', 'ANDROID');
    expect(await o.store.getItem('mico360.pushToken')).toBe('rotated-2');
  });

  it('no-ops when permission yields no token', async () => {
    const o = deps({ getPushToken: vi.fn(async () => null) });
    const r = createPushRegistrar(o);
    const res = await r.register();
    expect(res).toEqual({ token: null, registered: false });
    expect(o.registerToken).not.toHaveBeenCalled();
  });

  it('unregisters the remembered token and forgets it (logout)', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.register();
    await r.unregister();
    expect(o.unregisterToken).toHaveBeenCalledWith('expo-token-1');
    expect(await o.store.getItem('mico360.pushToken')).toBeNull();
  });

  it('forgets the local record even when the server call fails (offline sign-out)', async () => {
    const o = deps({
      unregisterToken: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const r = createPushRegistrar(o);
    await r.register();
    await expect(r.unregister()).rejects.toThrow('offline');
    expect(await o.store.getItem('mico360.pushToken')).toBeNull();
  });

  it('unregister with nothing remembered is a no-op', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.unregister();
    expect(o.unregisterToken).not.toHaveBeenCalled();
  });
});
