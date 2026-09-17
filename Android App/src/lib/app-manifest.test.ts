import { describe, it, expect } from 'vitest';
import manifest from '../../app.json';
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
});
