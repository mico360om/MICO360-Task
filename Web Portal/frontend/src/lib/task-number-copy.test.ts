import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The server owns how a typed task number is read (MICO-142, mico 142, MICO142, MICO_142, #142…) for
// task search, the task list's filter and MICO AI; the website keeps an identical copy for its own
// filters and the top bar's "open" command, so both read a number the same way. This fails when the
// copy drifts (skipped where the server's code isn't checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/lib/task-number.ts');
const copy = resolve(here, 'task-number.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared task number reading', () => {
  it.skipIf(!existsSync(server))('src/lib/task-number.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s task-number reading').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
