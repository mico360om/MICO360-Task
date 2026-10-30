import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { appSources } from './testing/web-source';

/**
 * The look's house rules, checked over every app source file (src/**, not tests or src/testing):
 * the website's drawn icons instead of glyphs, colours only from the palette, the text tones for
 * text, the brand faces for weight, skeletons for a first load, faces through Avatar and the named
 * radii. Files the screen sweeps (Tasks 16–20) have not reached yet are listed in PENDING, one
 * block per sweep task; each sweep deletes its block, and a listed file that breaks nothing any
 * more fails the last test — so the list only shrinks. R3 and R4 hold everywhere already.
 */
const PENDING: Partial<Record<'task16' | 'task17' | 'task18' | 'task19' | 'task20', readonly string[]>> = {
  // Task 16 — Dashboard, My Tasks, boards, calendar
  task16: [
    'components/AdminTotals.tsx',
    'components/TaskRow.tsx',
    'components/board/BoardCard.tsx',
    'components/board/BoardColumnView.tsx',
    'components/board/BoardDayBar.tsx',
    'components/board/MoveCardSheet.tsx',
    'components/board/ProjectFilterSheet.tsx',
    'components/calendar/CalendarSheets.tsx',
    'components/calendar/CalendarTaskRow.tsx',
    'components/calendar/MonthGrid.tsx',
    'components/my-tasks/ChoiceSheet.tsx',
    'components/my-tasks/MyTaskItem.tsx',
    'screens/AllBoardScreen.tsx',
    'screens/BoardColumnsScreen.tsx',
    'screens/BoardScreen.tsx',
    'screens/CalendarScreen.tsx',
    'screens/DashboardScreen.tsx',
    'screens/MyTasksScreen.tsx',
  ],
  // Task 17 — task details and the task form
  task17: [
    'components/Mentions.tsx',
    'components/RecurrenceEditor.tsx',
    'components/task-detail/DetailsCard.tsx',
    'components/task-detail/FilePreviewSheet.tsx',
    'components/task-detail/HeaderCard.tsx',
    'components/task-detail/InfoCards.tsx',
    'components/task-detail/WorkCards.tsx',
    'components/task-detail/kit.tsx',
    'components/task-form/AssigneeField.tsx',
    'components/task-form/DescribeTask.tsx',
    'components/task-form/DueDateField.tsx',
    'components/task-form/FilesField.tsx',
    'lib/attachments.ts',
    'screens/NewTaskScreen.tsx',
    'screens/TaskDetailScreen.tsx',
  ],
  // Task 18 — projects, people, reports
  task18: [
    'components/charts.tsx',
    'components/project/AiSummaryCard.tsx',
    'components/project/IdentityPicker.tsx',
    'components/project/MeetingsTab.tsx',
    'components/project/OverviewTab.tsx',
    'components/project/TasksTab.tsx',
    'components/project/parts.tsx',
    'screens/ProjectDetailScreen.tsx',
    'screens/ProjectFormScreen.tsx',
    'screens/ProjectsScreen.tsx',
    'screens/ReportsScreen.tsx',
    'screens/UserFormScreen.tsx',
    'screens/UsersScreen.tsx',
  ],
};

