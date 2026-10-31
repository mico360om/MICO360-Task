import { it, expect } from 'vitest';
import { drawerSectionsFor } from './drawer-menu';
import { WEBSITE_LINK_PATHS, websitePageUrl } from '../lib/website';
import { appSource as src, appSources } from '../testing/web-source';

/** Stage 3 done (Task 17): the four screens are the app's own; only the pages left on the website open there. */
it('no Stage 3 screen falls back to its own page on the website', () => {
  for (const f of ['TimelineScreen', 'WorkloadScreen', 'ManagementScreen', 'MicoAiScreen']) expect(src(`screens/${f}.tsx`), f).not.toMatch(/'\/(timeline|workload|management|mico-ai)'/);
  for (const p of ['/timeline', '/workload', '/management', '/mico-ai']) expect(websitePageUrl('https://task.mico360.com/api/v1', p), p).toBeNull();
  expect(websitePageUrl('https://task.mico360.com/api/v1', '/templates')).not.toBeNull();
});

it('the phone says “tap” where the website says “click” (drift tests: testing/phone-words)', () => {
  const code = (t: string) => t.replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  expect(appSources().filter(([, text]) => /\bclick/i.test(code(text))).map(([f]) => f)).toEqual([]);
});

it('names sort the same on every phone: a collator names English, never the phone’s language', () => {
  expect(appSources().filter(([, text]) => /Intl\.Collator\((?!'en',)/.test(text)).map(([f]) => f)).toEqual([]);
  for (const f of ['lib/timeline.ts', 'lib/workload.ts', 'lib/management.ts']) expect(src(f), f).toMatch(/new Intl\.Collator\('en', \{ numeric: true, sensitivity: 'base' \}\)/);
});

it('Stage 3’s titles and figures use the display face where the website’s font-display does', () => {
  // [file, style, what it is on the website]; Timeline's figures are StatTile's (display role), ItemsSheet's title the Sheet's.
  const DISPLAY: Array<[file: string, style: string, rule: RegExp, website: string]> = [
    ['screens/MicoAiScreen.tsx', 'title', /font\('600', 'display'\)/, 'MicoAiPage.tsx chat title'],
    ['screens/MicoAiScreen.tsx', 'hello', /font\('600', 'display'\)/, 'MicoAiPage.tsx “How can I help”'],
    ['components/mico-ai/ProposalCard.tsx', 'heading', /font\('600', 'display'\)/, 'ProposalCard.tsx heading'],
    ['components/management/parts.tsx', 'title', /typeStyle\('heading'\)/, 'management/parts.tsx Section title'],
  ];
  const wrong = DISPLAY.filter(([file, style, rule]) => !rule.test(new RegExp(`\\n\\s+${style}: \\{[^\\n]*`).exec(src(file))?.[0] ?? '')).map(([f, st, , w]) => `${f} ${st} (website: ${w})`);
  expect(wrong).toEqual([]);
  expect(src('screens/TimelineScreen.tsx')).toMatch(/<StatTile/);
  expect(src('components/management/ItemsSheet.tsx')).toMatch(/<Sheet visible title=/);
});

it('the menu’s website rows are exactly the pages left on the website', () => {
  const rows = drawerSectionsFor(['ADMIN'], true).flatMap((s) => s.items).filter((i) => i.action.type === 'website');
  expect(rows.map((r) => (r.action as { path: string }).path).sort()).toEqual([...WEBSITE_LINK_PATHS].sort());
});
