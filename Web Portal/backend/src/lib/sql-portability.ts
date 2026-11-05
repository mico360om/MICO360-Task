/**
 * 1.23.1 — SQL that MySQL 8 and MariaDB read alike (the live site's database server may be either).
 *
 * MariaDB reads a bare TRUE or FALSE as the number 1 or 0, and a number (or a parameter holding one)
 * in ORDER BY or GROUP BY as a column's position: `ORDER BY (FALSE) DESC` is error 1054 there —
 * "Unknown column '0' in 'ORDER BY'" — while MySQL 8 reads it as a constant and sorts by nothing. A
 * constant sorts by nothing anywhere, so a query never needs one: leave the term out.
 *
 * `constantOrderTerms` finds such terms in a statement's text (its `?` placeholders as Prisma writes
 * them): each ORDER BY / GROUP BY list, at any depth, split at its own commas, each term without
 * ASC/DESC and its outer brackets. The tests run it over the queries the search builds.
 */
export function constantOrderTerms(sql: string): string[] {
  const found: string[] = [];
  const s = String(sql ?? '');
  const lists = /\b(?:ORDER|GROUP)\s+BY\b/gi;
  for (let m = lists.exec(s); m; m = lists.exec(s)) {
    for (const term of termsFrom(s, m.index + m[0].length)) {
      const bare = unwrap(term.replace(/\s+(?:ASC|DESC)\s*$/i, '').trim());
      if (CONSTANT.test(bare)) found.push(term.trim());
    }
  }
  return found;
}

/** A literal, a boolean, NULL or a placeholder: no column and nothing computed from one. */
const CONSTANT = /^(?:TRUE|FALSE|NULL|UNKNOWN|[+-]?\d+(?:\.\d+)?|'(?:[^']|'')*'|"(?:[^"]|"")*"|\?)$/i;
/** Where a sort list ends (at its own depth). */
const END = /^(?:LIMIT|OFFSET|HAVING|WINDOW|FOR|UNION|INTERSECT|EXCEPT|LOCK|INTO|WITH\s+ROLLUP)\b/i;

/** The comma-separated terms of a list that starts at `from`, up to its end (a keyword, a closing bracket of its own level, or the text's end). */
function termsFrom(s: string, from: number): string[] {
  const terms: string[] = [];
  let depth = 0;
  let start = from;
  let i = from;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'" || c === '"' || c === '`') {
      i = closeOf(s, i);
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && c === ',') {
      terms.push(s.slice(start, i));
      start = i + 1;
    } else if (depth === 0 && /\s/.test(c) && END.test(s.slice(i + 1).trimStart()) && s.slice(start, i).trim()) {
      break;
    }
    i += 1;
  }
  terms.push(s.slice(start, i));
  return terms.filter((t) => t.trim());
}

/** Just after the quoted part that opens at `at` (a doubled quote stays inside). */
function closeOf(s: string, at: number): number {
  const q = s[at]!;
  for (let j = at + 1; j < s.length; j++) {
    if (s[j] !== q) continue;
    if (s[j + 1] === q) {
      j += 1;
      continue;
    }
    return j + 1;
  }
  return s.length;
}

/** Without the brackets around the whole term: "((FALSE))" → "FALSE"; "(a) + (b)" stays. */
function unwrap(term: string): string {
  let t = term;
  while (t.startsWith('(') && t.endsWith(')') && wraps(t)) t = t.slice(1, -1).trim();
  return t;
}

/** Does the bracket that opens `t` close at its very end? */
function wraps(t: string): boolean {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "'" || c === '"' || c === '`') {
      i = closeOf(t, i) - 1;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0 && i < t.length - 1) return false;
    }
  }
  return depth === 0;
}
