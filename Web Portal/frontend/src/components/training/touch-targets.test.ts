import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TOUCH_MIN } from './training-ui';

// Release B gate (Learning Hub browser check): on a touch screen index.css gives every button and input a 32 px floor
// (`@media (pointer: coarse) { button … { min-height: 2rem } }`), which beats a plain `[@media(pointer:coarse)]:min-h-11`
// class — so the Learning Hub's buttons were 32–40 px on phones. The 44 px class must be important (as the Manage side's
// already were, 6ec4d38a).
const ROOTS = [join(__dirname), join(__dirname, '..', '..', 'pages', 'training')];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe('Learning Hub touch targets', () => {
  it('the shared 44 px class wins over the touch-screen floor', () => {
    expect(TOUCH_MIN).toBe('[@media(pointer:coarse)]:!min-h-11');
  });

  it('no Learning Hub file uses the weaker class (it loses to index.css on phones)', () => {
    const weak = ROOTS.flatMap(files).filter((f) => /\[@media\(pointer:coarse\)\]:min-h-11/.test(readFileSync(f, 'utf8')));
    expect(weak).toEqual([]);
  });
});
