import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { dialogLayer, dialogPanel, TWO_COLUMNS_QUERY, type DialogSize } from './dialog-size';

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe('the one window size scale (1.22)', () => {
  it('small windows stay narrow: a question 384px, a short prompt 448px — a centred card on every screen', () => {
    expect(classes(dialogPanel('confirm'))).toContain('max-w-sm');
    expect(classes(dialogPanel('small'))).toContain('max-w-md');
    for (const size of ['confirm', 'small'] as DialogSize[]) {
      expect(classes(dialogPanel(size))).toContain('max-h-[calc(var(--visible-height)-2rem)]');
      expect(classes(dialogPanel(size))).not.toContain('h-full');
      expect(classes(dialogLayer(size))).toEqual(expect.arrayContaining(['above-keyboard', 'fixed', 'inset-0', 'p-4']));
    }
  });

  it('a normal form is 720px; a big form 720px on a tablet and 960px from 1024px', () => {
    expect(classes(dialogPanel('form'))).toContain('sm:max-w-[45rem]');
    expect(classes(dialogPanel('form'))).not.toContain('lg:max-w-[60rem]');
    expect(classes(dialogPanel('wide'))).toEqual(expect.arrayContaining(['sm:max-w-[45rem]', 'lg:max-w-[60rem]']));
    expect(TWO_COLUMNS_QUERY).toBe('(min-width: 64em)');
  });

  it('forms fill a phone’s screen (no margin, no rounded corners) and are a centred card from 640px, never taller than the window', () => {
    for (const size of ['form', 'wide'] as DialogSize[]) {
      const panel = classes(dialogPanel(size));
      expect(panel).toEqual(expect.arrayContaining(['h-full', 'w-full', 'max-sm:rounded-none', 'max-sm:border-0', 'sm:h-auto', 'sm:max-h-[calc(var(--visible-height)-2rem)]']));
      const layer = classes(dialogLayer(size));
      expect(layer).toEqual(expect.arrayContaining(['above-keyboard', 'fixed', 'inset-0', 'sm:p-4']));
      expect(layer).not.toContain('p-4');
    }
  });
});

// Every window sizes itself from the scale — no window picks its own width. Panels that are not
// windows on the scale: side panels and sheets, the phone menu, picture viewers and the calendar's
// bottom sheets.
const NOT_ON_THE_SCALE = new Set([
  'components/AppShell.tsx',
  'components/chat/parts.tsx',
  'components/management/ItemsSheet.tsx',
  'components/task-drawer/attachments.tsx',
  'components/TaskDrawer.tsx',
  'components/TaskDrawerContainer.tsx',
  'components/calendar/dialogs.tsx',
  'components/shortcuts/ShortcutProvider.tsx',
  'pages/MicoAiPage.tsx',
]);
const src = resolve(__dirname, '../..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('windows use the scale', () => {
  const windows = files(src)
    .map((f) => ({ at: relative(src, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }))
    .filter((f) => /aria-modal="true"/.test(f.text) && !NOT_ON_THE_SCALE.has(f.at));

  it('there are windows to check', () => {
    expect(windows.length).toBeGreaterThanOrEqual(20);
  });

  it.each(windows.map((w) => [w.at, w.text]))('%s takes its size and its layer from the scale', (_at, text) => {
    expect(text).toMatch(/dialogPanel\(('(confirm|small|form|wide)'|size)/);
    expect(text).toMatch(/dialogLayer\(('(confirm|small|form|wide)'|size)/);
    // …and no width of its own beside it.
    const own = text.split('\n').filter((line) => /animate-scale-in/.test(line) && /\b(sm:|md:|lg:)?max-w-(sm|md|lg|xl|2xl|3xl|4xl|\[)/.test(line));
    expect(own).toEqual([]);
  });
});
