import { it, expect } from 'vitest';
import ts from 'typescript';
import { appSource as src, appSources, hasWeb, readWeb } from '../testing/web-source';

/** Fixes from the final review of Stage 1 that are checked in the source. */

// Item 4: ink3 is never put on brandWash (4.48:1) — a selected saved view is brandWash.
it('the delete mark on a saved view reads on its selected wash', () => {
  expect(src('screens/MyTasksScreen.tsx')).not.toMatch(/<Icon name="ui\.close" size=\{14\} color=\{c\.ink3\} \/>/);
});

// Item 5: a chip's count is drawn at full strength (an opacity took it under 4.5:1).
it('the chip count has no opacity', () => expect(src('components/ui/Chip.tsx')).not.toMatch(/count: \{[^}]*opacity/));

// Item 6 (S3): my bubble's receipts — read in readOnBrand with the bold ticks, the rest white at 80%.
it('read receipts on my bubble are told apart by colour and weight, as on the website', () => {
  const parts = src('components/chat/MessageParts.tsx');
  expect(parts).toMatch(/receipt\.read \? c\.readOnBrand : c\.onBrand/);
  expect(parts).toMatch(/strokeWidth=\{receipt\.read \? 2\.6 : undefined\}/);
  expect(parts).toMatch(/receipt\.read \? null : s\.quietReceipt/);
  expect(parts).not.toMatch(/label\.startsWith\('Read'\)/);
});

// Item 7 (S5): titles and figures in Archivo wherever the website sets the same element in font-display
// (its weight: font-bold 700, font-semibold 600, font-extrabold 800).
it('titles and figures use the display face, as the website’s font-display', () => {
  const DISPLAY: Array<[file: string, style: string, weight: string, website: string]> = [
    ['components/task-detail/HeaderCard.tsx', 'title', '700', 'task-drawer/inline-text.tsx'],
    ['screens/ProjectsScreen.tsx', 'name', '700', 'projects/ProjectCard.tsx'],
    ['screens/ProjectDetailScreen.tsx', 'name', '700', 'pages/ProjectDetailPage.tsx'],
    ['components/project/parts.tsx', 'tileValue', '700', 'pages/ProjectDetailPage.tsx tiles'],
    ['components/meeting/MeetingDetailParts.tsx', 'title', '700', 'meeting/MeetingHeader.tsx'],
    ['components/meeting/MeetingDetailParts.tsx', 'sectionTitle', '600', 'meeting/kit.tsx SectionCard'],
    ['components/meeting/MeetingCard.tsx', 'leafDay', '700', 'meeting/meeting-card-parts.tsx DateLeaf'],
    ['components/meeting/UpNextCard.tsx', 'title', '700', 'meeting/UpNextCard.tsx'],
    ['components/meeting/sheet-kit.tsx', 'title', '700', 'MeetingFormModal / MoveTaskDialog titles'],
    ['screens/MeetingsScreen.tsx', 'groupTitle', '600', 'pages/MeetingsPage.tsx day groups'],
    ['screens/DashboardScreen.tsx', 'greeting', '800', 'pages/DashboardPage.tsx'],
    ['screens/ReportsScreen.tsx', 'bigValue', '700', 'pages/ReportsPage.tsx on-time figures'],
    ['screens/ReportsScreen.tsx', 'miniValue', '700', 'pages/ReportsPage.tsx Mini'],
    ['screens/ProfileScreen.tsx', 'name', '700', 'pages/ProfilePage.tsx'],
  ];
  const wrong = DISPLAY.filter(([file, style, weight]) => {
    const rule = new RegExp(`\\n\\s+${style}: \\{[^\\n]*`).exec(src(file))?.[0] ?? '';
    return !rule.includes(`font('${weight}', 'display')`);
  }).map(([file, style, , website]) => `${file} ${style} (website: ${website})`);
  expect(wrong).toEqual([]);
  // The page title and the stat tiles' numbers already are (PageHeader: title role; StatTile: display role).
  expect(src('components/ui/PageHeader.tsx')).toMatch(/typeStyle\('title'\)/);
  expect(src('components/ui/StatTile.tsx')).toMatch(/typeStyle\('display'\)/);
});

