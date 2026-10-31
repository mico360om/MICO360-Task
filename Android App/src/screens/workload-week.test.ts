import { it, expect } from 'vitest';
import { getStateFromPath } from '@react-navigation/core';
import { askedWeek } from '../lib/workload';
import { itemTarget } from '../lib/management';
import { linkingConfig, normalizeLinkPath, withoutLinkTitles } from '../navigation/linking';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/**
 * Stage 3 final review P3: a person in Management's lists opens Workload on the week Management
 * counted (the overview's company week), not the viewer's own — as the website's
 * `/workload?week=<day>`; the website's address opens the same week on the phone.
 */
it('a week asked for is a real day, as the website’s isDay (WorkloadPage.tsx); anything else is this week', () => {
  expect(askedWeek('2026-10-25')).toBe('2026-10-25');
  for (const bad of [undefined, null, '', '2026-10-5', '2026-13-45', '25-10-2026', '2026-10-25&projectId=x', 7]) expect(askedWeek(bad), String(bad)).toBeNull();
  if (hasWeb('frontend/src/pages/WorkloadPage.tsx')) expect(readWeb('frontend/src/pages/WorkloadPage.tsx')).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))');
});

it('a person row opens Workload on the overview’s week', () => {
  expect(itemTarget({ kind: 'person', id: 'u2', title: 'Omar Said' }, '2026-10-25')).toEqual({ type: 'stack', screen: 'Workload', params: { week: '2026-10-25' } });
  expect(itemTarget({ kind: 'person', id: 'u2', title: 'Omar Said' }, 'not a day')).toEqual({ type: 'stack', screen: 'Workload' });
  expect(src('components/management/ItemsSheet.tsx')).toMatch(/itemTarget\(row, workloadWeek\)/);
  expect(src('screens/ManagementScreen.tsx')).toMatch(/<ItemsSheet[^>]*workloadWeek=\{data\?\.workload\.week\}/);
  expect(src('navigation/apply-action.ts')).toMatch(/case 'Workload':\s*navigationRef\.navigate\('Workload', action\.params\)/);
});

it('Workload shows the week it is asked for — from Management or the website’s address — checked first', () => {
  const s = src('screens/WorkloadScreen.tsx');
  expect(s).toMatch(/askedWeek\(route\.params\?\.week\)/);
  const cfg = linkingConfig as unknown as Parameters<typeof getStateFromPath>[1];
  const route = withoutLinkTitles(getStateFromPath(normalizeLinkPath('/workload?week=2026-10-25'), cfg))?.routes.at(-1);
  expect(route).toMatchObject({ name: 'Workload', params: { week: '2026-10-25' } });
});
