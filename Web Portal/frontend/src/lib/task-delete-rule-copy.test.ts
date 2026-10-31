import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The server owns who may delete a task (its creator, or the one person it's assigned to); the
// website keeps an identical copy so Delete is greyed out with the reason the server refuses with.
// This fails when the copy drifts (skipped where the server's code isn't checked out): copy the
// server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/tasks/task-delete-rule.ts');
const copy = resolve(here, 'task-delete-rule.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared task delete rule', () => {
  it.skipIf(!existsSync(server))('src/lib/task-delete-rule.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s delete rule').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
