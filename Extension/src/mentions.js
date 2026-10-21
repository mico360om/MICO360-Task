/**
 * Pure helpers for @mention suggestions and highlighting in task comments. A plain-JavaScript copy
 * of the web app's `lib/mentions.ts`, which the Android app shares unchanged; src/mentions.test.js
 * runs both over the same inputs, so the copies can't drift apart.
 *
 * The name rules match the server's mention parser (backend/src/modules/tasks/mentions.ts): any
 * script, plus dots, hyphens and underscores inside a name. An '@' glued to a word, a dot/hyphen or
 * another '@' (an email address, say) never starts a mention.
 *
 * As in the original: no Unicode property escapes in regex literals. Where the engine has them they
 * are built at run time; elsewhere `isNameCharFallback` stands in.
 */

/**
 * A letter, digit or mark in any script, or '_' — without Unicode property escapes: ASCII letters,
 * digits and '_', plus everything beyond ASCII except spaces, punctuation and symbols.
 */
export function isNameCharFallback(ch) {
  const c = ch.charCodeAt(0);
  if (c < 0x80) return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
  return !(
    c <= 0xbf || // Latin-1 spaces, punctuation and symbols
    c === 0xd7 || // ×
    c === 0xf7 || // ÷
    c === 0x060c || c === 0x061b || c === 0x061f || (c >= 0x066a && c <= 0x066d) || c === 0x06d4 || // Arabic punctuation
    (c >= 0x2000 && c <= 0x2bff) || // general punctuation, currency, arrows, maths, shapes, symbols
    (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
    (c >= 0xd800 && c <= 0xdfff) || // emoji and everything else beyond the basic plane
    (c >= 0xfe30 && c <= 0xfe6f) || // CJK compatibility and small forms
    c === 0xfeff || // zero-width no-break space
    (c >= 0xff00 && c <= 0xff0f) || (c >= 0xff1a && c <= 0xff20) || (c >= 0xff3b && c <= 0xff40) || (c >= 0xff5b && c <= 0xff65) // fullwidth punctuation
  );
}

/** Is `ch` part of a name? Exact (Unicode letters, digits, marks, '_') where the engine allows it. */
const isNameChar = (() => {
  try {
    const re = new RegExp('[\\p{L}\\p{N}\\p{M}_]', 'u');
    // Guard against an engine that accepts the pattern but means something else by it.
    return re.test('a') && re.test('أ') && !re.test('{') ? (ch) => re.test(ch) : isNameCharFallback;
  } catch {
    return isNameCharFallback;
  }
})();

const isJoiner = (ch) => ch === '.' || ch === '-';

/** May a mention start at `text[at]` ('@')? Not when glued to a word, a dot/hyphen or another '@'. */
function startsMention(text, at) {
  const prev = at > 0 ? text[at - 1] : '';
  return !prev || !(isNameChar(prev) || isJoiner(prev) || prev === '@');
}

/** Does a name that ends right before `text[end]` stop at a boundary? Trailing '.'/'-' is punctuation. */
function endsWord(text, end) {
  const next = text[end];
  if (next === undefined) return true;
  if (isNameChar(next)) return false;
  if (isJoiner(next)) {
    const after = text[end + 1];
    return after === undefined || !isNameChar(after);
  }
  return true;
}

/** If the caret sits inside an @mention being typed, return the partial query + the '@' index. */
export function detectMention(text, caret) {
  const end = Math.max(0, Math.min(caret, text.length));
  let at = end;
  while (at > 0 && (isNameChar(text[at - 1]) || isJoiner(text[at - 1]))) at--;
  if (at === 0 || text[at - 1] !== '@' || !startsMention(text, at - 1)) return null;
  return { query: text.slice(at, end), start: at - 1 };
}

/** Replace the partial @token at `start..caret` with `@username `, returning new text + caret. */
export function applyMention(text, start, username, caret) {
  const insert = `@${username} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

/**
 * The people to suggest for a partial @query, best first: usernames that start with it, then names
 * with a word that starts with it, then usernames or names that merely contain it.
 * Each person is `{ id, username, name, avatarUrl? }` (`name` falls back to the username when empty).
 */
export function suggestMentions(people, query, limit = 6) {
  const q = query.toLowerCase();
  if (!q) return people.slice(0, limit);
  const rank = (p) => {
    const username = p.username.toLowerCase();
    const name = p.name.toLowerCase();
    if (username.startsWith(q)) return 0;
    if ([...name.split(/\s+/), ...username.split(/[._-]/)].some((word) => word.startsWith(q))) return 1;
    if (username.includes(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return people
    .map((p, i) => ({ p, i, r: rank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

/**
 * What a mention menu shows for a text and caret: `{ kind: 'closed' }`, a "nobody matches" note
 * (`{ kind: 'no-match', query }`) or people to pick (`{ kind: 'people', start, query, people }`).
 */
export function mentionMenu(text, caret, people, limit = 6) {
  const mention = detectMention(text, caret);
  // With no one to match against (still loading, or the list failed), "nobody matches" would mislead.
  if (!mention || people.length === 0) return { kind: 'closed' };
  const matches = suggestMentions(people, mention.query, limit);
  if (matches.length > 0) return { kind: 'people', start: mention.start, query: mention.query, people: matches };
  return mention.query ? { kind: 'no-match', query: mention.query } : { kind: 'closed' };
}

/**
 * Split a body into plain-text and @mention tokens (`{ type: 'text' | 'mention', value, username? }`)
 * for highlighted rendering. With `usernames`, only those people are marked — the longest matching
 * name wins, compared case-insensitively, the way the server decides who was mentioned. Without
 * them, every @name-shaped token is marked.
 */
export function tokenizeMentions(body, usernames) {
  const names = usernames ? [...new Set(usernames.filter(Boolean))].sort((a, b) => b.length - a.length) : null;
  const tokens = [];
  let last = 0;
  for (let at = body.indexOf('@'); at !== -1; at = body.indexOf('@', at + 1)) {
    if (at < last || !startsMention(body, at)) continue;
    const start = at + 1;
    let username;
    let end = start;
    if (names) {
      username = names.find(
        (name) => body.slice(start, start + name.length).toLowerCase() === name.toLowerCase() && endsWord(body, start + name.length),
      );
      if (username) end = start + username.length;
    } else if (start < body.length && isNameChar(body[start])) {
      // A name runs over name characters and inner dots/hyphens; a trailing one is punctuation.
      end = start;
      while (end < body.length && (isNameChar(body[end]) || isJoiner(body[end]))) end++;
      while (isJoiner(body[end - 1])) end--;
      username = body.slice(start, end);
    }
    if (!username) continue;
    if (at > last) tokens.push({ type: 'text', value: body.slice(last, at) });
    tokens.push({ type: 'mention', value: body.slice(at, end), username });
    last = end;
  }
  if (last < body.length) tokens.push({ type: 'text', value: body.slice(last) });
  return tokens;
}
