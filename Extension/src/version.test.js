import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isStoreInstall, versionStatus, aboutUrl } from './version.js';

describe('parseVersion / compareVersions', () => {
  it('reads Major.Minor.Patch, with or without a leading v; a missing part is 0', () => {
    expect(parseVersion('1.5.1')).toEqual([1, 5, 1]);
    expect(parseVersion('v2.0')).toEqual([2, 0, 0]);
    expect(parseVersion(' 1.10.3-beta.1 ')).toEqual([1, 10, 3]);
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares part by part as numbers (1.10 is newer than 1.9)', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.5.1', '1.5.1')).toBe(0);
    expect(compareVersions('1.5.0', '1.5.1')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('v1.5', '1.5.0')).toBe(0);
    expect(compareVersions('?', '1.5.0')).toBeNull();
  });
});

describe('versionStatus', () => {
  const zip = { version: '1.5.1' };
  const store = { version: '1.5.1', update_url: 'https://clients2.google.com/service/update2/crx' };

  it('a zip install (no update_url) is told when the server has a newer version', () => {
    expect(isStoreInstall(zip)).toBe(false);
    expect(versionStatus({ manifest: zip, server: '1.6.0' })).toEqual({ extension: '1.5.1', server: '1.6.0', storeInstall: false, updateAvailable: true });
  });

  it('nothing to tell when they match, the server is older, or its version is not known', () => {
    expect(versionStatus({ manifest: zip, server: '1.5.1' }).updateAvailable).toBe(false);
    expect(versionStatus({ manifest: zip, server: '1.4.0' }).updateAvailable).toBe(false);
    expect(versionStatus({ manifest: zip, server: null })).toEqual({ extension: '1.5.1', server: null, storeInstall: false, updateAvailable: false });
  });

  it('a Chrome Web Store install updates itself, so it is never told', () => {
    expect(isStoreInstall(store)).toBe(true);
    expect(versionStatus({ manifest: store, server: '1.6.0' }).updateAvailable).toBe(false);
  });
});

describe('aboutUrl', () => {
  it('is the web app’s About page (what each release changed)', () => {
    expect(aboutUrl('https://task.mico360.com')).toBe('https://task.mico360.com/about');
    expect(aboutUrl('http://192.168.1.20:4000/')).toBe('http://192.168.1.20:4000/about');
  });
});
