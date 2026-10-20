import { describe, it, expect } from 'vitest';
import { releaseDrift } from './release-versions';

const web = { 'package.json': '1.3.5', 'Web Portal/backend/package.json': '1.3.5', 'Extension/manifest.json': '1.3.5' };

describe('releaseDrift — what is out of step with the release', () => {
  it('nothing, when everything carries the release version', () => {
    expect(releaseDrift('1.3.5', web, { 'Android App/app.json': '1.3.5', 'Android App/package.json': '1.3.5' })).toEqual([]);
  });

  it('the Android app may stay behind: a website-only release keeps the app’s version', () => {
    expect(releaseDrift('1.3.5', web, { 'Android App/app.json': '1.3.3', 'Android App/package.json': '1.3.3' })).toEqual([]);
  });

  it('every other part must carry the release version', () => {
    expect(releaseDrift('1.3.5', { ...web, 'Extension/manifest.json': '1.3.4' }, { 'Android App/app.json': '1.3.5' })).toEqual(['Extension/manifest.json: 1.3.4']);
  });

  it('the Android files must agree with each other, and never be ahead of the release', () => {
    expect(releaseDrift('1.3.5', web, { 'Android App/app.json': '1.3.3', 'Android App/package.json': '1.3.4' })).toEqual([
      'Android App/package.json: 1.3.4 (the Android files say 1.3.3)',
    ]);
    expect(releaseDrift('1.3.5', web, { 'Android App/app.json': '1.3.6', 'Android App/package.json': '1.3.6' })).toEqual([
      'Android App/app.json: 1.3.6 is newer than the release',
    ]);
    expect(releaseDrift('1.3.5', web, { 'Android App/app.json': undefined })).toEqual(['Android App/app.json: missing']);
  });
});
