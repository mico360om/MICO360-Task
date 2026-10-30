import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { appPath, appSource as src, appSources, hasWeb, readWeb } from '../testing/web-source';
import { DECISION_WORDS } from '../lib/approvals';

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

// Final review S10 + L6: a chip nothing happens on (a task's tags) is words, not a button TalkBack offers to press.
it('a chip without onPress is text, not a button; a disabled one says so', () => {
  const s = src('components/ui/Chip.tsx');
  expect(s).toMatch(/if \(!onPress\) \{\s*return \(\s*<View style=\{box\} accessible accessibilityRole="text" accessibilityLabel=\{name\} accessibilityState=\{selected \? \{ selected: true \} : undefined\}>/);
  expect(s).toMatch(/<Pressable\s+onPress=\{onPress\}\s+disabled=\{!!disabled\}/);
  expect(s).not.toMatch(/disabled=\{!!disabled \|\| !onPress\}/);
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

it('ProjectAvatar and IdentityPicker draw project icons, no emoji', () => {
  for (const f of ['components/ProjectAvatar.tsx', 'components/project/IdentityPicker.tsx']) {
    expect(src(f), f).toMatch(/<Icon name=\{`project\.\$\{/);
    expect(src(f), f).not.toMatch(/\p{Extended_Pictographic}/u);
  }
});

it('ApprovalChip says the website’s words with the hourglass', () => {
  // The words are the website's DECISION_WORDS (lib/approvals, drift-tested) since the lanes merged (Task 14).
  expect(src('components/ui/ApprovalChip.tsx')).toMatch(/misc\.waiting[^]*\{DECISION_WORDS\.waiting\}/);
  expect(src('components/ui/ApprovalChip.tsx')).toMatch(/accessibilityLabel=\{DECISION_WORDS\.waiting\}/);
  expect(DECISION_WORDS.waiting).toBe('Waiting for approval');
  if (hasWeb('frontend/src/components/approvals/ApprovalChip.tsx')) expect(readWeb('frontend/src/components/approvals/ApprovalChip.tsx')).toContain('Waiting for approval');
});

it('ui/index.ts also exports the identity and status primitives', () =>
  expect(exportsOf('components/ui/index.ts')).toEqual(expect.arrayContaining(['Avatar', 'StatTile', 'ApprovalChip', 'ProgressBar', 'BrandLogo', 'PageHeader'])));

it('the avatar shows only this server’s pictures and its initials otherwise', () => {
  const s = src('components/ui/Avatar.tsx');
  expect(s).toMatch(/serverFileHref\(baseUrl, src\)/);
  expect(s).toMatch(/personInitials\(name\)/);
  expect(s).toMatch(/onError=\{\(\) => setBroken\(true\)\}/);
});

it('the progress bar tells TalkBack how far along it is', () => {
  const s = src('components/ui/ProgressBar.tsx');
  expect(s).toMatch(/accessibilityRole="progressbar"/);
  expect(s).toMatch(/accessibilityValue=\{\{ min: 0, max: 100, now \}\}/);
});

it('the page header names the page for TalkBack and wraps its actions', () => {
  const s = src('components/ui/PageHeader.tsx');
  expect(s).toMatch(/accessibilityRole="header"/);
  expect(s).toMatch(/flexWrap: 'wrap'/);
});

it('the empty state has an icon bubble and an optional action', () => {
  const s = src('components/ui/EmptyState.tsx');
  expect(s).toMatch(/icon = 'misc\.inbox'/);
  expect(s).toMatch(/<Button title=\{action\.title\} onPress=\{action\.onPress\}/);
});
