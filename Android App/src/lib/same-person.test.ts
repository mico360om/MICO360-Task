import { it, expect } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { samePersonPlaceholder } from './same-person';
import { appSource as src } from '../testing/web-source';

/**
 * Stage 3 (final review P9): while new figures load, the last ones stay on screen only when they
 * are the same person's — a key's second part is its person (['planning' | 'management', userId, …]).
 */
const prev = (queryKey: unknown[]) => ({ queryKey }) as unknown as Query<unknown, Error, unknown, readonly unknown[]>;

it('keeps the last figures for the same person, never for someone else', () => {
  const data = { tiles: { projects: 4 } };
  expect(samePersonPlaceholder('u1')(data, prev(['management', 'u1', 'overview', 'weeks=12']))).toBe(data);
  expect(samePersonPlaceholder('u2')(data, prev(['management', 'u1', 'overview', 'weeks=12']))).toBeUndefined();
  expect(samePersonPlaceholder('u1')(data, undefined)).toBeUndefined();
  expect(samePersonPlaceholder('')(data, prev(['management', 'u1', 'overview']))).toBeUndefined();
});

it('Management’s overview and the planning screens use it (no bare keepPreviousData)', () => {
  const m = src('core/management-queries.ts');
  expect(m).toMatch(/placeholderData: samePersonPlaceholder\(userId \?\? ''\)/);
  expect(m).not.toMatch(/keepPreviousData/);
  const p = src('core/planning-queries.ts');
  expect(p).toMatch(/import \{ samePersonPlaceholder \} from '\.\.\/lib\/same-person';/);
  expect(p.match(/placeholderData: samePersonPlaceholder\(userId\)/g)).toHaveLength(2);
});
