import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The task PDF and workbook word each change the way the website's activity timeline does, with a
// copy of the web app's module (and of the day words it writes dates with). This fails when a copy
// drifts from it (skipped where the web app isn't checked out): copy the web app's file over this one.
const here = resolve(__dirname);
const repo = resolve(here, '../../../../..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared activity wording', () => {
  for (const name of ['activity-feed', 'day-words']) {
    const web = resolve(repo, `Web Portal/frontend/src/lib/${name}.ts`);
    const copy = resolve(here, `${name}.ts`);
    it.skipIf(!existsSync(web))(`src/modules/activity/${name}.ts matches Web Portal/frontend/src/lib/${name}.ts`, () => {
      expect(existsSync(copy), `the server keeps a copy of the web app’s ${name}`).toBe(true);
      expect(read(copy)).toBe(read(web));
    });
  }
});
