import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

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
