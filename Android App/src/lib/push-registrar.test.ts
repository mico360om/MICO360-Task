import { describe, it, expect, vi } from 'vitest';
import { createPushRegistrar } from './push-registrar';
import { createMemoryStore } from './storage';

const deps = (over: Partial<Parameters<typeof createPushRegistrar>[0]> = {}) => ({
  getPushToken: vi.fn(async () => 'expo-token-1' as string | null),
  registerToken: vi.fn(async () => {}),
  unregisterToken: vi.fn(async () => {}),
  store: createMemoryStore(),
  ...over,
});

describe('createPushRegistrar (A6 push registration)', () => {
  it('registers the device push token and remembers it', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    const res = await r.register();
    expect(res).toEqual({ token: 'expo-token-1', registered: true });
    expect(o.registerToken).toHaveBeenCalledWith('expo-token-1', 'ANDROID');
    expect(await o.store.getItem('mico360.pushToken')).toBe('expo-token-1');
  });

  it('does not re-POST an unchanged token', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.register();
    const res = await r.register();
    expect(res.registered).toBe(false);
    expect(o.registerToken).toHaveBeenCalledTimes(1);
  });

  it('re-registers when the token has rotated', async () => {
    const getPushToken = vi.fn().mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    const o = deps({ getPushToken });
    const r = createPushRegistrar(o);
    await r.register();
    const res = await r.register();
    expect(res).toEqual({ token: 't2', registered: true });
    expect(o.registerToken).toHaveBeenCalledTimes(2);
    expect(o.registerToken).toHaveBeenLastCalledWith('t2', 'ANDROID');
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

  it('unregister with nothing remembered is a no-op', async () => {
    const o = deps();
    const r = createPushRegistrar(o);
    await r.unregister();
    expect(o.unregisterToken).not.toHaveBeenCalled();
  });
});
