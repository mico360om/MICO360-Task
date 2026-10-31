import { it, expect } from 'vitest';
import { refetchOnFocusWanted } from './focus-refetch';
import { appSource as src } from '../testing/web-source';

/**
 * Stage 3 final review P1: Timeline, Workload and Management read their figures again when they come
 * back into view out of date — a task changed on a screen opened from them (lib/task-cache marks
 * them) — as ProjectsScreen's card figures do.
 */
const q = (over: Partial<{ isStale: boolean; isFetching: boolean; hasData: boolean }> = {}) => ({ isStale: true, isFetching: false, hasData: true, ...over });

it('reads shown figures again only when they are out of date and not being read', () => {
  expect(refetchOnFocusWanted(q(), true)).toBe(true);
  expect(refetchOnFocusWanted(q({ isStale: false }), true)).toBe(false);
  expect(refetchOnFocusWanted(q({ isFetching: true }), true)).toBe(false);
});

it('never makes a first load (the query’s own) or asks while the screen may not ask (Management before the server says yes)', () => {
  expect(refetchOnFocusWanted(q({ hasData: false }), true)).toBe(false);
  expect(refetchOnFocusWanted(q(), false)).toBe(false);
});

it('the three screens use it; Management only while access is allowed', () => {
  expect(src('screens/TimelineScreen.tsx')).toMatch(/useRefetchOnFocus\(q\)/);
  expect(src('screens/WorkloadScreen.tsx')).toMatch(/useRefetchOnFocus\(query\)/);
  expect(src('screens/ManagementScreen.tsx')).toMatch(/useRefetchOnFocus\(q, access\.allowed\)/);
});

it('it acts on coming into view only: the query is read through a ref, so a query out of date as soon as it is read (staleTime 0) is not read again in a loop', () => {
  const hook = src('core/focus-refetch.ts');
  expect(hook).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{[^]*?latest\.current[^]*?\}, \[\]\),?\s*\)/);
  expect(hook).toMatch(/refetchOnFocusWanted\(/);
});
