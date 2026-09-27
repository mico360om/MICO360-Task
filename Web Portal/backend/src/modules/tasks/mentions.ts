/**
 * @mention parsing that works for real usernames: any script (Arabic included), plus dots,
 * hyphens and underscores inside a name. An '@' inside a word or an email address never starts
 * a mention, and a name only matches when it ends at a word boundary — "@ahmed.ali" is not a
 * mention of "ahmed".
 */

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
const JOINER = /[.-]/;

/** May a mention start at `body[at]` ('@')? Not when glued to a word, a dot/hyphen or another '@'. */
function startsMention(body: string, at: number): boolean {
  const prev = at > 0 ? body[at - 1]! : '';
  return !prev || !(WORD_CHAR.test(prev) || JOINER.test(prev) || prev === '@');
}

/** Does a name that ends right before `body[end]` stop at a boundary? Trailing '.'/'-' is punctuation. */
function endsWord(body: string, end: number): boolean {
  const next = body[end];
  if (next === undefined) return true;
  if (WORD_CHAR.test(next)) return false;
  if (JOINER.test(next)) {
    const after = body[end + 1];
    return after === undefined || !WORD_CHAR.test(after);
  }
  return true;
}

/** Candidate @names in free text (used when the real usernames aren't available). */
export function parseMentions(body: string): string[] {
  const re = /@([\p{L}\p{N}_](?:[\p{L}\p{N}\p{M}_.-]*[\p{L}\p{N}\p{M}_])?)/gu;
  const out = new Set<string>();
  for (const m of body.matchAll(re)) {
    if (startsMention(body, m.index ?? 0)) out.add(m[1]!);
  }
  return [...out];
}

/**
 * The usernames (from `usernames`, compared case-insensitively) actually @mentioned in `body`.
 * At each mention the longest matching name wins, so "@ahmed.ali" picks "ahmed.ali" over "ahmed".
 */
export function matchMentions(body: string, usernames: string[]): string[] {
  const names = [...new Set(usernames.filter(Boolean))].sort((a, b) => b.length - a.length);
  const found = new Set<string>();
  for (let at = body.indexOf('@'); at !== -1; at = body.indexOf('@', at + 1)) {
    if (!startsMention(body, at)) continue;
    const start = at + 1;
    const hit = names.find(
      (name) => body.slice(start, start + name.length).toLowerCase() === name.toLowerCase() && endsWord(body, start + name.length),
    );
    if (hit) found.add(hit);
  }
  return [...found];
}
