import { describe, it, expect, vi } from 'vitest';
import { createBiometricGate } from './biometric-gate';
import { createMemoryStore } from './storage';

const deps = (over: Partial<Parameters<typeof createBiometricGate>[0]> = {}) => ({
  isAvailable: vi.fn(async () => true),
  authenticate: vi.fn(async () => true),
  store: createMemoryStore(),
  ...over,
});

describe('createBiometricGate (A1 biometric unlock)', () => {
  it('is disabled by default', async () => {
    const gate = createBiometricGate(deps());
    expect(await gate.isEnabled()).toBe(false);
  });

  it('enables and persists the preference when hardware is available', async () => {
    const o = deps();
    const gate = createBiometricGate(o);
    await gate.setEnabled(true);
    expect(await gate.isEnabled()).toBe(true);
    expect(await o.store.getItem('mico360.biometric')).toBe('1');
  });

  it('refuses to enable when biometrics are unavailable', async () => {
    const gate = createBiometricGate(deps({ isAvailable: vi.fn(async () => false) }));
    await expect(gate.setEnabled(true)).rejects.toThrow(/unavailable/i);
    expect(await gate.isEnabled()).toBe(false);
  });

  it('unlock is a pass-through when the gate is disabled', async () => {
    const o = deps();
    const gate = createBiometricGate(o);
    const res = await gate.unlock();
    expect(res).toEqual({ ok: true, reason: 'disabled' });
    expect(o.authenticate).not.toHaveBeenCalled();
  });

  it('unlock prompts and succeeds when enabled + available + authenticated', async () => {
    const o = deps();
    const gate = createBiometricGate(o);
    await gate.setEnabled(true);
    expect(await gate.unlock()).toEqual({ ok: true });
    expect(o.authenticate).toHaveBeenCalledOnce();
  });

  it('unlock fails when the biometric prompt is rejected', async () => {
    const o = deps({ authenticate: vi.fn(async () => false) });
    const gate = createBiometricGate(o);
    await gate.setEnabled(true);
    expect(await gate.unlock()).toEqual({ ok: false, reason: 'failed' });
  });

  it('unlock fails as unavailable when hardware disappeared after enabling', async () => {
    const isAvailable = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const o = deps({ isAvailable });
    const gate = createBiometricGate(o);
    await gate.setEnabled(true); // available at enable time
    const res = await gate.unlock(); // now unavailable
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(o.authenticate).not.toHaveBeenCalled();
  });
});
