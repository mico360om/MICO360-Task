import type { KanbanColumnData } from '../components/KanbanColumn';
import type { TaskCardTask } from '../components/TaskCard';
import type { HighlightRange } from './search-highlight';
import { matchedTaskNumber } from './task-number';
import { parseTaskQuery } from './task-search-query';
import { findRanges } from './task-search-text';
import { normalizeForSearch } from './text-normalize';

/**
 * Board search (owner, 10 Nov): the board's own search box, over the cards the board already
 * has (instant, nothing asked of the server). Words are read and folded as the top-bar search reads
 * them — the server's own files, copied (lib/task-search-query, lib/text-normalize: case, Arabic letter
 * forms, diacritics, "quoted phrases") — and every word must be somewhere on the task (AND), a part of
 * a word too ("scaff" finds Scaffold). A task number matches exactly however it is typed (MICO-12,
 * mico 12, mico12, #MICO-12; lib/task-number), or — a number alone — the task numbered …-12, never
 * …-120; the number can also just be in the task's words ("12 inch pipe").
 *
 * Pure functions, tested on their own (board-search.test.ts).
 */

/** The words in the board's search box, read. */
export interface BoardSearch {
  /** As typed (trimmed): a whole task number with a space in it ("mico 12") is read from this. */
  text: string;
  /** Folded words or "quoted phrases", each to be found somewhere on the task. */
  terms: string[];
}

/** The box's words, or null when there are none to look for. */
export function readBoardSearch(text: string | null | undefined): BoardSearch | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const { terms } = parseTaskQuery(raw);
  return terms.length > 0 ? { text: raw, terms } : null;
}

/**
 * What a card can be found by: a board card — and the numbers it had before it moved project, when it
 * carries them (the board's task list doesn't send them yet: only a task's own answer has them).
 */
export type BoardSearchCard = Pick<TaskCardTask, 'key' | 'title' | 'description' | 'assignees' | 'tags' | 'project'> & {
  formerKeys?: readonly string[] | null;
};

/**
 * A kind of text a card is found by. Categories and guests (when those features ship) add theirs to
 * BOARD_SEARCH_FIELDS — the matcher, the counts and the box need nothing else.
 */
export interface BoardSearchField {
  name: string;
  texts: (card: BoardSearchCard) => readonly (string | null | undefined)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** A description as people read it: markup taken out (a block's end is a new line), common entities read. */
export function plainDescription(description: string | null | undefined): string {
  if (!description) return '';
  return description
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_m, name: string) => ENTITIES[name] ?? ' ');
}

/** The task number is matched by its own rule (exactly), never as text: "12" doesn't find MICO-120. */
export const BOARD_SEARCH_FIELDS: readonly BoardSearchField[] = [
  { name: 'title', texts: (c) => [c.title] },
  { name: 'description', texts: (c) => [plainDescription(c.description)] },
  { name: 'assignee', texts: (c) => (c.assignees ?? []).map((a) => a.name) },
  { name: 'project', texts: (c) => [c.project?.name, c.project?.code] },
  { name: 'tag', texts: (c) => (c.tags ?? []).map((t) => t.name) },
];

export interface BoardSearchOptions {
  /** A one-project board: its project, which every card is in (its cards don't carry it). */
  project?: { name: string; code: string } | null;
  /** The fields searched (default BOARD_SEARCH_FIELDS). */
  fields?: readonly BoardSearchField[];
  /** Each card's folded text by its key (boardSearchDocs), kept between keystrokes. */
  docs?: ReadonlyMap<string, string>;
  /** searchBoard: work out what each found card marks (default); false — only which are found (a count). */
  marks?: boolean;
}

const withProject = <C extends BoardSearchCard>(card: C, project: BoardSearchOptions['project']): C =>
  card.project || !project ? card : { ...card, project };

/** A card's searchable text, folded once: one field's text per line (a phrase never runs from one into the next). */
export function boardSearchDoc(card: BoardSearchCard, opts: BoardSearchOptions = {}): string {
  const c = withProject(card, opts.project);
  return (opts.fields ?? BOARD_SEARCH_FIELDS)
    .flatMap((f) => f.texts(c))
    .map(normalizeForSearch)
    .filter(Boolean)
    .join('\n');
}

/** Every card's folded text by its key: made when the board's cards change, not on every keystroke. */
export function boardSearchDocs(columns: readonly KanbanColumnData[], opts: Omit<BoardSearchOptions, 'docs'> = {}): Map<string, string> {
  const docs = new Map<string, string>();
  for (const column of columns) for (const card of column.tasks) docs.set(card.key, boardSearchDoc(card, opts));
  return docs;
}

const formerOf = (card: BoardSearchCard) => card.formerKeys ?? [];
/** The task number this card has (or had) is what the words, or one of them, name. */
function namesNumber(card: BoardSearchCard, search: BoardSearch): boolean {
  if (matchedTaskNumber(search.text, card.key, formerOf(card)) !== null) return true;
  return search.terms.some((t) => matchedTaskNumber(t, card.key, formerOf(card)) !== null);
}

