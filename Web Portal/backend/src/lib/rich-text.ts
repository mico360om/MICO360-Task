/**
 * Formatted text (meeting notes): bold, italic, underline, highlight, web/mail links, a heading and
 * bulleted / numbered lists — nothing else.
 *
 * Whatever HTML arrives (the editor's, or something pasted into it) is read into a small model
 * (`RichBlock`s of `RichRun`s) and written back from that model in one fixed form. So only those
 * kinds of formatting can ever be stored, printed or shown: no scripts, styles, attributes or
 * unsafe links survive, and every piece of text is escaped. The PDF and the plain words (search,
 * tasks, the AI) are drawn from the same model.
 */
import { parseFragment } from 'parse5';

export type RichMark = 'bold' | 'italic' | 'underline' | 'highlight';

/** A stretch of text with the same formatting. A "\n" in it is a line break. */
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
const DROPPED = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'head', 'title', 'svg', 'math', 'select', 'button', 'textarea', 'input', 'img', 'video', 'audio', 'canvas']);
/** Start a block of their own (their words are kept). */
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'pre', 'figure', 'figcaption', 'address', 'tr', 'dd', 'dt', 'table', 'caption', 'hr']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Deepest list nesting kept (deeper items stay at this level). */
export const MAX_LIST_LEVEL = 3;

/** A link address that is safe to keep: http(s) or mailto, else null. */
export function safeHref(raw: string | undefined): string | null {
  const href = (raw ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href) ? href : null;
}

interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
}

/** Read any HTML into blocks of formatted runs (see the module comment). */
export function parseRichHtml(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let current: RichBlock | null = null;
  const lists: boolean[] = []; // the open lists, outermost first: ordered or not

  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const open = (block: RichBlock) => {
    close();
    current = block;
  };
  const target = (): RichBlock => {
    if (!current) current = lists.length ? { kind: 'item', ordered: lists[lists.length - 1]!, level: Math.min(lists.length - 1, MAX_LIST_LEVEL), runs: [] } : { kind: 'paragraph', runs: [] };
    return current;
  };
  const addText = (text: string, marks: RichMark[], href?: string) => {
    if (!text) return;
    const block = target();
    const last = block.runs[block.runs.length - 1];
    if (last && last.href === href && last.marks.join() === marks.join()) last.text += text;
    else block.runs.push(href ? { text, marks: [...marks], href } : { text, marks: [...marks] });
  };

  const walk = (node: P5Node, marks: RichMark[], href: string | undefined) => {
    if (node.nodeName === '#text') {
      // Spaces, tabs and new lines run together into one space, as on a web page.
      addText((node.value ?? '').replace(/\s+/g, ' '), marks, href);
      return;
    }
    const tag = node.tagName;
    if (!tag) return; // comments, doctypes
    if (DROPPED.has(tag)) return;
    const kids = () => node.childNodes?.forEach((c) => walk(c, marks, href));

    if (tag === 'br') return addText('\n', marks, href);
    if (tag === 'td' || tag === 'th') {
      addText(' ', marks, href);
      return kids();
    }
    const mark = MARK_TAGS[tag];
    if (mark) {
      const next = marks.includes(mark) ? marks : MARK_ORDER.filter((m) => m === mark || marks.includes(m));
      node.childNodes?.forEach((c) => walk(c, next, href));
      return;
    }
    if (tag === 'a') {
      const link = safeHref(node.attrs?.find((a) => a.name === 'href')?.value) ?? href;
      node.childNodes?.forEach((c) => walk(c, marks, link ?? undefined));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      close();
      lists.push(tag === 'ol');
      kids();
      close();
      lists.pop();
      return;
    }
    if (tag === 'li') {
      open({ kind: 'item', ordered: lists[lists.length - 1] ?? false, level: Math.min(Math.max(lists.length - 1, 0), MAX_LIST_LEVEL), runs: [] });
      kids();
      close();
      return;
    }
    if (HEADINGS.has(tag)) {
      open({ kind: 'heading', runs: [] });
      kids();
      close();
      return;
    }
    if (BLOCKS.has(tag)) {
      // A paragraph inside a list item continues the item on a new line.
      const inItem = (current as RichBlock | null)?.kind === 'item' && tag === 'p';
      if (inItem && (current as RichBlock).runs.length) addText('\n', marks, href);
      else if (!inItem) close();
      kids();
      if (!inItem) close();
      return;
    }
    kids(); // span, font, tbody, … : their words, nothing else
  };

  for (const node of (parseFragment(html) as unknown as P5Node).childNodes ?? []) walk(node, [], undefined);
  close();
  return blocks.map(tidy).filter((b) => b.runs.length > 0);
}

