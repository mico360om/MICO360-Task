import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Android app uses copies of these files — @mention rules, the task timeline's wording, the
// task picker, list reordering and keeping a typed-in field above the keyboard — so both apps behave
// the same. This fails when a copy drifts (skipped where the Android app isn't checked out).
const here = resolve(__dirname);
const repo = resolve(here, '../../../..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const SHARED = ['mentions', 'activity-feed', 'task-picker', 'list-order', 'file-kind', 'field-scroll'];
const COPIES: [string, string][] = SHARED.flatMap((name) => [
  [resolve(here, `${name}.ts`), resolve(repo, `Android App/src/lib/${name}.ts`)] as [string, string],
  [resolve(here, `${name}.test.ts`), resolve(repo, `Android App/src/lib/${name}.test.ts`)] as [string, string],
]);

describe('code shared with the Android app', () => {
  for (const [source, copy] of COPIES) {
    it.skipIf(!existsSync(source) || !existsSync(resolve(repo, 'Android App/package.json')))(`${copy.slice(repo.length + 1)} matches ${source.slice(repo.length + 1)}`, () => {
      expect(existsSync(copy)).toBe(true);
      expect(read(copy)).toBe(read(source));
    });
  }
});
