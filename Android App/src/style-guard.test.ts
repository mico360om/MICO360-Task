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
  // Task 19 — meetings (lane B)
  task19: [
    'components/MeetingRow.tsx',
    'components/meeting-form/AgendaDraftReview.tsx',
    'components/meeting-form/AgendaField.tsx',
    'components/meeting-form/DescribeMeeting.tsx',
    'components/meeting-form/FreeTimes.tsx',
    'components/meeting-form/PeopleField.tsx',
    'components/meeting-form/WriteDescription.tsx',
    'components/meeting/MeetingCard.tsx',
    'components/meeting/MeetingDetailParts.tsx',
    'components/meeting/MeetingFiltersSheet.tsx',
    'components/meeting/MeetingSheets.tsx',
    'components/meeting/PartSheets.tsx',
    'components/meeting/UpNextCard.tsx',
    'components/meeting/sheet-kit.tsx',
    'screens/FinalMinutesScreen.tsx',
    'screens/MeetingDetailScreen.tsx',
    'screens/MeetingFormScreen.tsx',
    'screens/MeetingsScreen.tsx',
    'screens/MyActionItemsScreen.tsx',
  ],
  // Task 20 — chat, notifications, account, sign-in and the rest (lane B)
  task20: [
    'adapters/push.ts',
    'components/ErrorBoundary.tsx',
    'components/LockGate.tsx',
    'components/SyncStatus.tsx',
    'components/UpdateBanner.tsx',
    'components/account/ChangePasswordCard.tsx',
    'components/account/DailyEmailSettings.tsx',
    'components/chat/ChatSheets.tsx',
    'components/chat/MessageParts.tsx',
    'lib/chat-ui.ts',
    'screens/AboutScreen.tsx',
    'screens/ActivityScreen.tsx',
    'screens/ChatScreen.tsx',
    'screens/ChatThreadScreen.tsx',
    'screens/NotificationsScreen.tsx',
    'screens/ProfileScreen.tsx',
    'screens/SearchScreen.tsx',
    'screens/SettingsScreen.tsx',
    'screens/auth/LoginScreen.tsx',
  ],
};

/** UI glyphs: emoji and the arrows, ticks, stars, boxes and pluses that stood in for icons. */
const GLYPH = /[\p{Extended_Pictographic}\u{FE0F}‹›↑↓↻⊘⋯★☆☐☰✓✕✎■-◿＋]/gu;
/** Marks that are words, not icons. */
const NOT_A_GLYPH = new Set(['©', '®', '™']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A status fill used as a text colour (tools/codemods/status-text.js turns these into the text tones). */
const STATUS_TEXT = /(?<![A-Za-z])(color|tintColor|tabBarActiveTintColor|tabBarInactiveTintColor|headerTintColor|placeholderTextColor)(\s*[:=]\s*\{?\s*)(c|colors)\.(brand|danger|success|warning|info)\b/g;
/**
 * Colour codes that are words, not styling (R2 allows exactly these): the example a "colour code"
 * box shows as its hint, for a person to read and type — content, not a colour the app paints.
 */
const COLOUR_TEXT_ALLOWED: Record<string, readonly string[]> = {
  'screens/BoardColumnsScreen.tsx': ['#1E5A8B'],
  'components/project/IdentityPicker.tsx': ['#1E5A8B'],
};

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
    breaks: (f) => STRINGS.get(f)!.filter((s) => (HEX.test(s.trim()) || /rgba?\(/i.test(s)) && !(COLOUR_TEXT_ALLOWED[f] ?? []).includes(s)),
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
