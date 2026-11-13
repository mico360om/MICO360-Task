/**
 * The task history's lines for guests and categories (1.24), on top of the shared timeline
 * (activity-feed.ts, which the Android app shares and words guest rows as external contacts):
 * "assigned guest Ahmed (Acme)", "removed guest Sara", "added category Electrical", "removed category
 * HSE", "added Omar Ahmed as the person responsible for the guests". A run by one person close together
 * reads as one line; any other line in between ends the run, as in the shared timeline. Shared
 * byte-for-byte by the website and the server (its task PDF, daily email and MICO AI read the history).
 */
import { buildTimeline, type FeedEntry, type TimelineItem, type TimelineKind } from './activity-feed';

/** Entries by one person this close together read as one line (as the shared timeline). */
const RUN_MS = 30 * 60_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const labelOf = (e: FeedEntry): string | null => {
  const name = str(e.meta?.name);
  const company = str(e.meta?.company);
  return name ? (company ? `${name} (${company})` : name) : null;
};
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** The lines this file words, by the run they belong to (null: the shared timeline words it). */
function runOf(e: FeedEntry): string | null {
  switch (e.action) {
    case 'EXTERNAL_CONTACT_ADDED':
    case 'EXTERNAL_CONTACT_REMOVED':
    case 'EXTERNAL_CONTACT_CHANGED':
    case 'CATEGORY_ADDED':
    case 'CATEGORY_REMOVED':
      return e.action;
    case 'ASSIGNED':
      return e.meta?.reason === 'guests' ? 'GUEST_RESPONSIBLE' : null;
    default:
      return null;
  }
}

const GUEST_VERB: Record<string, [one: string, many: string]> = {
  EXTERNAL_CONTACT_ADDED: ['assigned guest', 'assigned guests'],
  EXTERNAL_CONTACT_REMOVED: ['removed guest', 'removed guests'],
  EXTERNAL_CONTACT_CHANGED: ['changed guest', 'changed guests'],
};

function lineOf(run: string, entries: FeedEntry[]): TimelineItem {
  const newest = entries[0]!;
  const chronological = [...entries].reverse();
  const kind: TimelineKind = run.startsWith('EXTERNAL') ? 'external' : run === 'GUEST_RESPONSIBLE' ? 'assigned' : 'other';
  const base = { id: newest.id, kind, actorName: newest.actorName, createdAt: newest.createdAt, count: entries.length };
  if (run === 'GUEST_RESPONSIBLE') {
    // Made by the switch to guests (meta.auto): the person is the line's own name.
    if (newest.meta?.auto === true) return { ...base, text: 'became the person responsible for the guests' };
    const names = [...new Set(chronological.map((e) => str(e.meta?.assignee)).filter((n): n is string => Boolean(n)))];
    return { ...base, text: `added ${names.length ? listOf(names) : 'a teammate'} as the person responsible for the guests` };
  }
  const names = [...new Set(chronological.map(labelOf).filter((n): n is string => Boolean(n)))];
  if (run === 'CATEGORY_ADDED' || run === 'CATEGORY_REMOVED') {
    const verb = run === 'CATEGORY_ADDED' ? 'added' : 'removed';
    if (names.length === 0) return { ...base, text: `${verb} a category` };
    return { ...base, text: `${verb} categor${names.length > 1 ? 'ies' : 'y'} ${listOf(names)}` };
  }
  const [one, many] = GUEST_VERB[run]!;
  if (names.length === 0) return { ...base, text: `${one.replace(/ guest$/, ' a guest')}` };
  return { ...base, text: `${names.length > 1 ? many : one} ${listOf(names)}` };
}

const timeOf = (e: FeedEntry) => (e.createdAt ? new Date(e.createdAt).getTime() : NaN);

/** Readable timeline lines from activity rows given newest first — the shared timeline plus guests and categories. */
export function buildTaskTimeline(entries: FeedEntry[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let plain: FeedEntry[] = [];
  let group: { run: string; entries: FeedEntry[] } | null = null;
  const flushPlain = () => {
    if (plain.length) out.push(...buildTimeline(plain));
    plain = [];
  };
  const flushGroup = () => {
    if (group) out.push(lineOf(group.run, group.entries));
    group = null;
  };
  for (const entry of entries) {
    const run = runOf(entry);
    if (run === null) {
      flushGroup();
      plain.push(entry);
      continue;
    }
    flushPlain();
    const current = group as { run: string; entries: FeedEntry[] } | null;
    const oldest = current?.entries[current.entries.length - 1];
    if (current && oldest && current.run === run && oldest.actorName === entry.actorName && Math.abs(timeOf(oldest) - timeOf(entry)) <= RUN_MS) {
      current.entries.push(entry);
    } else {
      flushGroup();
      group = { run, entries: [entry] };
    }
  }
  flushGroup();
  flushPlain();
  return out;
}
