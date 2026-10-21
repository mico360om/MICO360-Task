import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The task PDF and workbook word each change the way the website's activity timeline does, with a
// copy of the web app's module. This fails when the copy drifts from it (skipped where the web app
// isn't checked out): copy the web app's file over this one.
const here = resolve(__dirname);
const repo = resolve(here, '../../../../..');
const web = resolve(repo, 'Web Portal/frontend/src/lib/activity-feed.ts');
const copy = resolve(here, 'activity-feed.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared activity wording', () => {
  it.skipIf(!existsSync(web))('src/modules/activity/activity-feed.ts matches Web Portal/frontend/src/lib/activity-feed.ts', () => {
    expect(existsSync(copy), 'the server keeps a copy of the web app’s activity wording').toBe(true);
    expect(read(copy)).toBe(read(web));
  });
});
