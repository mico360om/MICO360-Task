/**
 * Formatted meeting notes on the phone. The server keeps them in one fixed, safe HTML form (bold,
 * italic, underline, highlight, web / mail links, a heading, bulleted and numbered lists — see
 * Web Portal/backend/src/lib/rich-text.ts). The app has no HTML view (and wants none: no WebView),
 * so that HTML is read here into the same small model the server uses — blocks of formatted runs —
 * and drawn as plain Text. Nothing in a note is ever run or loaded; its words are only shown.
 */

export type RichMark = 'bold' | 'italic' | 'underline' | 'highlight';

/** A stretch of text with the same formatting; "\n" is a line break. */
export interface RichRun {
  text: string;
  marks: RichMark[];
  /** The link it is (http, https or mailto only). */
  href?: string;
}

export type RichBlock =
  | { kind: 'paragraph'; runs: RichRun[] }
  | { kind: 'heading'; runs: RichRun[] }
  /** A list item: bulleted or numbered, nested `level` deep (0 = top). */
  | { kind: 'item'; ordered: boolean; level: number; runs: RichRun[] };

const MARK_ORDER: RichMark[] = ['bold', 'italic', 'underline', 'highlight'];
const MARK_TAGS: Record<string, RichMark> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', cite: 'italic', u: 'underline', ins: 'underline', mark: 'highlight' };
/** Never read: their content isn't text a person wrote. */
const DROPPED = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'head', 'title', 'svg', 'math', 'select', 'button', 'textarea', 'video', 'audio', 'canvas']);
/** Have no content and no closing tag. */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'source', 'track', 'embed']);
/** Start a block of their own (their words are kept). */
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'pre', 'figure', 'figcaption', 'address', 'tr', 'dd', 'dt', 'table', 'caption', 'hr']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Deepest list nesting kept (deeper items stay at this level), as on the server. */
const MAX_LEVEL = 3;

/** A link address that is safe to follow: http(s) or mailto, else null. */
export function safeNoteHref(raw: string | null | undefined): string | null {
  const href = (raw ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href) ? href : null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text with its character references (&amp;, &#39;, &#x2014; …) turned back into characters. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function hrefOf(attrs: string): string | null {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? safeNoteHref(decode(m[1] ?? m[2] ?? m[3] ?? '')) : null;
}

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;

/** Read a formatted note's HTML into blocks of formatted runs (unknown tags give just their words). */
export function parseRichNote(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let current: RichBlock | null = null;
  const lists: boolean[] = []; // the open lists, outermost first: ordered or not
  const open: Array<{ tag: string; mark?: RichMark; href?: string | null }> = [];
  let skipping: string | null = null; // inside a dropped element (its closing tag ends it)

  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const target = (): RichBlock => {
    if (!current) current = lists.length ? { kind: 'item', ordered: lists[lists.length - 1]!, level: Math.min(lists.length - 1, MAX_LEVEL), runs: [] } : { kind: 'paragraph', runs: [] };
    return current;
  };
  const marksNow = (): RichMark[] => MARK_ORDER.filter((m) => open.some((o) => o.mark === m));
  const hrefNow = (): string | undefined => {
    for (let i = open.length - 1; i >= 0; i--) if (open[i]!.href) return open[i]!.href!;
    return undefined;
  };
  const addText = (text: string) => {
    if (!text) return;
    const marks = marksNow();
    const href = hrefNow();
    const block = target();
    const last = block.runs[block.runs.length - 1];
    if (last && last.href === href && last.marks.join() === marks.join()) last.text += text;
    else block.runs.push(href ? { text, marks, href } : { text, marks });
  };
  /** Close the innermost open element with this tag (and anything opened inside it). */
  const pop = (tag: string) => {
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i]!.tag === tag) {
        open.length = i;
        return;
      }
    }
  };

  for (const match of html.matchAll(TOKEN)) {
    const [whole, slash, rawTag, attrs = '', text] = match;
    if (whole.startsWith('<!--')) continue;
    if (text !== undefined || rawTag === undefined) {
      // Spaces, tabs and new lines run together into one space, as on a web page.
      if (!skipping) addText(decode(text ?? whole).replace(/\s+/g, ' '));
      continue;
    }
    const tag = rawTag.toLowerCase();
    const closing = slash === '/';
    if (skipping) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (DROPPED.has(tag)) {
      if (!closing && !VOID.has(tag) && !attrs.trim().endsWith('/')) skipping = tag;
      continue;
    }
    if (tag === 'br') {
      if (!closing) addText('\n');
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (!closing) addText(' ');
      continue;
    }
    const mark = MARK_TAGS[tag];
    if (mark || tag === 'a') {
      if (closing) pop(tag);
      else open.push(mark ? { tag, mark } : { tag, href: hrefOf(attrs) });
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      close();
      if (closing) lists.pop();
      else lists.push(tag === 'ol');
      continue;
    }
    if (tag === 'li') {
      close();
      if (!closing) current = { kind: 'item', ordered: lists[lists.length - 1] ?? false, level: Math.min(Math.max(lists.length - 1, 0), MAX_LEVEL), runs: [] };
      continue;
    }
    if (HEADINGS.has(tag)) {
      close();
      if (!closing) current = { kind: 'heading', runs: [] };
      continue;
    }
    if (BLOCKS.has(tag)) {
      // A paragraph inside a list item continues the item (on a new line after its first one).
      const inItem = (current as RichBlock | null)?.kind === 'item' && tag === 'p';
      if (inItem) {
        if (!closing && (current as RichBlock).runs.length) addText('\n');
      } else close();
    }
    // span, font, tbody, …: their words, nothing else
  }
  close();
  return blocks.map(tidy).filter((b) => b.runs.length > 0);
}

