/**
 * Pure helpers for @mention autocomplete in the chat composer and highlighting in messages.
 * Usernames match the backend's mention parser: @ followed by [a-zA-Z0-9_].
 */

/** If the caret sits inside an @mention being typed, return the partial query + the '@' index. */
export function detectMention(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  if (!m) return null;
  const query = m[1] ?? '';
  return { query, start: caret - query.length - 1 };
}

/** Replace the partial @token at `start..caret` with `@username `, returning new text + caret. */
export function applyMention(text: string, start: number, username: string, caret: number): { text: string; caret: number } {
  const insert = `@${username} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

export interface MentionToken {
  type: 'text' | 'mention';
  value: string;
  /** For mention tokens: the username without the leading '@'. */
  username?: string;
}

/** Split a message body into plain-text and @mention tokens (for highlighted rendering). */
export function tokenizeMentions(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const re = /@([a-zA-Z0-9_]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: body.slice(last, m.index) });
    tokens.push({ type: 'mention', value: m[0], username: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) tokens.push({ type: 'text', value: body.slice(last) });
  return tokens;
}
