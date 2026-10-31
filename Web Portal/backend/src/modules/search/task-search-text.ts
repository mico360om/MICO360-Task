import { foldText, normalizeForSearch } from './text-normalize';

/**
 * The text side of task search: the one normalised document a task is indexed under, and — for the
 * results — where the words are in a field's text as shown, with a ~140-character snippet around
 * them. The same normaliser (text-normalize) runs on both sides, so what the index finds the
 * highlighter finds too.
 */

/** Bump when what goes into the document (or how it is normalised) changes: every task is re-indexed. */
export const SEARCH_INDEX_VERSION = 1;

/** A very long task (thousands of comments) is indexed up to this many characters. */
export const MAX_DOC_CHARS = 2_000_000;

export interface SearchContact {
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  remarks: string | null;
}

/** Everything a task can be found by (live comments only — never deleted ones). */
export interface TaskSearchSource {
  key: string;
  /** Keys it had before it moved to another project. */
  formerKeys: string[];
  title: string;
  description: string | null;
  /** Comments and replies that are not deleted. */
  comments: { body: string }[];
  /** Checklist items (a task's "subtasks"). */
  checklist: { text: string }[];
  assignees: { firstName: string; lastName: string; username: string }[];
  contacts: SearchContact[];
  tags: { name: string }[];
  files: { filename: string }[];
}

export interface SearchDocument {
  /** "\n" + each key on its own line + "\n" + the title: a key equal to the query is "\n<key>\n". */
  head: string;
  /** The head, then every other field, one item per line (so a phrase never runs from one into the next). */
  doc: string;
}

const personName = (p: { firstName: string; lastName: string }) => `${p.firstName ?? ''} ${p.lastName ?? ''}`;

/** The searchable text of a task, normalised (case, Arabic letter forms, diacritics, spaces). */
export function buildSearchDocument(src: TaskSearchSource): SearchDocument {
  const keys = [src.key, ...src.formerKeys].map(normalizeForSearch).filter(Boolean);
  const head = `\n${keys.join('\n')}\n${normalizeForSearch(src.title)}`;
  const items: (string | null | undefined)[] = [
    src.description,
    ...src.comments.map((c) => c.body),
    ...src.checklist.map((i) => i.text),
    ...src.assignees.flatMap((a) => [personName(a), a.username]),
    ...src.contacts.flatMap((c) => [c.name, c.company, c.designation, c.email, c.phone, c.remarks]),
    ...src.tags.map((t) => t.name),
    ...src.files.map((f) => f.filename),
  ];
  const body = items.map(normalizeForSearch).filter(Boolean).join('\n');
  const doc = body ? `${head}\n${body}` : head;
  return { head, doc: doc.length > MAX_DOC_CHARS ? doc.slice(0, MAX_DOC_CHARS) : doc };
}

/** A field's text as the results show it: on one line, spaces collapsed. */
export function displayText(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** [start, end) in a string's UTF-16 positions — what the apps highlight. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * The shown text folded as the index folds it, with where each folded character came from: a letter
 * and the marks on it fold together, so a match can be mapped back onto the text as shown.
 */
function foldWithMap(shown: string): { text: string; from: number[]; to: number[] } {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  const clusters = shown.match(/\P{M}\p{M}*|\p{M}+/gsu) ?? [];
  let at = 0;
  for (const cluster of clusters) {
    const end = at + cluster.length;
    for (const ch of foldText(cluster)) {
      const c = /\s/.test(ch) ? ' ' : ch;
      if (c === ' ' && (text === '' || text.endsWith(' '))) continue;
      for (let k = 0; k < c.length; k++) {
        from.push(at);
        to.push(end);
      }
      text += c;
    }
    at = end;
  }
  return { text, from, to };
}

/** Every place each (normalised) term appears in the shown text, sorted, overlapping ones merged. */
export function findRanges(shown: string, terms: string[]): TextRange[] {
  if (!shown) return [];
  const folded = foldWithMap(shown);
  const found: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let i = folded.text.indexOf(term); i >= 0; i = folded.text.indexOf(term, i + 1)) {
      found.push({ start: folded.from[i]!, end: folded.to[i + term.length - 1]! });
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** True when every term is in the text (normalised as the index is). */
export function hasAllTerms(text: string | null | undefined, terms: string[]): boolean {
  const n = normalizeForSearch(text);
  return terms.every((t) => n.includes(t));
}

/** How close to a word's end a cut may move to avoid splitting it. */
const WORD_SLACK = 16;

/**
 * About `width` characters of the shown text around its first match ("…" where it is cut, at a
 * space where one is near), and the matches inside it in the snippet's own positions.
 */
export function snippetAround(shown: string, ranges: TextRange[], width = 140): { snippet: string; ranges: TextRange[] } {
  if (shown.length <= width) return { snippet: shown, ranges: ranges.map((r) => ({ ...r })) };
  const first = ranges[0];
  let start = 0;
  if (first) {
    const room = Math.max(0, width - (first.end - first.start));
    start = Math.max(0, Math.min(first.start - Math.floor(room / 3), shown.length - width));
  }
  let end = Math.min(shown.length, start + width);
  if (start > 0) {
    const space = shown.indexOf(' ', start);
    if (space >= 0 && space - start < WORD_SLACK && (!first || space < first.start)) start = space + 1;
  }
  if (end < shown.length) {
    const space = shown.lastIndexOf(' ', end);
    if (space > start && end - space < WORD_SLACK && (!first || space >= first.end)) end = space;
  }
  const lead = start > 0 ? '…' : '';
  const snippet = `${lead}${shown.slice(start, end).trim()}${end < shown.length ? '…' : ''}`;
  const trimmedLead = shown.slice(start, end).length - shown.slice(start, end).trimStart().length;
  const shift = lead.length - start - trimmedLead;
  const inside: TextRange[] = [];
  const bodyEnd = snippet.length - (end < shown.length ? 1 : 0);
  for (const r of ranges) {
    const s = Math.max(r.start + shift, lead.length);
    const e = Math.min(r.end + shift, bodyEnd);
    if (e > s) inside.push({ start: s, end: e });
  }
  return { snippet, ranges: inside };
}
