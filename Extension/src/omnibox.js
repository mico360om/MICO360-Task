/**
 * Chrome's address bar: type "mico", a space and some words to search MICO360 Tasks (the manifest's
 * `omnibox` keyword, which needs no permission and shows no install warning). Suggestions come from
 * GET /search, as the Ctrl+K search: tasks, projects and meetings (they open here) and pages. Enter
 * on a suggestion opens it; Enter on the words opens the Search screen with them. Pure: the
 * background worker does the fetching and the opening.
 */
import { matchPages, pageTarget, searchable } from './search.js';

export const OMNIBOX_KEYWORD = 'mico';
const MAX = 6;

/** Whether XML can hold a character (tab, line breaks and printable ones; no lone surrogate, U+FFFE or U+FFFF). */
function xmlChar(ch) {
  const c = ch.codePointAt(0);
  if (c === 9 || c === 10 || c === 13) return true;
  return c >= 0x20 && !(c >= 0xd800 && c <= 0xdfff) && c !== 0xfffe && c !== 0xffff;
}

/**
 * Text for the address bar's suggestions, which Chrome reads as XML: the five special characters
 * escaped, and characters XML can't hold left out (a title pasted with a control character in it).
 */
export function escapeXml(text) {
  return Array.from(String(text == null ? '' : text)).filter(xmlChar).join('')
    .replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[c]));
}

const rows = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string' && r.id) : []);

/**
 * The suggestions for `text`: the server's answer (`results`, null while there is none) — tasks,
 * projects, meetings — after the pages whose names match. People aren't suggested: opening a
 * conversation needs the app (search for them there).
 */
export function omniboxSuggestions(results, text, { isAdmin = false, max = MAX } = {}) {
  const out = [];
  for (const p of matchPages(text, isAdmin).slice(0, text && text.trim() ? 2 : 0)) {
    out.push({ content: `page:${p.id}`, description: `Go to <match>${escapeXml(p.label)}</match>` });
  }
  if (results && searchable(text)) {
    for (const t of rows(results.tasks)) out.push({ content: `task:${t.id}`, description: `${escapeXml(t.title)} <dim>${escapeXml(t.key)} · task</dim>` });
    for (const p of rows(results.projects)) out.push({ content: `project:${p.id}`, description: `${escapeXml(p.name)} <dim>${escapeXml(p.code)} · project board</dim>` });
    for (const m of rows(results.meetings)) out.push({ content: `meeting:${m.id}`, description: `${escapeXml(m.title)} <dim>meeting</dim>` });
  }
  return out.slice(0, max);
}

/** What the first line says (Chrome puts the words typed where %s is). */
export function defaultSuggestion(signedIn) {
  return signedIn ? 'Search MICO360 Tasks for <match>%s</match>' : 'Sign in to MICO360 Tasks to search it from here';
}

const ID = /^[\w-]{1,64}$/;
const SCREENS = { task: (id) => `#/task/${id}`, project: (id) => `#/board/${id}`, meeting: (id) => `#/meeting/${id}` };

/**
 * Where Enter goes: a suggestion's item (`{ hash }` here; a page the extension doesn't have:
 * `{ url }` on the website), else the Search screen with the words typed. Only ids as the server
 * makes them are opened — anything else is searched for as words, never used as an address.
 */
export function omniboxTarget(text, { appBase = '', isAdmin = true } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { hash: '#/' };
  const m = /^(task|project|meeting|page):(.+)$/.exec(raw);
  if (m && ID.test(m[2])) {
    if (m[1] !== 'page') return { hash: SCREENS[m[1]](m[2]) };
    const page = matchPages('', isAdmin).find((p) => p.id === m[2]);
    const target = page ? pageTarget(page, appBase) : null;
    if (target) return target;
  }
  return { hash: `#/search?q=${encodeURIComponent(raw)}` };
}