/** Spaces trimmed at the ends of a block and around its line breaks; empty runs dropped. */
function tidy(block: RichBlock): RichBlock {
  const runs = block.runs.map((r) => ({ ...r, text: r.text.replace(/ *\n */g, '\n') }));
  // Leading / trailing spaces and breaks of the block as a whole.
  while (runs.length && !runs[0]!.text.replace(/^[ \n]+/, '')) runs.shift();
  if (runs.length) runs[0] = { ...runs[0]!, text: runs[0]!.text.replace(/^[ \n]+/, '') };
  while (runs.length && !runs[runs.length - 1]!.text.replace(/[ \n]+$/, '')) runs.pop();
  if (runs.length) runs[runs.length - 1] = { ...runs[runs.length - 1]!, text: runs[runs.length - 1]!.text.replace(/[ \n]+$/, '') };
  // A space at a run boundary twice over ("a <b> b</b>") becomes one.
  for (let i = 1; i < runs.length; i++) {
    if (runs[i - 1]!.text.endsWith(' ') && runs[i]!.text.startsWith(' ')) runs[i] = { ...runs[i]!, text: runs[i]!.text.slice(1) };
  }
  return { ...block, runs: runs.filter((r) => r.text.length > 0) };
}

/** Nothing written in it (only spaces or nothing at all). */
export function isRichEmpty(blocks: RichBlock[]): boolean {
  return !blocks.some((b) => b.runs.some((r) => r.text.trim()));
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

function runsHtml(runs: RichRun[]): string {
  return runs
    .map((r) => {
      let html = escapeText(r.text).replace(/\n/g, '<br>');
      if (r.marks.includes('highlight')) html = `<mark>${html}</mark>`;
      if (r.marks.includes('underline')) html = `<u>${html}</u>`;
      if (r.marks.includes('italic')) html = `<em>${html}</em>`;
      if (r.marks.includes('bold')) html = `<strong>${html}</strong>`;
      if (r.href) html = `<a href="${escapeAttr(r.href)}" target="_blank" rel="noopener noreferrer nofollow">${html}</a>`;
      return html;
    })
    .join('');
}

/** Write blocks as HTML in the one fixed form (what is stored and shown). */
export function renderRichHtml(blocks: RichBlock[]): string {
  let out = '';
  // Open lists, outermost first; each has an open <li> once it holds an item.
  const open: Array<{ ordered: boolean; li: boolean }> = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      const l = open.pop()!;
      out += `${l.li ? '</li>' : ''}</${l.ordered ? 'ol' : 'ul'}>`;
    }
  };
  for (const b of blocks) {
    if (b.kind !== 'item') {
      closeTo(0);
      out += b.kind === 'heading' ? `<h3>${runsHtml(b.runs)}</h3>` : `<p>${runsHtml(b.runs)}</p>`;
      continue;
    }
    const level = Math.min(b.level, open.length); // never skip a level
    closeTo(level + 1);
    if (open.length === level + 1 && open[level]!.ordered !== b.ordered) closeTo(level);
    if (open.length === level + 1) {
      if (open[level]!.li) out += '</li>';
    } else {
      out += b.ordered ? '<ol>' : '<ul>';
      open.push({ ordered: b.ordered, li: false });
    }
    out += `<li><p>${runsHtml(b.runs)}</p>`;
    open[level]!.li = true;
  }
  closeTo(0);
  return out;
}

/** Any HTML → the safe, fixed form. */
export function sanitizeRichHtml(html: string): string {
  return renderRichHtml(parseRichHtml(html));
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

/** A link's address is worth showing beside its text (not when the text already is the address). */
export function linkNeedsAddress(r: RichRun): boolean {
  return !!r.href && r.href !== r.text.trim() && `mailto:${r.text.trim()}` !== r.href;
}

/** The words of formatted text: lines for paragraphs, "- " / "1. " for list items, links with their address. */
export function richToPlain(blocks: RichBlock[]): string {
  const markers = listMarkers(blocks);
  const lines: string[] = [];
  blocks.forEach((b, bi) => {
    const words = b.runs.map((r) => (linkNeedsAddress(r) ? `${r.text} (${r.href})` : r.text)).join('');
    if (b.kind === 'item') {
      const indent = '  '.repeat(b.level);
      const marker = markers[bi] === '•' ? '-' : markers[bi];
      lines.push(...words.split('\n').map((l, i) => (i === 0 ? `${indent}${marker} ${l}` : `${indent}  ${l}`)));
    } else {
      lines.push(...words.split('\n'));
    }
  });
  return lines.join('\n');
}

/** A note's words, whether it was written plain or formatted. */
export function noteText(note: { body: string; bodyFormat?: 'PLAIN' | 'RICH' | null }): string {
  return note.bodyFormat === 'RICH' ? richToPlain(parseRichHtml(note.body)) : note.body;
}
