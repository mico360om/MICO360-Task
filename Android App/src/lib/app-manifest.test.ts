import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../../app.json';
import eas from '../../eas.json';
import flavors from './flavors.json';

/**
 * Guards the static Expo manifest (app.json) against regressions in the base build config that
 * other parts of the app silently depend on: OS appearance must allow the shipped dark theme, the
 * deep-link scheme must match the navigator's linking prefixes, and the base identity must match
 * the flavor table (app.config.ts derives per-flavor name/package by suffixing these).
 */
describe('app.json base manifest', () => {
  const expo = manifest.expo;

  it('follows the OS light/dark setting so the "system" theme mode works', () => {
    // "light" would lock the app to light and defeat the theme system's default (mode: 'system').
    expect(expo.userInterfaceStyle).toBe('automatic');
  });

  it('declares the mico360 deep-link scheme the navigator routes on', () => {
    // RootNavigator linking uses the 'mico360://' prefix; a mismatch breaks push/deep links.
    expect(expo.scheme).toBe('mico360');
  });

  it('keeps its identity aligned with the flavor table', () => {
    expect(expo.name).toBe(flavors.baseName);
    expect(expo.android.package).toBe(flavors.basePackage);
    expect(expo.slug).toBe('mico360-tasks');
  });

  it('requests the permissions the app needs (internet + notifications)', () => {
    expect(expo.android.permissions).toContain('INTERNET');
    expect(expo.android.permissions).toContain('POST_NOTIFICATIONS');
  });

  it('configures the splash screen so a clean prebuild keeps color/splashscreen_background (MOB-05)', () => {
    // Without a splash section `expo prebuild --clean` drops splashscreen_background from
    // colors.xml while the splash drawable still references it, and every release build fails.
    expect(expo.splash).toEqual({ image: './assets/logo.png', resizeMode: 'contain', backgroundColor: '#8B1E1E' });
  });

  it('blocks permissions the app does not use and keeps cached data out of cloud backups (MOB-12)', () => {
    expect(expo.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ]),
    );
    expect(expo.android.allowBackup).toBe(false);
  });

  it('opens the password-reset e-mail link in the app via a verified App Link (MOB-09)', () => {
    const filter = expo.android.intentFilters.find((f) => f.data.some((d) => d.path === '/reset'));
    expect(filter).toBeDefined();
    expect(filter!.autoVerify).toBe(true);
    expect(filter!.action).toBe('VIEW');
    expect(filter!.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
    expect(filter!.data).toEqual([{ scheme: 'https', host: 'task.mico360.com', path: '/reset' }]);
  });
});

describe('Digital Asset Links for the reset App Link (MOB-09)', () => {
  // Served by the web portal at https://task.mico360.com/.well-known/assetlinks.json.
  const file = resolve(__dirname, '../../../Web Portal/frontend/public/.well-known/assetlinks.json');

  it.skipIf(!existsSync(file))('verifies the production package with a SHA-256 signing fingerprint', () => {
    const links = JSON.parse(readFileSync(file, 'utf8')) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    const app = links.find((l) => l.target.package_name === manifest.expo.android.package);
    expect(app).toBeDefined();
    expect(app!.relation).toContain('delegate_permission/common.handle_all_urls');
    expect(app!.target.namespace).toBe('android_app');
    expect(app!.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const fp of app!.target.sha256_cert_fingerprints) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('office-network (self-hosted) servers', () => {
  it('ships an upgradeable build number and the plain-http plugin for private-network servers', async () => {
    expect(Number.isInteger(manifest.expo.android.versionCode)).toBe(true);
    expect(manifest.expo.android.versionCode).toBeGreaterThanOrEqual(2);
    expect(manifest.expo.plugins).toContain('./plugins/with-lan-cleartext');
    const { createRequire } = await import('node:module');
    const plugin = createRequire(import.meta.url)('../../plugins/with-lan-cleartext.js') as {
      applyLanCleartext: (m: { manifest: { application?: { $?: Record<string, string> }[] } }) => {
        manifest: { application: { $: Record<string, string> }[] };
      };
    };
    const out = plugin.applyLanCleartext({ manifest: { application: [{ $: { 'android:allowBackup': 'false' } }] } });
    expect(out.manifest.application[0]!.$).toEqual({ 'android:allowBackup': 'false', 'android:usesCleartextTraffic': 'true' });
    expect(() => plugin.applyLanCleartext({ manifest: {} })).toThrow();
  });
});

describe('eas.json build profiles (MOB-12)', () => {
  const profiles = eas.build as Record<string, { env?: Record<string, string> }>;

  it('every profile names its flavor explicitly', () => {
    for (const [name, p] of Object.entries(profiles)) {
      expect(['development', 'preview', 'production'], name).toContain(p.env?.APP_ENV);
    }
  });

  it('no profile or flavor points at an unresolvable placeholder host', () => {
    const urls = [
      ...Object.values(profiles).map((p) => p.env?.EXPO_PUBLIC_API_URL ?? ''),
      ...Object.values(flavors.flavors).map((f) => f.apiBaseUrl),
    ];
    for (const url of urls) expect(url).not.toMatch(/\.(example|invalid|test|localhost)\b/);
  });
});
