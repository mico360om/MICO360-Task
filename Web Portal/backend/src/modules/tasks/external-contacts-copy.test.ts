import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The server checks external contacts and sums them up for task lists with a copy of the web app's
// rules (shared with the Android app), so all three agree. This fails when the copy drifts (skipped
// where the web app isn't checked out): copy the web app's file over this one.
const here = resolve(__dirname);
const repo = resolve(here, '../../../../..');
const web = resolve(repo, 'Web Portal/frontend/src/lib/external-contacts.ts');
const copy = resolve(here, 'external-contacts.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared external-contact rules', () => {
  it.skipIf(!existsSync(web))('src/modules/tasks/external-contacts.ts matches Web Portal/frontend/src/lib/external-contacts.ts', () => {
    expect(existsSync(copy), 'the server keeps a copy of the web app’s external-contact rules').toBe(true);
    expect(read(copy)).toBe(read(web));
  });
});
