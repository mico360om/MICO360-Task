import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Board search (owner, 10 Nov). The server owns how search words are read and folded — case, Arabic letter
// forms (أ إ آ → ا, ة → ه, ى → ي…), diacritics and tatweel, "quoted phrases", at most 10 words — and
// where the words are in a text for highlighting (task search, the task list's keyword filter). The
// website keeps identical copies so the board's own search finds — and marks — what the top-bar
// search does. This fails when a copy drifts (skipped where the server's code isn't checked out):
// copy the server's file over the website's.
const here = resolve(__dirname);
const serverDir = resolve(here, '../../../backend/src/modules/search');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared search text reading', () => {
  for (const file of ['text-normalize.ts', 'task-search-query.ts', 'task-search-text.ts']) {
    const server = resolve(serverDir, file);
    const copy = resolve(here, file);
    it.skipIf(!existsSync(server))(`src/lib/${file} matches the server’s`, () => {
      expect(existsSync(copy), `the website keeps a copy of the server’s ${file}`).toBe(true);
      expect(read(copy)).toBe(read(server));
    });
  }
});
