import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Kanban Board: Monthly View. The server owns which months a task shows in (GET /tasks?month=); the
// website keeps an identical copy so a carried-over card is marked and a new task outside the month says
// where it went ("Saved — it’s in Dec"). This fails when the copy drifts (skipped where the server's code
// isn't checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/tasks/board-month.ts');
const copy = resolve(here, 'board-month.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared month rule', () => {
  it.skipIf(!existsSync(server))('src/lib/board-month.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s month rule').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
