import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { appSources } from './testing/web-source';

/**
 * The look's house rules, checked over every app source file (src/**, not tests or src/testing):
 * the website's drawn icons instead of glyphs, colours only from the palette, the text tones for
 * text, the brand faces for weight, skeletons for a first load, faces through Avatar and the named
 * radii. Every rule holds for every file (the Stage 1 sweeps, Tasks 16–20, reached them all).
 */

/** UI glyphs: emoji and the arrows, ticks, stars, boxes and pluses that stood in for icons. */
const GLYPH = /[\p{Extended_Pictographic}\u{FE0F}‹›↑↓↻⊘⋯★☆☐☰✓✕✎■-◿＋]/gu;
/** Marks that are words, not icons. */
const NOT_A_GLYPH = new Set(['©', '®', '™']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** The props whose value colours text or an icon (R3 reads their whole value, ternaries included). */
const TEXT_COLOUR_PROPS = new Set(['color', 'tintColor', 'tabBarActiveTintColor', 'tabBarInactiveTintColor', 'headerTintColor', 'placeholderTextColor']);
/** A status FILL read from the palette — not its …Text tone, …Soft wash, brandWash, brand2…: tools/codemods/status-text.js turns these into the text tones. */
const STATUS_FILL = /\b(?:c|colors|p)\.(?:brand|danger|success|warning|info)\b/g;
/** Components whose `color` paints a fill, not text (R3 allows exactly these): a progress bar's bar. */
const FILL_COLOUR_PROPS: Record<string, readonly string[]> = { ProgressBar: ['color'] };

/** The value of every text-colour prop in a file (style objects and JSX props), as source text. */
function textColourValues(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && TEXT_COLOUR_PROPS.has(n.name.text)) out.push(n.initializer.getText(sf));
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && TEXT_COLOUR_PROPS.has(n.name.text) && n.initializer) {
      const element = n.parent.parent;
      const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(sf) : '';
      if (!(FILL_COLOUR_PROPS[tag] ?? []).includes(n.name.text)) out.push(n.initializer.getText(sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
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

/** A "+" standing in for the plus icon: "+ New…" (a plus, a space, a word) or a full-width "＋". "+3 more" is a number. */
const PLUS_AS_ICON = /^\s*(?:\+\s+\p{L}|＋)/u;
/** The props whose string is a button's or a control's words. */
const LABEL_PROPS = new Set(['title', 'label']);

/** JSX text and title/label strings that start with a "+" for an icon (R1). */
function plusLabels(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const isText = (n: ts.Node | undefined): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => !!n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && PLUS_AS_ICON.test(n.text)) out.push(n.text.trim());
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && LABEL_PROPS.has(n.name.text) && n.initializer) {
      const v = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (isText(v) && PLUS_AS_ICON.test(v.text)) out.push(v.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const matchesOf = (re: RegExp, text: string) => [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map((m) => m[0]);

interface Rule {
  id: string;
  says: string;
  applies: (file: string) => boolean;
  /** What breaks it in this file (empty: nothing). */
  breaks: (file: string, text: string) => string[];
}

const RULES: Rule[] = [
  {
    id: 'R1',
    says: 'no UI glyphs in shown text — use <Icon> (chat emoji are content: lib/emoji.ts; 📎 is the website’s chat preview word)',
    applies: (f) => f !== 'lib/emoji.ts',
    breaks: (f, text) => [
      ...STRINGS.get(f)!
        .flatMap((s) => matchesOf(GLYPH, s))
        .filter((g) => !NOT_A_GLYPH.has(g) && !(f === 'lib/chat-model.ts' && g === '📎')),
      // "+ New meeting": the plus is the ui.plus icon (Button/IconButton `icon`), not a character.
      ...plusLabels(f, text),
    ],
  },
  {
    id: 'R2',
    says: 'no colour literals — colours come from lib/theme.ts (project colours from lib/project-identity.ts)',
    applies: (f) => f !== 'lib/theme.ts' && f !== 'lib/project-identity.ts',
    breaks: (f) => STRINGS.get(f)!.filter((s) => (HEX.test(s.trim()) || /rgba?\(/i.test(s)) && !(COLOUR_TEXT_ALLOWED[f] ?? []).includes(s)),
  },
  {
    id: 'R3',
    says: 'no status fill as a text colour — text uses brandText/dangerText/successText/warningText/infoText',
    applies: () => true,
    breaks: (f, text) => textColourValues(f, text).flatMap((v) => matchesOf(STATUS_FILL, v)),
  },
  {
    id: 'R4',
    says: 'no fontWeight — the weight is the face: font(…) / typeStyle(…)',
    // .ts and .tsx; lib/typography.ts is font() and typeStyle() themselves — they name the weight
    // only for the phone's own fonts, when the brand faces didn't load (core/fonts' gate).
    applies: (f) => f !== 'lib/typography.ts',
    breaks: (_f, text) => matchesOf(/fontWeight\s*:/, text),
  },
  {
    id: 'R5',
    says: 'a screen’s first load shows <SkeletonList />, not <Loader />',
    applies: (f) => f.startsWith('screens/'),
    breaks: (_f, text) => matchesOf(/<Loader\b/, text),
  },
  {
    id: 'R7',
    says: 'initials circles only through <Avatar> (components/ui/Avatar.tsx)',
    applies: (f) => (f.startsWith('components/') || f.startsWith('screens/')) && f !== 'components/ui/Avatar.tsx',
    breaks: (_f, text) => matchesOf(/\bpersonInitials\(/, text),
  },
  {
    // Final review S8: one switch everywhere — the website's 44×24 track (Toggle), never the phone's own.
    id: 'R9',
    says: 'switches are the shared <Toggle> (components/ui/Toggle.tsx), not react-native’s Switch',
    applies: (f) => f !== 'components/ui/Toggle.tsx',
    breaks: (_f, text) => matchesOf(/import \{[^}]*\bSwitch\b[^}]*\} from 'react-native'/, text),
  },
  {
    id: 'R8',
    says: 'the named radii — badge, input, button, card, sheet, pill — not radius.sm/md/lg',
    applies: () => true,
    breaks: (_f, text) => matchesOf(/\bradius\.(?:sm|md|lg)\b/, text),
  },
];

// Final review S9: R1 also finds a "+" standing in for the plus icon in JSX text and title/label props.
it('R1 finds "+ New…" and "＋" in JSX text and title/label strings, not "+3 more"', () => {
  expect(plusLabels('x.tsx', '<Button title="+ New meeting" />')).toEqual(['+ New meeting']);
  expect(plusLabels('x.tsx', "<Chip label={'＋Tag'} />")).toEqual(['＋Tag']);
  expect(plusLabels('x.tsx', '<Text>+ Add assignee</Text>')).toEqual(['+ Add assignee']);
  expect(plusLabels('x.tsx', '<Text>+ {n} more</Text>')).toEqual([]);
  expect(plusLabels('x.tsx', '<Text>+3 more</Text>')).toEqual([]);
  expect(plusLabels('x.tsx', '<Field placeholder="+ 971 50 123 4567" />')).toEqual([]);
});

// Final review L11: R4 reads .ts files too (a style made in lib/ is still a style).
it('R4 covers .ts as well as .tsx files, all but lib/typography.ts', () => {
  const r4 = RULES.find((r) => r.id === 'R4')!;
  expect(r4.applies('lib/chat-ui.ts')).toBe(true);
  expect(r4.applies('components/ui/Text.tsx')).toBe(true);
  expect(r4.applies('lib/typography.ts')).toBe(false);
  expect(r4.breaks('lib/x.ts', "export const s = { fontWeight: '700' };")).toEqual(['fontWeight:']);
});

describe('the style guard', () => {
  for (const rule of RULES) {
    it(`${rule.id}: ${rule.says}`, () => {
      const broken = FILES.filter(([f]) => rule.applies(f))
        .map(([f, text]) => [f, rule.breaks(f, text)] as const)
        .filter(([, found]) => found.length > 0)
        .map(([f, found]) => `${f}: ${[...new Set(found)].slice(0, 6).join(' ')}`);
      expect(broken).toEqual([]);
    });
  }
});