/** Is every word somewhere on this card (or is the whole search its number)? */
export function matchesBoardSearch(card: BoardSearchCard, search: BoardSearch, opts: BoardSearchOptions = {}): boolean {
  if (matchedTaskNumber(search.text, card.key, formerOf(card)) !== null) return true;
  const doc = opts.docs?.get(card.key) ?? boardSearchDoc(card, opts);
  return search.terms.every((t) => doc.includes(t) || matchedTaskNumber(t, card.key, formerOf(card)) !== null);
}

/** A line of the description around a word, about this long. */
const SNIPPET_LETTERS = 120;
/** Letters shown before the word, when the line is longer than a snippet. */
const SNIPPET_LEAD = 40;

/** What a found card marks: the words in its title, why it was found when that isn't in the title. */
export interface CardFound {
  /** The words in its title, in the title's own positions. */
  title: HighlightRange[];
  /** Its number is what was searched for. */
  key: boolean;
  /** A line of its description around a word that isn't in its title (null: none needed). */
  snippet: { text: string; ranges: HighlightRange[] } | null;
  /** The people on it whose names hold a word, and where. */
  people: { id: string; ranges: HighlightRange[] }[];
  /** The words in its project's name (the whole name when only its code matched); empty: none, or no project shown. */
  project: HighlightRange[];
  /** The ids of its tags that hold a word. */
  tags: string[];
}

/** The part of a long line around [at, at+len): about SNIPPET_LETTERS long, cut at spaces, "…" where cut. */
function cutLine(line: string, at: number): string {
  if (line.length <= SNIPPET_LETTERS) return line;
  let start = Math.max(0, at - SNIPPET_LEAD);
  if (start > 0) {
    const space = line.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  let end = Math.min(line.length, start + SNIPPET_LETTERS);
  if (end < line.length) {
    const space = line.lastIndexOf(' ', end);
    if (space > at) end = space;
  }
  return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`;
}

function snippetOf(description: string | null | undefined, terms: string[], missing: string[]): CardFound['snippet'] {
  if (missing.length === 0) return null;
  const lines = plainDescription(description)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    // The folded line first (cheap); where exactly, only on the line that has one.
    const folded = normalizeForSearch(line);
    if (!missing.some((t) => folded.includes(t))) continue;
    const first = findRanges(line, missing)[0];
    if (!first) continue;
    const text = cutLine(line, first.start);
    return { text, ranges: findRanges(text, terms) };
  }
  return null;
}

/** What to mark on a card the search found (see CardFound). */
export function findOnCard(card: BoardSearchCard, search: BoardSearch, _opts: BoardSearchOptions = {}): CardFound {
  const { terms } = search;
  const foldedTitle = normalizeForSearch(card.title);
  const holds = (text: string | null | undefined) => {
    const folded = normalizeForSearch(text);
    return terms.some((t) => folded.includes(t));
  };
  let project: HighlightRange[] = [];
  if (card.project) {
    project = findRanges(card.project.name, terms);
    if (project.length === 0 && holds(card.project.code)) project = [{ start: 0, end: card.project.name.length }];
  }
  return {
    title: findRanges(card.title, terms),
    key: namesNumber(card, search),
    // A word its number answers ("12" on MICO-12), or the whole search being its number, needs no description line.
    snippet: matchedTaskNumber(search.text, card.key, formerOf(card)) !== null
      ? null
      : snippetOf(card.description, terms, terms.filter((t) => !foldedTitle.includes(t) && matchedTaskNumber(t, card.key, formerOf(card)) === null)),
    people: (card.assignees ?? []).map((a) => ({ id: a.id, ranges: findRanges(a.name, terms) })).filter((p) => p.ranges.length > 0),
    project,
    tags: (card.tags ?? []).filter((t) => holds(t.name)).map((t) => t.id),
  };
}

const countCards = (columns: readonly KanbanColumnData[]) => columns.reduce((n, c) => n + c.tasks.length, 0);

/**
 * The board with only the cards the search finds. Every column stays (cards can still be dropped into
 * one with none found), each saying how many cards it had (`total`: "3 of 12"); each card found says
 * what it marks (`found`). No search: the board as it is.
 */
export function searchBoard(
  columns: KanbanColumnData[],
  search: BoardSearch | null,
  opts: BoardSearchOptions = {},
): { columns: KanbanColumnData[]; shown: number; total: number } {
  const total = countCards(columns);
  if (!search) return { columns, shown: total, total };
  const docs = opts.docs ?? boardSearchDocs(columns, opts);
  let shown = 0;
  const found = columns.map((column) => {
    const tasks = column.tasks
      .filter((card) => matchesBoardSearch(card, search, { ...opts, docs }))
      .map((card) => (opts.marks === false ? card : { ...card, found: findOnCard(card, search, opts) }));
    shown += tasks.length;
    return { ...column, tasks, total: column.tasks.length };
  });
  return { columns: found, shown, total };
}
