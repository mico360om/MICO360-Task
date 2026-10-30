import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appPath } from '../testing/web-source';
import { installStructuredClone } from './structured-clone';

/** Hermes on React Native 0.74 has no structuredClone; the outbox copies its records with one. */

it('gives the phone a structuredClone the outbox can use', () => {
  const g: { structuredClone?: unknown } = {};
  installStructuredClone(g);
  const a = { x: [1, { y: 2 }], n: null };
  const b = (g.structuredClone as <T>(v: T) => T)(a);
  expect(b).toEqual(a);
  expect(b.x).not.toBe(a.x);
  expect((g.structuredClone as (v: unknown) => unknown)(undefined)).toBeUndefined();
  const own = () => 1;
  const h = { structuredClone: own };
  installStructuredClone(h);
  expect(h.structuredClone).toBe(own);
});

it('is installed before the app starts', () =>
  expect(readFileSync(appPath('index.ts'), 'utf8')).toMatch(/installStructuredClone\(\);[^]*registerRootComponent\(App\)/));
