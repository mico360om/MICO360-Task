import { describe, it, expect } from 'vitest';
import { resolveApiBaseUrl, resolveRuntimeAppEnv, resolveRuntimeConfig, DEFAULT_API_BASE } from './config';

describe('resolveApiBaseUrl', () => {
  it('uses the injected value (trailing slashes trimmed)', () => {
    expect(resolveApiBaseUrl({ apiBaseUrl: 'https://api.acme.co/api/v1//' })).toBe('https://api.acme.co/api/v1');
  });
  it('falls back to the emulator default when missing/blank', () => {
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE);
    expect(resolveApiBaseUrl({ apiBaseUrl: '   ' })).toBe(DEFAULT_API_BASE);
    expect(resolveApiBaseUrl({ apiBaseUrl: 42 })).toBe(DEFAULT_API_BASE);
  });
});

describe('resolveRuntimeConfig', () => {
  it('reads the flavor + endpoint baked into Expo extra', () => {
    const cfg = resolveRuntimeConfig({ appEnv: 'production', apiBaseUrl: 'https://api.mico360.example/api/v1' });
    expect(cfg).toEqual({ appEnv: 'production', apiBaseUrl: 'https://api.mico360.example/api/v1', isProduction: true });
  });

  it('defaults to development when extra is absent', () => {
    const cfg = resolveRuntimeConfig(undefined);
    expect(cfg.appEnv).toBe('development');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.apiBaseUrl).toBe(DEFAULT_API_BASE);
  });

  it('normalizes an unknown appEnv to development', () => {
    expect(resolveRuntimeAppEnv({ appEnv: 'qa' })).toBe('development');
    expect(resolveRuntimeAppEnv({ appEnv: 'preview' })).toBe('preview');
  });
});
