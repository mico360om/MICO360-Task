import { describe, it, expect } from 'vitest';
import { resolveAppEnv, flavorConfig, APP_ENVS } from './app-env';

describe('resolveAppEnv', () => {
  it('accepts the known flavors (case-insensitive)', () => {
    expect(resolveAppEnv('development')).toBe('development');
    expect(resolveAppEnv('Preview')).toBe('preview');
    expect(resolveAppEnv('PRODUCTION')).toBe('production');
  });

  it('defaults to development for empty/unknown input', () => {
    expect(resolveAppEnv(undefined)).toBe('development');
    expect(resolveAppEnv('')).toBe('development');
    expect(resolveAppEnv('staging')).toBe('development');
  });

  it('exposes exactly the three flavors', () => {
    expect([...APP_ENVS]).toEqual(['development', 'preview', 'production']);
  });
});

describe('flavorConfig', () => {
  it('suffixes the name and android package for non-production so flavors install side-by-side', () => {
    const dev = flavorConfig('development');
    expect(dev.name).toBe('MICO360 Tasks (Dev)');
    expect(dev.androidPackage).toBe('com.mico360.tasks.dev');
    expect(dev.isProduction).toBe(false);

    const prev = flavorConfig('preview');
    expect(prev.name).toBe('MICO360 Tasks (Preview)');
    expect(prev.androidPackage).toBe('com.mico360.tasks.preview');

    const prod = flavorConfig('production');
    expect(prod.name).toBe('MICO360 Tasks');
    expect(prod.androidPackage).toBe('com.mico360.tasks');
    expect(prod.isProduction).toBe(true);
  });

  it('provides a distinct default API base URL per flavor', () => {
    expect(flavorConfig('development').apiBaseUrl).toBe('http://10.0.2.2:4000/api/v1');
    expect(flavorConfig('preview').apiBaseUrl).toContain('staging');
    expect(flavorConfig('production').apiBaseUrl).toContain('api.mico360');
  });

  it('lets an explicit apiUrl override the flavor default (trailing slash trimmed)', () => {
    const c = flavorConfig('production', { apiUrl: 'https://api.acme.co/api/v1/' });
    expect(c.apiBaseUrl).toBe('https://api.acme.co/api/v1');
  });

  it('ignores a blank override and falls back to the flavor default', () => {
    expect(flavorConfig('development', { apiUrl: '   ' }).apiBaseUrl).toBe('http://10.0.2.2:4000/api/v1');
  });
});