/** UI glyphs: emoji and the arrows, ticks, stars, boxes and pluses that stood in for icons. */
const GLYPH = /[\p{Extended_Pictographic}\u{FE0F}‹›↑↓↻⊘⋯★☆☐☰✓✕✎■-◿＋]/gu;
/** Marks that are words, not icons. */
const NOT_A_GLYPH = new Set(['©', '®', '™']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A status fill used as a text colour (tools/codemods/status-text.js turns these into the text tones). */
const STATUS_TEXT = /(?<![A-Za-z])(color|tintColor|tabBarActiveTintColor|tabBarInactiveTintColor|headerTintColor|placeholderTextColor)(\s*[:=]\s*\{?\s*)(c|colors)\.(brand|danger|success|warning|info)\b/g;

const FILES = appSources();

/** The text a person can see: string literals, template text and JSX text (TypeScript's own parser). */
function shownText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const STRINGS = new Map(FILES.map(([f, text]) => [f, shownText(f, text)]));
const matchesOf = (re: RegExp, text: string) => [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map((m) => m[0]);

interface Rule {
  id: string;
  says: string;
  /** May a file on PENDING break it for now? */
  pendable: boolean;
  applies: (file: string) => boolean;
  /** What breaks it in this file (empty: nothing). */
  breaks: (file: string, text: string) => string[];
}

const RULES: Rule[] = [
  {
    id: 'R1',
    says: 'no UI glyphs in shown text — use <Icon> (chat emoji are content: lib/emoji.ts; 📎 is the website’s chat preview word)',
    pendable: true,
    applies: (f) => f !== 'lib/emoji.ts',
    breaks: (f) =>
      STRINGS.get(f)!
        .flatMap((s) => matchesOf(GLYPH, s))
        .filter((g) => !NOT_A_GLYPH.has(g) && !(f === 'lib/chat-model.ts' && g === '📎')),
  },
  {
    id: 'R2',
    says: 'no colour literals — colours come from lib/theme.ts (project colours from lib/project-identity.ts)',
    pendable: true,
    applies: (f) => f !== 'lib/theme.ts' && f !== 'lib/project-identity.ts',
    breaks: (f) => STRINGS.get(f)!.filter((s) => HEX.test(s.trim()) || /rgba?\(/i.test(s)),
  },
  {
    id: 'R3',
    says: 'no status fill as a text colour — text uses brandText/dangerText/successText/warningText/infoText',
    pendable: false,
    applies: (f) => f.endsWith('.tsx'),
    breaks: (_f, text) => matchesOf(STATUS_TEXT, text),
  },
  {
    id: 'R4',
    says: 'no fontWeight — the weight is the face: font(…) / typeStyle(…)',
    pendable: false,
    applies: (f) => f.endsWith('.tsx'),
    breaks: (_f, text) => matchesOf(/fontWeight\s*:/, text),
  },
  {
    id: 'R5',
    says: 'a screen’s first load shows <SkeletonList />, not <Loader />',
    pendable: true,
    applies: (f) => f.startsWith('screens/'),
    breaks: (_f, text) => matchesOf(/<Loader\b/, text),
  },
  {
    id: 'R7',
    says: 'initials circles only through <Avatar> (components/ui/Avatar.tsx)',
    pendable: true,
    applies: (f) => (f.startsWith('components/') || f.startsWith('screens/')) && f !== 'components/ui/Avatar.tsx',
    breaks: (_f, text) => matchesOf(/\bpersonInitials\(/, text),
  },
  {
    id: 'R8',
    says: 'the named radii — badge, input, button, card, sheet, pill — not radius.sm/md/lg',
    pendable: true,
    applies: () => true,
    breaks: (_f, text) => matchesOf(/\bradius\.(?:sm|md|lg)\b/, text),
  },
];

const pending = new Set(Object.values(PENDING).flat());
const sources = new Map(FILES);

describe('the style guard', () => {
  for (const rule of RULES) {
    it(`${rule.id}: ${rule.says}`, () => {
      const broken = FILES.filter(([f]) => rule.applies(f) && !(rule.pendable && pending.has(f)))
        .map(([f, text]) => [f, rule.breaks(f, text)] as const)
        .filter(([, found]) => found.length > 0)
        .map(([f, found]) => `${f}: ${[...new Set(found)].slice(0, 6).join(' ')}`);
      expect(broken).toEqual([]);
    });
  }

  it('the pending list only shrinks: every file on it still breaks a rule (else remove it from PENDING)', () => {
    const stale = [...pending].filter((f) => {
      const text = sources.get(f);
      if (text === undefined) return true;
      return !RULES.some((r) => r.pendable && r.applies(f) && r.breaks(f, text).length > 0);
    });
    expect(stale).toEqual([]);
    expect(pending.size).toBe(Object.values(PENDING).flat().length); // no file listed twice
  });
});
