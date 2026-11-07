import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 1.23.8 One colour scheme: the website and the server (its PDFs, emails and the colours new projects' columns
// start with) read the same colours. The server keeps an identical copy of lib/colour-scheme.ts; this fails when
// they drift (skipped where the server's code isn't checked out): copy this file over the server's.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/lib/colour-scheme.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared colour scheme', () => {
  it.skipIf(!existsSync(resolve(here, '../../../backend/src')))('the server’s src/lib/colour-scheme.ts is the website’s', () => {
    expect(existsSync(server), 'the server keeps a copy of the colour scheme').toBe(true);
    expect(read(server)).toBe(read(resolve(here, 'colour-scheme.ts')));
  });
});
