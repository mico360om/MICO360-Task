import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The certificate's look (1.23.35): the server's PDF owns the drawing — the page, the red shapes, the laurel wreath, where
// the words and the QR code go and which detail rows a certificate has — and the website keeps an identical copy so the
// on-screen certificate is the same design. This fails when the copy drifts (skipped where the server's code isn't
// checked out): copy the server's file over this one.
const here = resolve(__dirname);
const server = resolve(here, '../../../../backend/src/modules/training/certificate-art.ts');
const copy = resolve(here, 'certificate-art.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('shared certificate look', () => {
  it.skipIf(!existsSync(server))('components/training/certificate-art.ts matches the server’s', () => {
    expect(existsSync(copy), 'the website keeps a copy of the server’s certificate drawing').toBe(true);
    expect(read(copy)).toBe(read(server));
  });
});
