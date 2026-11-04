/**
 * Task numbers however they are typed (1.22.3). A task's number is its project's code and a running
 * number in that project, "MICO-142". People type it as mico-142, MICO142, mico 142, MICO_142 or
 * #MICO-142: all of those are the same number. A project code may end in digits ("HR2"), so a
 * run-together "HR214" may be HR-214, HR2-14 or HR21-4, and each is a candidate. A bare number
 * ("142", "#142") means any task numbered …-142 exactly. Anything else is not a number (null), so a
 * normal text search is unchanged.
 *
 * Read on the query side only: what is stored and indexed stays "MICO-142". Old numbers (a task's
 * keys from before it moved project) are matched the same way as its number now.
 *
 * The server owns this file (task search, the task list's keyword filter, MICO AI's task lookup);
 * the website keeps an identical copy for its own filters and the top bar's "open" command (a drift
 * test fails when the copy differs). No imports: it is copied.
 */

/** A project code (the projects' CODE_PATTERN): a capital letter, then 1–9 capitals or digits. */
const CODE = /^[A-Z][A-Z0-9]{1,9}$/;
/** A number has at most this many digits. */
const MAX_DIGITS = 9;
/** Longer than this (spaces collapsed) is never a task number. */
const MAX_LENGTH = 32;
/** A code, then a hyphen (or any dash a phone or word processor types), an underscore or spaces, then digits. */
const SEPARATED = /^([A-Z][A-Z0-9]*)(?: ?[-_‐-―−] ?| )(\d+)$/;
/** A code and its number run together: letters and digits, starting with a letter, ending in a digit. */
const RUN_TOGETHER = /^[A-Z][A-Z0-9]*\d$/;

export interface TaskNumberQuery {
  /** The numbers it may be, the likeliest first ("HR214": HR-214, HR2-14, HR21-4); empty for a bare number. */
  keys: string[];
  /** A bare number without leading zeros ("142"): any task numbered …-142. Null otherwise. */
  number: string | null;
}

/** Digits as a positive number without leading zeros, or null (0, or too long). */
function positive(digits: string): string | null {
  const n = digits.replace(/^0+/, '');
  return n && n.length <= MAX_DIGITS ? n : null;
}

/**
 * What task number a query names, or null when it isn't one. Case, spaces around it, a leading "#",
 * full-width characters and the separator (hyphen, dash, underscore, space or none) don't matter.
 */
export function readTaskNumber(query: string | null | undefined): TaskNumberQuery | null {
  const text = String(query ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^# ?/, '')
    .toUpperCase();
  if (!text || text.length > MAX_LENGTH) return null;
  if (/^\d+$/.test(text)) {
    const n = positive(text);
    return n ? { keys: [], number: n } : null;
  }
  const apart = SEPARATED.exec(text);
  if (apart) {
    const n = positive(apart[2]!);
    return n && CODE.test(apart[1]!) ? { keys: [`${apart[1]}-${n}`], number: null } : null;
  }
  if (!RUN_TOGETHER.test(text)) return null;
  // Where the trailing digits start: the number is some of them, the code the rest.
  let digitsFrom = text.length;
  while (digitsFrom > 0 && /\d/.test(text[digitsFrom - 1]!)) digitsFrom -= 1;
  const keys: string[] = [];
  for (let at = Math.max(digitsFrom, 2); at < text.length; at++) {
    const code = text.slice(0, at);
    const digits = text.slice(at);
    // A number never starts with 0 (HR2014 is not HR2-014).
    if (digits.startsWith('0') || digits.length > MAX_DIGITS || !CODE.test(code)) continue;
    keys.push(`${code}-${digits}`);
  }
  return keys.length ? { keys, number: null } : null;
}

/** The task numbers a query may be ("mico 142" → ["MICO-142"]); empty for a bare number or any other text. */
export function taskNumberKeys(query: string | null | undefined): string[] {
  return readTaskNumber(query)?.keys ?? [];
}

/**
 * Which of a task's numbers — now, else one it had before it moved — the query names, or null. A
 * bare number names a task numbered …-N exactly (MICO-142 for "142", never MICO-1142).
 */
export function matchedTaskNumber(query: string | null | undefined, key: string, formerKeys: readonly string[] | null = []): string | null {
  const q = readTaskNumber(query);
  if (!q) return null;
  for (const k of [key, ...(formerKeys ?? [])]) {
    const upper = String(k ?? '').toUpperCase();
    if (q.number !== null ? upper.endsWith(`-${q.number}`) : q.keys.includes(upper)) return k;
  }
  return null;
}

/** Does the query name this task's number, now or before it moved? (For filters that match the number.) */
export function matchesTaskNumber(query: string | null | undefined, key: string, formerKeys: readonly string[] | null = []): boolean {
  return matchedTaskNumber(query, key, formerKeys) !== null;
}

/**
 * The task whose number is one of `keys` (tried in that order, any case), else the one that had one
 * of them before it moved project — or null. For opening "the task numbered …" exactly: never a
 * task whose number merely contains it.
 */
export function pickByTaskNumber<T extends { key: string; formerKeys?: readonly string[] | null }>(items: readonly T[], keys: readonly string[]): T | null {
  const wanted = keys.map((k) => k.toUpperCase());
  for (const k of wanted) {
    const now = items.find((t) => t.key.toUpperCase() === k);
    if (now) return now;
  }
  for (const k of wanted) {
    const before = items.find((t) => (t.formerKeys ?? []).some((f) => f.toUpperCase() === k));
    if (before) return before;
  }
  return null;
}
