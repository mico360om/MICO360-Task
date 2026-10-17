/**
 * Formatted meeting notes in the browser: bold, italic, underline, highlight, web/mail links, a
 * heading and bulleted / numbered lists. The server keeps them in one safe, fixed HTML form
 * (backend lib/rich-text.ts); here that HTML is read into the same small model — never inserted
 * as HTML — to show a note (RichNoteView) or take its words (tasks made from a note).
 */

export type RichMark = 'bold' | 'italic' | 'underline' | 'highlight';

/** A stretch of text with the same formatting; "\n" is a line break. */
export interface RichRun {
  text: string;
  marks: RichMark[];
  href?: string;
}

export type RichBlock =
  | { kind: 'paragraph'; runs: RichRun[] }
  | { kind: 'heading'; runs: RichRun[] }
  | { kind: 'item'; ordered: boolean; level: number; runs: RichRun[] };

export type NoteBodyFormat = 'PLAIN' | 'RICH';

const MARK_ORDER: RichMark[] = ['bold', 'italic', 'underline', 'highlight'];
const MARK_TAGS: Record<string, RichMark> = { STRONG: 'bold', B: 'bold', EM: 'italic', I: 'italic', CITE: 'italic', U: 'underline', INS: 'underline', MARK: 'highlight' };
const DROPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'HEAD', 'TITLE', 'SVG', 'MATH', 'SELECT', 'BUTTON', 'TEXTAREA', 'INPUT', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS']);
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'TR', 'DD', 'DT', 'TABLE', 'CAPTION', 'HR']);
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const MAX_LEVEL = 3;

/** A link address that is safe to follow: http(s) or mailto, else null. */
export function safeHref(raw: string | null | undefined): string | null {
  const href = (raw ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href) ? href : null;
}

/** Read note HTML into blocks (an inert document: nothing in it runs or loads). */
export function parseRichHtml(html: string): RichBlock[] {
  const body = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
  const blocks: RichBlock[] = [];
  let current: RichBlock | null = null;
  const lists: boolean[] = [];
  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const target = (): RichBlock => {
    if (!current) current = lists.length ? { kind: 'item', ordered: lists[lists.length - 1]!, level: Math.min(lists.length - 1, MAX_LEVEL), runs: [] } : { kind: 'paragraph', runs: [] };
    return current;
  };
  const addText = (text: string, marks: RichMark[], href?: string) => {
    if (!text) return;
    const block = target();
    const last = block.runs[block.runs.length - 1];
    if (last && last.href === href && last.marks.join() === marks.join()) last.text += text;
    else block.runs.push(href ? { text, marks: [...marks], href } : { text, marks: [...marks] });
  };
  const walk = (node: Node, marks: RichMark[], href: string | undefined): void => {
    if (node.nodeType === Node.TEXT_NODE) return addText((node.nodeValue ?? '').replace(/\s+/g, ' '), marks, href);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (DROPPED.has(tag)) return;
    const kids = (m = marks, h = href) => node.childNodes.forEach((c) => walk(c, m, h));
    if (tag === 'BR') return addText('\n', marks, href);
    if (tag === 'TD' || tag === 'TH') {
      addText(' ', marks, href);
      return kids();
    }
    const mark = MARK_TAGS[tag];
    if (mark) return kids(marks.includes(mark) ? marks : MARK_ORDER.filter((m) => m === mark || marks.includes(m)));
    if (tag === 'A') return kids(marks, safeHref((node as Element).getAttribute('href')) ?? href);
    if (tag === 'UL' || tag === 'OL') {
      close();
      lists.push(tag === 'OL');
      kids();
      close();
      lists.pop();
      return;
    }
    if (tag === 'LI') {
      close();
      current = { kind: 'item', ordered: lists[lists.length - 1] ?? false, level: Math.min(Math.max(lists.length - 1, 0), MAX_LEVEL), runs: [] };
      kids();
      close();
      return;
    }
    if (HEADINGS.has(tag)) {
      close();
      current = { kind: 'heading', runs: [] };
      kids();
      close();
      return;
    }
    if (BLOCKS.has(tag)) {
      const inItem = (current as RichBlock | null)?.kind === 'item' && tag === 'P';
      if (inItem && (current as RichBlock).runs.length) addText('\n', marks, href);
      else if (!inItem) close();
      kids();
      if (!inItem) close();
      return;
    }
    kids();
  };
  body.childNodes.forEach((n) => walk(n, [], undefined));
  close();
  return blocks.map(tidy).filter((b) => b.runs.length > 0);
}

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

/** Each block's list marker: null, '-' for a bullet, or "2." (each list counts from 1). */
function listMarkers(blocks: RichBlock[]): Array<string | null> {
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
      marker = b.ordered ? `${counters[b.level]}.` : '-';
    } else counters.length = 0;
    prev = b;
    return marker;
  });
}

/** The words of formatted note HTML: lines, "- " / "1. " for list items, links with their address. */
export function richPlainText(html: string): string {
  const blocks = parseRichHtml(html);
  const markers = listMarkers(blocks);
  const lines: string[] = [];
  blocks.forEach((b, bi) => {
    const words = b.runs.map((r) => (r.href && r.href !== r.text.trim() && `mailto:${r.text.trim()}` !== r.href ? `${r.text} (${r.href})` : r.text)).join('');
    if (b.kind === 'item') {
      const indent = '  '.repeat(b.level);
      lines.push(...words.split('\n').map((l, i) => (i === 0 ? `${indent}${markers[bi]} ${l}` : `${indent}  ${l}`)));
    } else lines.push(...words.split('\n'));
  });
  return lines.join('\n');
}

/** A note's words, whether it was written plain or formatted. */
export function noteWords(note: { body: string; bodyFormat?: NoteBodyFormat | null }): string {
  return note.bodyFormat === 'RICH' ? richPlainText(note.body) : note.body;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A plain note opened in the formatted editor: one paragraph per line, its words escaped. */
export function plainToRichHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}
