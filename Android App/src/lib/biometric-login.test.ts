import { describe, it, expect, vi } from 'vitest';
import { createBiometricLogin } from './biometric-login';
import { createMemoryStore } from './storage';

function setup() {
  const secretStore = createMemoryStore();
  const markerStore = createMemoryStore();
  return { secretStore, markerStore, bl: createBiometricLogin({ secretStore, markerStore }) };
}

describe('createBiometricLogin', () => {
  it('is not armed initially', async () => {
    const { bl } = setup();
    expect(await bl.isArmed()).toBe(false);
    expect(await bl.getCredential()).toBeNull();
  });

  it('keeps the refresh token only in the biometric-bound store; the marker holds just the label', async () => {
    const { bl, secretStore, markerStore } = setup();
    await bl.arm('refresh-abc', 'ada@x.co');
    expect(await bl.isArmed()).toBe(true);
    expect(await bl.getLabel()).toBe('ada@x.co');
    expect(await secretStore.getItem('mico360.biometricLogin')).toContain('refresh-abc');
    const marker = await markerStore.getItem('mico360.biometricLogin.armed');
    expect(marker).toContain('ada@x.co');
    expect(marker).not.toContain('refresh-abc');
    expect(await bl.getCredential()).toEqual({ refreshToken: 'refresh-abc', label: 'ada@x.co' });
  });

  it('checking whether it is armed never touches the biometric-bound store (no prompt)', async () => {
    const { secretStore, markerStore } = setup();
    const spy = vi.spyOn(secretStore, 'getItem');
    const bl = createBiometricLogin({ secretStore, markerStore });
    await bl.arm('r', 'ada');
    await bl.isArmed();
    await bl.getLabel();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores an empty refresh token', async () => {
    const { bl } = setup();
    await bl.arm('');
    expect(await bl.isArmed()).toBe(false);
  });

  it('disarms (forgets the credential and the marker)', async () => {
    const { bl, secretStore } = setup();
    await bl.arm('r');
    await bl.disarm();
    expect(await bl.isArmed()).toBe(false);
    expect(await secretStore.getItem('mico360.biometricLogin')).toBeNull();
  });

  it('removes the unprotected copy older builds left in the ordinary keystore', async () => {
    const markerStore = createMemoryStore({ 'mico360.biometricLogin': JSON.stringify({ refreshToken: 'legacy' }) });
    const bl = createBiometricLogin({ secretStore: createMemoryStore(), markerStore });
    await bl.purgeLegacy();
    expect(await markerStore.getItem('mico360.biometricLogin')).toBeNull();
  });

  it('forgets the sign-in when the biometric key was invalidated (value gone)', async () => {
    const { bl, secretStore } = setup();
    await bl.arm('r', 'ada');
    await secretStore.deleteItem('mico360.biometricLogin'); // e.g. new fingerprint enrolled
    expect(await bl.getCredential()).toBeNull();
    expect(await bl.isArmed()).toBe(false);
  });

  it('stays armed when the prompt is cancelled (the read throws)', async () => {
    const { secretStore, markerStore } = setup();
    const bl = createBiometricLogin({ secretStore, markerStore });
    await bl.arm('r', 'ada');
    vi.spyOn(secretStore, 'getItem').mockRejectedValueOnce(new Error('User canceled'));
    expect(await bl.getCredential()).toBeNull();
    expect(await bl.isArmed()).toBe(true);
  });
});
