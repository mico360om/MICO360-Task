/**
 * Review Focus 1 (Stage 3 Task 7): on a shared phone, Management's figures are only ever shown to
 * someone the server lets see them — asked for once it said yes, kept per person, dropped on a 403.
 */
import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/api-client';
import { DEFAULT_FILTERS, managementOverviewKey, managementView, tileColumns } from '../lib/management';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

const access = (allowed: boolean, ready = true, failed = false) => ({ allowed, ready, failed });
it('someone without access never gets the figures', () => {
  expect(managementView({ access: access(false, false), overviewError: null, hadAccess: false })).toBe('checking');
  expect(managementView({ access: access(false), overviewError: null, hadAccess: false })).toBe('leave');
  expect(managementView({ access: access(false), overviewError: null, hadAccess: true })).toBe('no-longer');
  expect(managementView({ access: access(true), overviewError: new ApiError(403, 'FORBIDDEN', 'x'), hadAccess: true })).toBe('no-longer');
  expect(managementView({ access: access(false, false, true), overviewError: null, hadAccess: false })).toBe('check-failed');
  expect(managementView({ access: access(true), overviewError: null, hadAccess: true })).toBe('show');
});
it('a failed overview that is not a refusal still shows the page (its own error and Retry)', () => {
  expect(managementView({ access: access(true), overviewError: new ApiError(500, 'INTERNAL', 'x'), hadAccess: true })).toBe('show');
  expect(managementView({ access: access(true, true, true), overviewError: null, hadAccess: true })).toBe('show');
});
it('figures are asked for only once the server said yes, kept per person, and dropped when refused', () => {
  expect(managementOverviewKey('u1', DEFAULT_FILTERS)).not.toEqual(managementOverviewKey('u2', DEFAULT_FILTERS));
  const q = src('core/management-queries.ts');
  expect(q).toMatch(/function useManagementOverview[^]*enabled: !!userId && allowed/); expect(q).toMatch(/asUser: userId/); expect(q).not.toMatch(/reads\.read|readCache/);
  const s = src('screens/ManagementScreen.tsx');
  expect(s).toMatch(/view === 'show' \?/); expect(s).toMatch(/removeQueries\(\{ queryKey: managementRoot\(userId\) \}\)/);
});
it('“had access” belongs to the person who had it, and a refusal stays one until the server is asked again', () => {
  const s = src('screens/ManagementScreen.tsx');
  expect(s).toMatch(/if \(access\.allowed && userId\) hadAccessFor\.current = userId;/);
  expect(s).toMatch(/hadAccess: hadAccessFor\.current === userId/);
  expect(s).toMatch(/refusedFor === userId/);
  expect(s).toMatch(/if \(navigation\.canGoBack\(\)\) navigation\.goBack\(\);\s*else navigation\.navigate\('Tabs', \{ screen: 'Dashboard' \}\);/);
});
it('the PDF is the server’s, through the app’s exporter', () => { const s = src('screens/ManagementScreen.tsx'); expect(s).toMatch(/exportFile\(resources\.management\.pdfPath\(filters\), pdfFallbackName\(/); expect(s).toContain('Couldn’t make the PDF. Please try again.'); });
it('a tile opens its list only when it has something in it', () => expect(src('screens/ManagementScreen.tsx')).toMatch(/onPress=\{tile\.query \? \(\) => openList\(tile\.query!, tile\.label\) : undefined\}/));
it('two tiles to a row only where their words fit (a narrow phone or a large font: one)', () => {
  expect(tileColumns(360, 1)).toBe(2);
  expect(tileColumns(411, 1.3)).toBe(1);
  expect(tileColumns(360, 1.15)).toBe(1);
  expect(tileColumns(800, 2)).toBe(2);
  expect(src('screens/ManagementScreen.tsx')).toMatch(/tileColumns\(width, fontScale\)/);
});
it('the list sheet: the server’s list and words, each row opening the app’s screen', () => {
  const s = src('components/management/ItemsSheet.tsx');
  expect(s).toMatch(/useManagementItems\(filters, query\)/);
  expect(s).toMatch(/itemsStatus\(list, q\.isLoading\)/);
  expect(s).toMatch(/itemsFooter\(list\)/);
  expect(s).toMatch(/itemTarget\(row\)/);
  expect(s).toMatch(/applyNavAction\(/);
  for (const w of ['Nothing to list.', 'Couldn’t load this list.', 'Close']) expect(s).toContain(w);
  expect(s).not.toMatch(/\.reduce\(/);
});
it('the filters are the website’s rules', () => {
  const s = src('components/management/ManagementFilters.tsx');
  for (const w of ['toggleStatus(', 'chooseProjects(', 'isDefaultFilters(', 'PERIODS', 'STATUS_LABEL', 'Show all', 'Find a project', 'No project matches.', 'Owner: Anyone', 'Clear filters', 'Projects: All']) expect(s, w).toContain(w);
  expect(s).toMatch(/projects\.length > 8/);
});
it('no website fallback is left', () => expect(src('screens/ManagementScreen.tsx')).not.toMatch(/openWebsitePage/));
describe.skipIf(!hasWeb('frontend/src/pages/ManagementPage.tsx', 'frontend/src/components/management/ManagementFilters.tsx', 'frontend/src/components/management/ItemsSheet.tsx'))('the website’s words', () => {
  it('no-longer, access and PDF texts', () => { const p = readWeb('frontend/src/pages/ManagementPage.tsx'); for (const w of ['You no longer run any projects, so the Management page isn’t open to you.', 'Couldn’t check whether you can see this page.', 'Couldn’t make the PDF. Please try again.']) expect(p).toContain(w); });
  it('every sentence the screen shares with the website’s page', () => {
    const p = readWeb('frontend/src/pages/ManagementPage.tsx'), s = src('screens/ManagementScreen.tsx');
    for (const w of ['You no longer run any projects, so the Management page isn’t open to you.', 'It shows the projects you own or manage. An administrator can name you as a project’s manager.', 'Go to the dashboard', 'Couldn’t check whether you can see this page.', 'Check your connection, then try again.', 'Every project’s health, inspections, people and trends.', 'Download PDF', 'Loading the management overview', 'the management overview', 'the latest figures'])
      { expect(p, w).toContain(w); expect(s, w).toContain(w); }
  });
  it('the filters’ and the sheet’s words', () => {
    const f = readWeb('frontend/src/components/management/ManagementFilters.tsx'), sheet = readWeb('frontend/src/components/management/ItemsSheet.tsx');
    for (const w of ['Show all', 'Find a project', 'No project matches.', 'Owner: Anyone', 'Clear filters', 'Projects: All', '} weeks', 'chosen']) expect(f, w).toContain(w);
    for (const w of ['Nothing to list.', 'this list']) expect(sheet, w).toContain(w);
  });
});
