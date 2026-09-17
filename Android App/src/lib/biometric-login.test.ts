import { describe, it, expect } from 'vitest';
import { createBiometricLogin } from './biometric-login';
import type { KeyValueStore } from './storage';

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    async getItem(k) { return m.get(k) ?? null; },
    async setItem(k, v) { m.set(k, v); },
    async deleteItem(k) { m.delete(k); },
  };
}

describe('createBiometricLogin', () => {
  it('is not armed initially', async () => {
    const bl = createBiometricLogin({ store: memStore() });
    expect(await bl.isArmed()).toBe(false);
    expect(await bl.getCredential()).toBeNull();
  });

  it('arms with a refresh token + label and reads it back', async () => {
    const bl = createBiometricLogin({ store: memStore() });
    await bl.arm('refresh-abc', 'ada@x.co');
    expect(await bl.isArmed()).toBe(true);
    expect(await bl.getCredential()).toEqual({ refreshToken: 'refresh-abc', label: 'ada@x.co' });
  });

  it('ignores an empty refresh token', async () => {
    const bl = createBiometricLogin({ store: memStore() });
    await bl.arm('');
    expect(await bl.isArmed()).toBe(false);
  });

  it('disarms (forgets the credential)', async () => {
    const bl = createBiometricLogin({ store: memStore() });
    await bl.arm('r');
    await bl.disarm();
    expect(await bl.isArmed()).toBe(false);
  });
});
