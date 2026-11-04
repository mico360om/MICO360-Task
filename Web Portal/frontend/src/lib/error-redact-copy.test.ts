import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pagePattern, redactText } from './error-redact';

// The server owns what an error report may say (1.22.4, the Error log): the website keeps an identical
// copy, so a page reduces a report the same way before sending it. This fails when the copy drifts
// (skipped where the server's code isn't checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../backend/src/modules/error-log/error-redact.ts');
const copy = resolve(here, 'error-redact.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared error-report redaction', () => {
  it.skipIf(!existsSync(server))('src/lib/error-redact.ts matches the server’s', () => {
    expect(read(copy)).toBe(read(server));
  });

  it('works in the browser build too (a client link, a reset link)', () => {
    expect(pagePattern('/client/abcdefghijkl?x=1')).toBe('/client/:token');
    expect(redactText('at /reset?token=secret')).toBe('at /reset');
  });
});
