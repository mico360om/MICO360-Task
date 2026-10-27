import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The server owns the inspection rules (a reading outside its limits fails, how a typed reading is
// read, the counts, the signatures a form asks for); the website keeps an identical copy so a phone
// shows the same result offline as the server stores. This fails when the copy drifts (skipped where
// the server's code isn't checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/inspections/inspection-rules.ts');
const copy = resolve(here, 'inspection-rules.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared inspection rules', () => {
  it.skipIf(!existsSync(server))('src/lib/inspection-rules.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s inspection rules').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