/** Spaces trimmed at the ends of a block and around its line breaks; empty runs dropped (as on the server). */
function tidy(block: RichBlock): RichBlock {
  const runs = block.runs.map((r) => ({ ...r, text: r.text.replace(/ *\n */g, '\n') }));
  while (runs.length && !runs[0]!.text.replace(/^[ \n]+/, '')) runs.shift();
  if (runs.length) runs[0] = { ...runs[0]!, text: runs[0]!.text.replace(/^[ \n]+/, '') };
  while (runs.length && !runs[runs.length - 1]!.text.replace(/[ \n]+$/, '')) runs.pop();
  if (runs.length) runs[runs.length - 1] = { ...runs[runs.length - 1]!, text: runs[runs.length - 1]!.text.replace(/[ \n]+$/, '') };
  for (let i = 1; i < runs.length; i++) {
    if (runs[i - 1]!.text.endsWith(' ') && runs[i]!.text.startsWith(' ')) runs[i] = { ...runs[i]!, text: runs[i]!.text.slice(1) };
  }
  return { ...block, runs: runs.filter((r) => r.text.length > 0) };
}

/**
 * Each block's list marker: null for a paragraph or heading, '•' for a bulleted item, "2." for a
 * numbered one (each list counts from 1; going back up a level carries on that level's count).
 */
export function listMarkers(blocks: RichBlock[]): Array<string | null> {
  const counters: number[] = [];
  let prev: RichBlock | null = null;
  return blocks.map((b) => {
    let marker: string | null = null;
    if (b.kind === 'item') {
      if (prev?.kind !== 'item') counters.length = 0;
      counters.length = Math.min(counters.length, b.level + 1);
      const prevSame = prev?.kind === 'item' && prev.level === b.level && prev.ordered === b.ordered;
      const back = prev?.kind === 'item' && prev.level > b.level && counters[b.level] !== undefined;
      counters[b.level] = prevSame || back ? (counters[b.level] ?? 0) + 1 : 1;
      marker = b.ordered ? `${counters[b.level]}.` : '•';
    } else {
      counters.length = 0;
    }
    prev = b;
    return marker;
  });
}

/** A note's words, whether written plain or formatted: lines, "- " / "1. " for list items, links with their address. */
export function noteWords(note: { body: string; bodyFormat?: 'PLAIN' | 'RICH' | null }): string {
  if (note.bodyFormat !== 'RICH') return note.body;
  const blocks = parseRichNote(note.body);
  const markers = listMarkers(blocks);
  const lines: string[] = [];
  blocks.forEach((b, bi) => {
    const words = b.runs.map((r) => (r.href && r.href !== r.text.trim() && `mailto:${r.text.trim()}` !== r.href ? `${r.text} (${r.href})` : r.text)).join('');
    if (b.kind === 'item') {
      const indent = '  '.repeat(b.level);
      const marker = markers[bi] === '•' ? '-' : markers[bi];
      lines.push(...words.split('\n').map((l, i) => (i === 0 ? `${indent}${marker} ${l}` : `${indent}  ${l}`)));
    } else lines.push(...words.split('\n'));
  });
  return lines.join('\n');
}
