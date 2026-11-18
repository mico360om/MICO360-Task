import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('the loading screen shows the real MICO360 logo (owner, 18 Nov)', () => {
  it('uses the system logo picture, not the drawn tick mark', () => {
    const splash = html.slice(html.indexOf('id="app-splash"'), html.indexOf('</div>', html.indexOf('id="app-splash"')));
    expect(splash).toMatch(/<img[^>]+src="\/brand\/logo\.png"/);
    expect(splash).not.toMatch(/<svg/);
  });
  it('ships the same logo file the side menu uses', () => {
    const pub = join(root, 'public', 'brand', 'logo.png');
    expect(existsSync(pub)).toBe(true);
    expect(readFileSync(pub).equals(readFileSync(join(root, 'src', 'assets', 'logo.png')))).toBe(true);
  });
});
