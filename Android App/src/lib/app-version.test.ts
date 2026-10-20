import { describe, it, expect } from 'vitest';
import { compareVersions, updateAvailable, showUpdateBanner, releaseName, versionHeaders } from './app-version';

describe('app version', () => {
  it('compares versions number by number', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('an update is available only when the server is newer', () => {
    expect(updateAvailable('1.2.0', null)).toBe(false);
    expect(updateAvailable('1.2.0', '1.2.0')).toBe(false);
    expect(updateAvailable('1.2.1', '1.2.0')).toBe(false);
    expect(updateAvailable('1.2.0', '1.2.1')).toBe(true);
    expect(updateAvailable('1.2.0', 'development')).toBe(false); // a dev server has no version
  });

  it('the banner can be put away for that version (a server-only release has no new app), and comes back for a newer one', () => {
    expect(showUpdateBanner('1.2.0', '1.2.1', null)).toBe(true);
    expect(showUpdateBanner('1.2.0', '1.2.1', '1.2.1')).toBe(false);
    expect(showUpdateBanner('1.2.0', '1.2.2', '1.2.1')).toBe(true);
    expect(showUpdateBanner('1.2.1', '1.2.1', null)).toBe(false);
  });

  it('names the release for crash reports and the request headers', () => {
    expect(releaseName({ version: '1.2.1', build: 10 })).toBe('mico360-tasks@1.2.1+10');
    expect(versionHeaders({ version: '1.2.1', build: 10 })).toEqual({ 'X-App-Version': '1.2.1', 'X-App-Build': '10' });
  });
});
