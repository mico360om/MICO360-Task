import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { appPath, appSource as src, hasWeb, sha256, webPath } from '../testing/web-source';

describe.skipIf(!hasWeb('frontend/src/assets/logo.png', 'frontend/src/assets/logo-w.png'))('the website’s logos', () => {
  it('assets/brand holds the website’s logo files, byte for byte', () => {
    for (const f of ['logo.png', 'logo-w.png']) expect(sha256(appPath(`assets/brand/${f}`)), f).toBe(sha256(webPath(`frontend/src/assets/${f}`)));
  });
});

it('the logo is there even without the website, one file per theme', () => {
  for (const f of ['logo.png', 'logo-w.png']) expect(existsSync(appPath(`assets/brand/${f}`)), f).toBe(true);
  const s = src('components/ui/BrandLogo.tsx');
  expect(s).toContain("import LOGO_LIGHT from '../../../assets/brand/logo.png';");
  expect(s).toContain("import LOGO_DARK from '../../../assets/brand/logo-w.png';");
  expect(s).toMatch(/scheme === 'dark' \? LOGO_DARK : LOGO_LIGHT/);
  expect(s).toMatch(/Math\.round\(\(height \* 409\) \/ 192\)/);
  expect(s).toMatch(/accessibilityLabel="MICO360"/);
});
