import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 1.24 Guests and task categories: the server checks guests and categories, and words their history lines,
// with copies of the website's rules, so both agree. This fails when a copy drifts (skipped where the
// website isn't checked out): copy the website's file over the server's.
const here = resolve(__dirname);
const repo = resolve(here, '../../../../..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const COPIES: [web: string, server: string][] = [
  ['Web Portal/frontend/src/lib/guest-contacts.ts', 'Web Portal/backend/src/modules/tasks/guest-contacts.ts'],
  ['Web Portal/frontend/src/lib/task-categories.ts', 'Web Portal/backend/src/modules/tasks/task-categories.ts'],
  ['Web Portal/frontend/src/lib/task-history-extra.ts', 'Web Portal/backend/src/modules/activity/task-history-extra.ts'],
];

describe('guest and category rules shared with the website', () => {
  for (const [web, server] of COPIES) {
    it.skipIf(!existsSync(resolve(repo, web)))(`${server} matches ${web}`, () => {
      expect(existsSync(resolve(repo, server))).toBe(true);
      expect(read(resolve(repo, server))).toBe(read(resolve(repo, web)));
    });
  }
});