// Item 8 (S6): task keys in Search hints and blocker rows are the website's font-mono text-xs text-ink-2
// (GlobalSearch.tsx, task-drawer/dependencies.tsx): monospace, not bold — no face spread a monospace overrides.
it('task keys in Search and blockers are plain monospace, as on the website', () => {
  for (const [file, key] of [['screens/SearchScreen.tsx', 'hint'], ['components/task-detail/InfoCards.tsx', 'refKey']] as const) {
    const rule = new RegExp(`\\n\\s+${key}: \\{[^\\n]*`).exec(src(file))?.[0] ?? '';
    expect(rule, file).toMatch(/fontFamily: 'monospace'/);
    expect(rule, file).not.toMatch(/font\(/);
  }
});

// Item 12 (S14): the side menu's Chat count grows with a large font instead of being clipped by a fixed
// height; like IconButton's badge it stops growing at 1.3.
it('the side menu’s Chat count is never clipped', () => {
  const drawer = src('components/AppDrawer.tsx');
  const badge = /\n\s+badge: \{[^\n]*/.exec(drawer)?.[0] ?? '';
  expect(badge).toMatch(/minHeight: 20/);
  expect(badge).not.toMatch(/[^n]height: 20/);
  expect(drawer).toMatch(/s\.badgeText[^>]*\bnumberOfLines=\{1\} maxFontSizeMultiplier=\{1\.3\}>\{badge\}/);
});

// Item 13 (L8): on a tablet (≥ 768 dp) the tab label sits beside its icon; bottom-tabs gives its own
// labels 20 dp there (BottomTabItem labelBeside), so our label does too.
it('a tab label beside its icon keeps the 20 dp bottom-tabs gives its own labels', () => {
  const nav = src('navigation/RootNavigator.tsx');
  expect(nav).toMatch(/tabBarLabel: \(\{ color, position \}\) =>/);
  expect(nav).toMatch(/position === 'beside-icon' \? TAB_LABEL_BESIDE : null/);
  expect(nav).toMatch(/const TAB_LABEL_BESIDE = \{ marginLeft: 20 \}/);
});

// Item 16 (S7): a row that already says "Waiting for approval", "favorite" or "% done" in its own label
// keeps the mark from being a TalkBack stop of its own, as its siblings are.
it('marks a row already speaks are hidden from TalkBack inside it', () => {
  const HIDDEN = /importantForAccessibility="no-hide-descendants"[^>]*>\s*/.source;
  const wrapped: Array<[file: string, inner: string]> = [
    ['components/board/BoardCard.tsx', '<ApprovalChip />'],
    ['components/my-tasks/MyTaskItem.tsx', '<ApprovalChip />'],
    ['screens/ChatScreen.tsx', '<Icon name="ui.starFilled"'],
    ['screens/ProjectsScreen.tsx', '<ProgressBar value={meta.completedPct}'],
  ];
  const bare = wrapped.filter(([file, inner]) => !new RegExp(HIDDEN + inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src(file)));
  expect(bare.map(([f, i]) => `${f}: ${i}`)).toEqual([]);
});

// Item 17 (S11): the Profile photo is the website's size (h-28 = 112) with its gradient initials, and
// TalkBack says "Your profile photo" / "No profile photo" again (as before the new look).
it('the Profile photo is the website’s xl avatar and says what it shows', () => {
  const avatar = src('components/ui/Avatar.tsx');
  expect(avatar).toMatch(/label\?: boolean \| string \| AvatarLabels/);
  expect(avatar).toMatch(/<LinearGradient colors=\{BRAND_GRADIENT\.colors\}/);
  expect(avatar).toMatch(/size === 'xl'/);
  expect(avatar).toMatch(/xlText: \{ \.\.\.font\('700'\)/);
  const profile = src('screens/ProfileScreen.tsx');
  expect(profile).toMatch(/<Avatar[^>]*size="xl"[^>]*label=\{\{ photo: 'Your profile photo', initials: 'No profile photo' \}\}/);
  if (hasWeb('frontend/src/pages/ProfilePage.tsx')) {
    const web = readWeb('frontend/src/pages/ProfilePage.tsx');
    expect(web).toMatch(/className="h-28 w-28 rounded-full border border-line object-cover shadow-soft"/);
    expect(web).toMatch(/className="grid h-28 w-28 place-items-center rounded-full bg-brand-gradient text-3xl font-bold text-white shadow-brand"/);
  }
});

// Item 18 (S17): a Chip is a button that says "selected" (Task 4 ruling), so a row of Chips is no
// radiogroup — TalkBack would announce radio buttons that are not there. Rows of real radios
// (accessibilityRole="radio") keep theirs.
it('no radiogroup holds Chips', () => {
  const found: string[] = [];
  for (const [file, text] of appSources().filter(([f]) => f.endsWith('.tsx'))) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tags = (n: ts.Node, out: string[] = []): string[] => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n.tagName.getText(sf));
      ts.forEachChild(n, (k) => void tags(k, out));
      return out;
    };
    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n) && /accessibilityRole="radiogroup"/.test(n.openingElement.getText(sf)) && tags(n).slice(1).includes('Chip')) {
        found.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  expect(found).toEqual([]);
});

// Item 21 (S13): the website calls them notifications (its page "Notifications", "Mark all read"); the
// Alerts tab is gone (the bell opens this screen).
it('Mark all read says "notifications", as the website', () => {
  const s = src('screens/NotificationsScreen.tsx');
  expect(s).toContain("announceForAccessibility('All notifications marked as read.')");
  expect(s).not.toMatch(/All alerts|Alerts tab|tab's number/);
  if (hasWeb('frontend/src/pages/NotificationsPage.tsx')) expect(readWeb('frontend/src/pages/NotificationsPage.tsx')).toMatch(/title="Notifications"/);
});

// Item 23 (S8): a board column's "Visible" switch is the shared Toggle, still saying what it does.
it('the board columns’ visibility switch is the shared Toggle', () => {
  const s = src('screens/BoardColumnsScreen.tsx');
  expect(s).toMatch(/<Toggle on=\{shown\} onChange=\{onEnabled\} disabled=\{busy\} label=\{shown \? 'Visible' : 'Hidden'\} a11yLabel=\{`Show \$\{col\.name\} on the board`\} \/>/);
  expect(src('components/ui/Toggle.tsx')).toMatch(/accessibilityLabel=\{a11yLabel \?\? label\}/);
});

// Item 20 (S12): while the totals load, TalkBack hears "All tasks: loading" (as before the new look),
// not "All tasks: —"; the tile still shows the dash.
it('the administrators’ totals say "loading" while they load', () => {
  const tile = src('components/ui/StatTile.tsx');
  expect(tile).toMatch(/spokenValue\?: string;/);
  expect(tile).toMatch(/const name = `\$\{label\}: \$\{spokenValue \?\? value\}/);
  const totals = src('components/AdminTotals.tsx');
  expect(totals).toMatch(/value=\{ready \? t\.value : '—'\}\s*spokenValue=\{ready \? undefined : 'loading'\}/);
});
