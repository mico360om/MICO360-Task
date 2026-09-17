import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import appConfig from '../../app.config';
import { flavorConfig, type AppEnv } from './app-env';

/**
 * Tests the dynamic Expo config (app.config.ts) — the real build-config entry point that turns
 * the APP_ENV build variable + EXPO_PUBLIC_API_URL override into the app name, Android package id
 * and runtime `extra`. It re-implements the flavor logic (the Expo config loader can't import the
 * sibling .ts), so these tests also pin it to `flavorConfig` in app-env.ts to catch drift.
 */

// A minimal stand-in for the static app.json base that the Expo CLI passes in.
const baseConfig: ExpoConfig = {
  name: 'MICO360 Tasks',
  slug: 'mico360-tasks',
  scheme: 'mico360',
  android: { package: 'com.mico360.tasks', permissions: ['INTERNET', 'POST_NOTIFICATIONS'] },
  extra: { eas: { projectId: 'base-id' } },
};

const run = (base: Partial<ExpoConfig> = baseConfig): ExpoConfig =>
  appConfig({ config: { ...baseConfig, ...base } } as ConfigContext);

const savedEnv = { APP_ENV: process.env.APP_ENV, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL };
beforeEach(() => {
  delete process.env.APP_ENV;
  delete process.env.EXPO_PUBLIC_API_URL;
});
afterEach(() => {
  process.env.APP_ENV = savedEnv.APP_ENV;
  process.env.EXPO_PUBLIC_API_URL = savedEnv.EXPO_PUBLIC_API_URL;
  if (savedEnv.APP_ENV === undefined) delete process.env.APP_ENV;
  if (savedEnv.EXPO_PUBLIC_API_URL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
});

describe('app.config dynamic Expo config', () => {
  const cases: AppEnv[] = ['development', 'preview', 'production'];

  it.each(cases)('for APP_ENV=%s matches the flavorConfig source of truth', (env) => {
    process.env.APP_ENV = env;
    const expected = flavorConfig(env);
    const cfg = run();
    expect(cfg.name).toBe(expected.name);
    expect(cfg.android?.package).toBe(expected.androidPackage);
    expect(cfg.extra?.appEnv).toBe(env);
    expect(cfg.extra?.apiBaseUrl).toBe(expected.apiBaseUrl);
  });

  it('defaults to the development flavor for a missing or unknown APP_ENV', () => {
    expect(run().extra?.appEnv).toBe('development');
    process.env.APP_ENV = 'staging';
    const cfg = run();
    expect(cfg.extra?.appEnv).toBe('development');
    expect(cfg.name).toBe('MICO360 Tasks (Dev)');
    expect(cfg.android?.package).toBe('com.mico360.tasks.dev');
  });

  it('normalizes APP_ENV case and surrounding whitespace', () => {
    process.env.APP_ENV = '  PRODUCTION ';
    const cfg = run();
    expect(cfg.extra?.appEnv).toBe('production');
    expect(cfg.android?.package).toBe('com.mico360.tasks');
  });

  it('lets EXPO_PUBLIC_API_URL override the flavor endpoint (trailing slash trimmed)', () => {
    process.env.APP_ENV = 'production';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.acme.co/api/v1/';
    expect(run().extra?.apiBaseUrl).toBe('https://api.acme.co/api/v1');
  });

  it('ignores a blank EXPO_PUBLIC_API_URL and keeps the flavor default', () => {
    process.env.APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_API_URL = '   ';
    expect(run().extra?.apiBaseUrl).toBe(flavorConfig('preview').apiBaseUrl);
  });

  it('preserves the static base config (scheme, android permissions, merged extra, slug fallback)', () => {
    process.env.APP_ENV = 'development';
    const cfg = run();
    expect(cfg.scheme).toBe('mico360');
    expect(cfg.android?.permissions).toEqual(['INTERNET', 'POST_NOTIFICATIONS']);
    // base extra survives alongside the injected flavor fields
    expect((cfg.extra?.eas as { projectId: string }).projectId).toBe('base-id');
    // slug falls back when the base omits it
    const cfg2 = appConfig({ config: { ...baseConfig, slug: undefined as unknown as string } } as ConfigContext);
    expect(cfg2.slug).toBe('mico360-tasks');
  });
});
