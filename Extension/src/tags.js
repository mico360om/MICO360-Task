/**
 * A task's tags (`PUT /tasks/:id/tags` takes the whole list of names; the server finds or makes each
 * one in the workspace's shared list). The same rules as the server's `normalizeTagNames`
 * (backend/src/modules/tasks/tag-service.ts) — src/tags.test.js runs both over the same names — so a
 * name the server would refuse is explained before anything is sent. Pure (no chrome APIs).
 */

/** A task can carry at most this many tags (the server's MAX_TAGS_PER_TASK). */
export const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** Trim, collapse inner whitespace and cap the length of a tag name. */
export function normalizeTagName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

/** The server's check of a whole list: cleaned, de-duplicated (any case), none blank, at most MAX_TAGS. Throws its words. */
export function normalizeTagNames(names) {
  const seen = new Set();
  const clean = [];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (!name) throw new Error('Tag names cannot be blank.');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(name);
  }
  if (clean.length > MAX_TAGS) throw new Error(`A task can have at most ${MAX_TAGS} tags.`);
  return clean;
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** A tag name as the server tells tags apart: tidied, in any case. */
export const tagKey = (name) => normalizeTagName(name).toLowerCase();

/**
 * A change of a task's tags made from the list `base` to the list `next`, applied over the task's
 * tags as they are now (`current`): the tags it added are added, the ones it took off are taken off,
 * and everything else stays as it is now — a tag someone else added or took off meanwhile included.
 * The task's own order first, then the added ones; no name twice (names compare as the server's do).
 */
export function mergeTagChange(current, base, next) {
  const before = new Set(base.map(tagKey));
  const after = new Set(next.map(tagKey));
  const seen = new Set();
  const out = [];
  const keep = (raw) => {
    const name = normalizeTagName(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key) || (before.has(key) && !after.has(key))) return;
    seen.add(key);
    out.push(name);
  };
  for (const name of current) keep(name);
  for (const name of next) if (!before.has(tagKey(name))) keep(name);
  return out;
}

/**
 * Add a typed tag to a task's names: `{ names }`, or the names unchanged with `already` (the tag it
 * has, in any case) or an `error` to show (blank, or one too many).
 */
export function withTag(names, raw) {
  const name = normalizeTagName(raw);
  if (!name) return { names, error: 'Type a tag name first.' };
  const had = names.find((n) => same(n, name));
  if (had) return { names, already: had };
  if (names.length >= MAX_TAGS) return { names, error: `A task can have at most ${MAX_TAGS} tags.` };
  return { names: [...names, name] };
}

export function withoutTag(names, name) {
  return names.filter((n) => !same(n, name));
}

/**
 * Tag rows for names saved on this device: a tag the task or the workspace already has keeps its id
 * and colour; a new one has none yet (the server makes it when the change syncs).
 */
export function tagRecords(names, known) {
  const pool = Array.isArray(known) ? known : [];
  return names.map((name) => pool.find((t) => t && typeof t.name === 'string' && same(t.name, name))
    || { id: `tmp-tag:${name.toLowerCase()}`, name, color: null });
}

/** The workspace's tags the task doesn't have yet, by name, to suggest while typing. */
export function tagChoices(catalog, names) {
  if (!Array.isArray(catalog)) return [];
  return catalog
    .map((t) => t && t.name)
    .filter((n) => typeof n === 'string' && n && !names.some((x) => same(x, n)))
    .sort((a, b) => a.localeCompare(b));
}
