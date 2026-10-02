import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The web and Android apps preview repeat dates with copies of this module, so what they show is
// what the server does; the repeat summary is shared the other way (web → Android, server exports).
// This fails when a copy drifts (skipped where the apps aren't checked out).
const here = resolve(__dirname);
const repo = resolve(here, '../../../../..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const COPIES: [string, string][] = [
  [resolve(here, 'recurrence.ts'), resolve(repo, 'Web Portal/frontend/src/lib/recurrence.ts')],
  [resolve(here, 'recurrence.ts'), resolve(repo, 'Android App/src/lib/recurrence.ts')],
  [resolve(repo, 'Web Portal/frontend/src/lib/recurrence-summary.ts'), resolve(repo, 'Android App/src/lib/recurrence-summary.ts')],
  [resolve(repo, 'Web Portal/frontend/src/lib/recurrence-summary.ts'), resolve(here, 'recurrence-summary.ts')],
  [resolve(repo, 'Web Portal/frontend/src/lib/recurrence-summary.test.ts'), resolve(repo, 'Android App/src/lib/recurrence-summary.test.ts')],
];

describe('shared recurrence code', () => {
  for (const [source, copy] of COPIES) {
    it.skipIf(!existsSync(source) || !existsSync(copy))(`${copy.slice(repo.length + 1)} matches ${source.slice(repo.length + 1)}`, () => {
      expect(read(copy)).toBe(read(source));
    });
  }
});
