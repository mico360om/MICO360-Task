import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Onboarding: the server owns the rules for an account's details (email, username, phone, organisation)
// and refuses what breaks them; the website keeps an identical copy so the forms say the same rule next
// to each field while typing. This fails when the copy drifts (skipped where the server's code isn't
// checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/lib/account-rules.ts');
const copy = resolve(here, 'account-rules.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared account detail rules', () => {
  it.skipIf(!existsSync(server))('src/lib/account-rules.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s account rules').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
