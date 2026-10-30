import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { appPath, appSource as src, appSources } from '../testing/web-source';

/** The names a file exports (`export { A, B as C }`, `export function|const|class X`). */
function exportsOf(rel: string): string[] {
  const text = src(rel);
  const names: string[] = [];
  for (const [, list] of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of list!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '').trim();
      if (name) names.push(name);
    }
  }
  for (const [, name] of text.matchAll(/export\s+(?:function|const|class|interface|type)\s+(\w+)/g)) names.push(name!);
  return names;
}

it('components/ui.tsx is gone and ui/index.ts exports the primitives', () => {
  expect(existsSync(appPath('src/components/ui.tsx'))).toBe(false);
  expect(exportsOf('components/ui/index.ts')).toEqual(
    expect.arrayContaining(['Button', 'IconButton', 'Card', 'Badge', 'PriorityBadge', 'Chip', 'TextField', 'Toggle', 'AppText', 'Heading', 'Muted', 'SectionTitle', 'ErrorNote', 'NoticeNote', 'Loader', 'Skeleton', 'SkeletonList', 'EmptyState']),
  );
});

it('the primary button is the brand gradient, with the brand shadow, and keeps its name while busy', () => {
  const s = src('components/ui/Button.tsx');
  expect(s).toMatch(/<LinearGradient[^>]*colors=\{BRAND_GRADIENT\.colors\}/);
  expect(s).toMatch(/shadow\.brand/);
  expect(s).toMatch(/accessibilityLabel=\{accessibilityLabel \?\? title\}/);
  expect(s).toMatch(/busy: !!loading/);
});

it('the switch is a switch to TalkBack', () => expect(src('components/ui/Toggle.tsx')).toMatch(/accessibilityRole="switch"[^]*accessibilityState=\{\{ checked: on/));

it('the chip is a button that says whether it is selected, with a 44 dp touch target', () => {
  const s = src('components/ui/Chip.tsx');
  expect(s).toMatch(/accessibilityRole="button"/);
  expect(s).toMatch(/accessibilityState=\{\{ selected: !!selected, disabled: !!disabled \}\}/);
  expect(s).toMatch(/hitSlop=\{\{ top: 6, bottom: 6 \}\}/);
});

it('the skeleton stands still when the phone asks for less motion', () => expect(src('components/ui/Loading.tsx')).toMatch(/isReduceMotionEnabled\(\)/));

it('the task kit’s chip is the shared one', () => {
  const kit = src('components/task-detail/kit.tsx');
  expect(kit).toMatch(/export \{ Chip \} from '\.\.\/ui';/);
  expect(kit).not.toMatch(/export function Chip/);
});

it('no primitive sets a fontWeight or a colour literal', () => {
  const files = appSources().filter(([f]) => f.startsWith('components/ui/'));
  expect(files.length).toBeGreaterThanOrEqual(12);
  for (const [f, text] of files) {
    expect(text, f).not.toMatch(/fontWeight\s*:/);
    expect(text, f).not.toMatch(/'#[0-9a-f]{3,8}'|rgba?\(/i);
  }
});
