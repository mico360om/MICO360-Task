import { readTaskNumber } from '../../lib/task-number';
import { normalizeForSearch } from './text-normalize';
import type { SearchKind } from './search-types';

/**
 * 1.23.6 Advanced search — the built-in reader: a search typed in plain English ("Show overdue MICO
 * tasks assigned to me") becomes filter chips (Tasks · Overdue · MICO · Assigned to me) and the words
 * left over are searched as text. Pure code: no database, no AI — the caller gives it today, the week's
 * first day and the projects and people the person may see (nothing else is ever read as one).
 *
 * It reads only clear wording (owner call 1, 7 Nov), so everyday words in task titles keep working:
 *  - strong phrases are read wherever they are: "overdue", "due today", "no due date", "since 1 Nov",
 *    "last week", "high priority", "urgent", "in progress", "in review", "waiting for approval",
 *    "open tasks", "assigned to me", "created by me", "organised by Sara", "my meetings",
 *    "MICO tasks", "in RIG", "project MICO", "meeting notes", "checklist items";
 *  - weak ones — a bare kind word ("tasks"), "today", "mine", "for me", "for <project>" — only with a
 *    strong one, another weak one, or a command at the start ("show", "find", "list"…);
 *  - "notes", "minutes" alone, "high", "open", "rig", "blocked drain" stay words; "quoted" words are
 *    never read; a query that is a task number (1.22.3) is never read.
 * Filler words ("show", "all", "the", "with"…) are dropped only when something was read: when
 * nothing is, the search is exactly what was typed.
 */

export const READER_CHIP_KEYS = ['kind', 'due', 'when', 'done', 'status', 'approval', 'priority', 'project', 'assignee', 'mine', 'creator', 'organizer'] as const;
/** One chip per key, shown in this order ("Tasks · Overdue · MICO · Assigned to me"). */
export type ReaderChipKey = (typeof READER_CHIP_KEYS)[number];

export interface ReaderProject {
  id: string;
  code: string;
  name: string;
}
export interface ReaderPerson {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}
export interface ReaderContext {
  /** Today in the company's time zone, YYYY-MM-DD. */
  today: string;
  /** The company week's first day: 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: number;
  /** The projects the person may see (a code or name is read only for these). */
  projects: readonly ReaderProject[];
  /** The people the person may find (a name is read only for these). */
  people: readonly ReaderPerson[];
}

/** People: 'me' (whoever runs the search) or people's ids. */
export type PersonRef = string[];

export interface ReaderFilters {
  kinds?: SearchKind[];
  /** Tasks' and checklist items' due dates: overdue, none, or a window of company days (inclusive). */
  due?: 'overdue' | 'none' | { from?: string; to?: string };
  /** Each kind's own date (a task's due date, a meeting's start…), company days, inclusive. */
  from?: string;
  to?: string;
  done?: boolean;
  statuses?: ('BLOCKED' | 'IN_PROGRESS' | 'REVIEW')[];
  approval?: true;
  priorities?: ('LOW' | 'NORMAL' | 'HIGH' | 'URGENT')[];
  /** 'none': unassigned. */
  assignee?: PersonRef | 'none';
  creator?: PersonRef;
  organizer?: PersonRef;
  /** "my meetings", "mine": the person's own, each kind's way (the page's "Only mine"). */
  mine?: true;
  projectId?: string;
}

export interface ReaderChip {
  key: ReaderChipKey;
  label: string;
  /** The words it was read from, as typed. */
  text: string;
}

export interface ReadResult {
  chips: ReaderChip[];
  /** What is left to search as text ("" when nothing). */
  words: string;
  filters: ReaderFilters;
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

const COMMANDS = new Set(['show', 'find', 'list', 'search', 'get', 'give', 'display', 'view', 'fetch']);
const POLITE = new Set(['please', 'can', 'could', 'would', 'you', 'kindly', 'pls']);
/** Dropped once something was read ("Show all the overdue tasks" → nothing left to search). */
const FILLERS = new Set([
  ...COMMANDS,
  ...POLITE,
  'me', 'all', 'the', 'a', 'an', 'with', 'of', 'for', 'that', 'which', 'what', 'are', 'is', 'any', 'every', 'and', '&',
  'in', 'on', 'at', 'about', 'regarding', 'mentioning', 'containing', 'from', 'my', 'items', 'item', 'where', 'there',
]);
/** After a kind word, these make it a request for that kind ("tasks about pumps", "meetings with Khalid"). */
const KIND_CUES = new Set(['about', 'regarding', 'mentioning', 'containing', 'with', 'on', 'for', 're', 'concerning', 'named', 'called', 'titled', 'that', 'which', 'where']);
const KIND_WORDS: Record<string, SearchKind> = {
  tasks: 'task',
  meetings: 'meeting',
  projects: 'project',
  files: 'file',
  attachments: 'file',
  documents: 'file',
  inspections: 'inspection',
  checklists: 'checklist',
  clients: 'contact',
  contacts: 'contact',
  notes: 'note',
  minutes: 'minutes',
  moms: 'minutes',
};
/** Never read on their own ("notes", "minutes" are everyday words in titles). */
const CUED_ONLY = new Set(['notes', 'minutes', 'moms']);
const KIND_LABEL: Record<SearchKind, string> = {
  task: 'Tasks',
  project: 'Projects',
  meeting: 'Meetings',
  note: 'Meeting notes',
  minutes: 'Minutes',
  file: 'Files',
  inspection: 'Inspections',
  checklist: 'Checklist items',
  contact: 'Clients & contacts',
};
const PRIORITY_WORDS: Record<string, 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'> = { low: 'LOW', normal: 'NORMAL', medium: 'NORMAL', high: 'HIGH', urgent: 'URGENT', critical: 'URGENT' };
const PRIORITY_LABEL = { LOW: 'Low priority', NORMAL: 'Normal priority', HIGH: 'High priority', URGENT: 'Urgent' } as const;
const STATUS_LABEL = { BLOCKED: 'Blocked', IN_PROGRESS: 'In progress', REVIEW: 'In review' } as const;
const DONE_WORDS: Record<string, boolean> = { open: false, pending: false, done: true, completed: true, complete: true, finished: true, closed: true };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ── Days ────────────────────────────────────────────────────────────────────────────────────────

const shift = (key: string, days: number): string => {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number): string | null => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const dayOfWeek = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();
const lastOfMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return keyOf(y, m, new Date(Date.UTC(y, m, 0, 12)).getUTCDate())!;
};
const firstOfMonth = (key: string) => `${key.slice(0, 8)}01`;
const monthAfter = (key: string) => shift(lastOfMonth(key), 1);
const monthBefore = (key: string) => firstOfMonth(shift(firstOfMonth(key), -1));

/** "1 Nov", or "1 Nov 2025" in another year than today's. */
function dayLabel(key: string, today: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]}${String(y) === today.slice(0, 4) ? '' : ` ${y}`}`;
}

/** How a date without its year is placed: the latest on or before today, or the nearest to today. */
type DateMode = 'past' | 'near';
/** A date reference read from the words: a day, or a whole month ("since November"). */
interface DayRange {
  start: string;
  end: string;
  len: number;
}

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────────

interface Tok {
  raw: string;
  /** Lower case, folded, without the punctuation around it. */
  n: string;
  quoted: boolean;
}

const OPEN_CLOSE: Record<string, string> = { '"': '"', '“': '”', '”': '”', '„': '“', '«': '»' };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const plain = (raw: string) => {
    if (!raw) return;
    out.push({ raw, n: normalizeForSearch(raw.replace(/^[([{'"‘’“”«»,.;!?]+|[)\]}'"‘’“”«»,.;:!?]+$/g, '')), quoted: false });
  };
  while (i < text.length) {
    const ch = text[i]!;
    const close = OPEN_CLOSE[ch];
    if (close) {
      let end = -1;
      for (let k = i + 1; k < text.length; k++) {
        const c = text[k]!;
        if (c === close || (close === '”' && c === '“') || (close === '“' && c === '”')) {
          end = k;
          break;
        }
      }
      if (end > 0) {
        out.push({ raw: text.slice(i, end + 1), n: '', quoted: true });
        i = end + 1;
        continue;
      }
      // Unclosed: still being typed — the rest are plain words.
      for (const w of text.slice(i + 1).split(/\s+/)) plain(w);
      break;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s/.test(text[j]!) && !OPEN_CLOSE[text[j]!]) j += 1;
    plain(text.slice(i, j));
    i = j;
  }
  return out;
}

// ── Readings ────────────────────────────────────────────────────────────────────────────────────

interface Reading {
  key: ReaderChipKey;
  start: number;
  end: number;
  strong: boolean;
  /** This reading's part of the chip ("Sara Ali" of "Assigned to Sara Ali"). */
  part: string;
  apply: (f: ReaderFilters) => void;
}

const MERGED: ReadonlySet<ReaderChipKey> = new Set(['kind', 'priority', 'status', 'assignee', 'creator', 'organizer']);

export function readQuery(text: string, ctx: ReaderContext, opts: { off?: readonly string[] } = {}): ReadResult {
  const source = String(text ?? '').slice(0, 400);
  const toks = tokens(source);
  const none: ReadResult = { chips: [], words: source.trim(), filters: {} };
  // A task number however typed is a task number search (1.22.3), never read.
  if (toks.length === 0 || readTaskNumber(source)) return none;

  const n = (i: number) => (toks[i] && !toks[i]!.quoted ? toks[i]!.n : '');
  const is = (i: number, ...words: string[]) => words.includes(n(i));
  const seq = (i: number, words: string[]) => words.every((w, k) => n(i + k) === w);

  // People and projects as their words (normalised), longest first.
  const people = ctx.people.map((p) => ({
    p,
    names: [...new Set([normalizeForSearch(`${p.firstName} ${p.lastName}`), normalizeForSearch(p.firstName), normalizeForSearch(p.username)].filter(Boolean))],
  }));
  const projects = ctx.projects.map((p) => ({ p, code: normalizeForSearch(p.code), name: normalizeForSearch(p.name) }));
  const joined = (i: number, len: number): string | null => {
    const parts: string[] = [];
    for (let k = 0; k < len; k++) {
      const w = n(i + k);
      if (!w) return null;
      parts.push(w);
    }
    return parts.join(' ');
  };

  /** "me", or people by full name, first name or username (the longest that matches). */
  const whoAt = (i: number): { ids: PersonRef; part: string; len: number } | null => {
    if (is(i, 'me', 'myself')) return { ids: ['me'], part: 'me', len: 1 };
    for (let len = 3; len >= 1; len--) {
      const words = joined(i, len);
      if (!words) continue;
      const found = people.filter((x) => x.names.includes(words)).map((x) => x.p);
      if (found.length === 1) return { ids: [found[0]!.id], part: `${found[0]!.firstName} ${found[0]!.lastName}`.trim() || found[0]!.username, len };
      if (found.length > 1) {
        const first = found.every((p) => p.firstName === found[0]!.firstName) ? found[0]!.firstName : toks.slice(i, i + len).map((t) => t.raw).join(' ');
        return { ids: found.map((p) => p.id), part: `${first} (${found.length} people)`, len };
      }
    }
    return null;
  };

  /** A project by its code or its whole name. */
  const projectAt = (i: number): { p: ReaderProject; len: number } | null => {
    for (let len = 8; len >= 1; len--) {
      const words = joined(i, len);
      if (!words) continue;
      const hit = projects.find((x) => x.name === words) ?? (len === 1 ? projects.find((x) => x.code === words) : undefined);
      if (hit) return { p: hit.p, len };
    }
    return null;
  };

  /** A kind word or phrase at i. */
  const kindAt = (i: number): { kind: SearchKind; len: number; cuedOnly: boolean } | null => {
    if (seq(i, ['checklist', 'items']) || seq(i, ['checklist', 'item'])) return { kind: 'checklist', len: 2, cuedOnly: false };
    if (seq(i, ['meeting', 'notes'])) return { kind: 'note', len: 2, cuedOnly: false };
    if (seq(i, ['meeting', 'minutes'])) return { kind: 'minutes', len: 2, cuedOnly: false };
    if (seq(i, ['minutes', 'of', 'the', 'meeting']) || seq(i, ['minutes', 'of', 'the', 'meetings'])) return { kind: 'minutes', len: 4, cuedOnly: false };
    if (seq(i, ['minutes', 'of', 'meeting']) || seq(i, ['minutes', 'of', 'meetings'])) return { kind: 'minutes', len: 3, cuedOnly: false };
    if (seq(i, ['clients', 'and', 'contacts']) || seq(i, ['clients', '&', 'contacts'])) return { kind: 'contact', len: 3, cuedOnly: false };
    const w = n(i);
    const kind = KIND_WORDS[w];
    return kind ? { kind, len: 1, cuedOnly: CUED_ONLY.has(w) } : null;
  };
  /** A kind phrase is its own request (strong) when it is a two-word phrase or a cue follows it. */
  const kindStrong = (i: number, k: { len: number }) => k.len > 1 || KIND_CUES.has(n(i + k.len));

  /** A date at i: a day (1 Nov, Nov 1, 2026-11-01, 1/11, today, Monday…) or a month (November). */
  const dateAt = (i: number, mode: DateMode): DayRange | null => {
    const today = ctx.today;
    const year = Number(today.slice(0, 4));
    const w = n(i);
    if (!w) return null;
    if (w === 'today') return { start: today, end: today, len: 1 };
    if (w === 'yesterday') return { start: shift(today, -1), end: shift(today, -1), len: 1 };
    if (w === 'tomorrow') return { start: shift(today, 1), end: shift(today, 1), len: 1 };
    const wd = WEEKDAYS.indexOf(w);
    if (wd >= 0) {
      const diff = (dayOfWeek(today) - wd + 7) % 7;
      const day = mode === 'past' ? shift(today, -diff) : shift(today, (wd - dayOfWeek(today) + 7) % 7);
      return { start: day, end: day, len: 1 };
    }
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
    if (iso) {
      const k = keyOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      return k ? { start: k, end: k, len: 1 } : null;
    }
    const place = (m: number, d: number, y: number | null): string | null => {
      if (y !== null) return keyOf(y, m, d);
      const options = [year - 1, year, year + 1].map((yy) => keyOf(yy, m, d)).filter((k): k is string => !!k);
      if (options.length === 0) return null;
      if (mode === 'past') return options.filter((k) => k <= today).pop() ?? null;
      const dist = (k: string) => Math.abs(new Date(`${k}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime());
      return options.sort((a, b) => dist(a) - dist(b))[0]!;
    };
    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(w);
    if (slash) {
      const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null;
      const k = place(Number(slash[2]), Number(slash[1]), y);
      return k ? { start: k, end: k, len: 1 } : null;
    }
    const month = (t: string) => {
      const m = MONTHS.indexOf(t.slice(0, 3));
      return m >= 0 && (t.length === 3 || t.startsWith(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][m]!.slice(0, t.length)) || (t === 'sept' && m === 8)) ? m + 1 : 0;
    };
    const dayNum = (t: string) => {
      const m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(t);
      return m ? Number(m[1]) : 0;
    };
    const yearAt = (k: number) => (/^\d{4}$/.test(n(k)) ? Number(n(k)) : null);
    // 1 Nov [2026]
    const d1 = dayNum(w);
    if (d1 && month(n(i + 1))) {
      const y = yearAt(i + 2);
      const k = place(month(n(i + 1)), d1, y);
      return k ? { start: k, end: k, len: y === null ? 2 : 3 } : null;
    }
    // Nov 1 [2026], or a month alone
    const m1 = month(w);
    if (m1) {
      const d = dayNum(n(i + 1));
      if (d) {
        const y = yearAt(i + 2);
        const k = place(m1, d, y);
        return k ? { start: k, end: k, len: y === null ? 2 : 3 } : null;
      }
      const y = yearAt(i + 1);
      const first = place(m1, 1, y);
      return first ? { start: first, end: lastOfMonth(first), len: y === null ? 1 : 2 } : null;
    }
    return null;
  };
  const rangeLabel = (r: { start: string; end: string }) => (r.start === r.end ? dayLabel(r.start, ctx.today) : `${dayLabel(r.start, ctx.today)} – ${dayLabel(r.end, ctx.today)}`);

  /** The named weeks and months ("this week", "last month"), as company days. */
  const period = (i: number): { from: string; to: string; label: string; len: number } | null => {
    const which = n(i);
    const unit = n(i + 1);
    if (!['last', 'this', 'next', 'past', 'previous', 'coming'].includes(which) || !['week', 'month'].includes(unit)) return null;
    const step = which === 'this' ? 0 : which === 'next' || which === 'coming' ? 1 : -1;
    const label = `${step === 0 ? 'This' : step > 0 ? 'Next' : 'Last'} ${unit}`;
    if (unit === 'week') {
      const start = shift(ctx.today, -((dayOfWeek(ctx.today) - ctx.weekStart + 7) % 7) + 7 * step);
      return { from: start, to: shift(start, 6), label, len: 2 };
    }
    const first = step === 0 ? firstOfMonth(ctx.today) : step > 0 ? monthAfter(ctx.today) : monthBefore(ctx.today);
    return { from: first, to: lastOfMonth(first), label, len: 2 };
  };

  const readings: Reading[] = [];
  const add = (r: Omit<Reading, 'part'> & { part?: string }) => readings.push({ part: '', ...r });
  const kindReading = (i: number, k: { kind: SearchKind; len: number }, strong: boolean) =>
    add({ key: 'kind', start: i, end: i + k.len, strong, part: KIND_LABEL[k.kind], apply: (f) => (f.kinds = [...new Set([...(f.kinds ?? []), k.kind])]) });
  const startsWithCommand = (() => {
    let i = 0;
    while (is(i, ...POLITE)) i += 1;
    return COMMANDS.has(n(i));
  })();

  let i = 0;
  while (i < toks.length) {
    if (toks[i]!.quoted) {
      i += 1;
      continue;
    }
    const at = i;
    const w = n(i);
    const next = (len: number) => (i = at + len);

    // Due dates
    if (seq(i, ['no', 'due', 'date']) || seq(i, ['without', 'due', 'date']) || seq(i, ['without', 'a', 'due', 'date']) || seq(i, ['without', 'any', 'due', 'date'])) {
      const len = is(i + 1, 'due') ? 3 : 4;
      add({ key: 'due', start: i, end: i + len, strong: true, part: 'No due date', apply: (f) => (f.due = 'none') });
      next(len);
      continue;
    }
    if (w === 'overdue' || seq(i, ['past', 'due']) || seq(i, ['over', 'due'])) {
      const len = w === 'overdue' ? 1 : 2;
      add({ key: 'due', start: i, end: i + len, strong: true, part: 'Overdue', apply: (f) => (f.due = 'overdue') });
      next(len);
      continue;
    }
    if (w === 'due') {
      const named: Record<string, string> = { today: 'Due today', tomorrow: 'Due tomorrow' };
      const p = period(i + 1);
      if (p && !seq(i + 1, ['last', 'week']) && !seq(i + 1, ['last', 'month'])) {
        const r = { from: p.from, to: p.to };
        add({ key: 'due', start: i, end: i + 1 + p.len, strong: true, part: `Due ${p.label.toLowerCase()}`, apply: (f) => (f.due = r) });
        next(1 + p.len);
        continue;
      }
      if (named[n(i + 1)]) {
        const day = n(i + 1) === 'today' ? ctx.today : shift(ctx.today, 1);
        add({ key: 'due', start: i, end: i + 2, strong: true, part: named[n(i + 1)]!, apply: (f) => (f.due = { from: day, to: day }) });
        next(2);
        continue;
      }
      const how = n(i + 1);
      if (['before', 'by', 'after', 'on', 'until'].includes(how)) {
        const d = dateAt(i + 2, 'near');
        if (d) {
          const r = how === 'before' ? { to: shift(d.start, -1) } : how === 'after' ? { from: shift(d.end, 1) } : how === 'on' ? { from: d.start, to: d.end } : { to: d.end };
          const label = how === 'on' ? `Due ${rangeLabel(d)}` : `Due ${how} ${rangeLabel(d)}`;
          add({ key: 'due', start: i, end: i + 2 + d.len, strong: true, part: label, apply: (f) => (f.due = r) });
          next(2 + d.len);
          continue;
        }
      }
      const d = dateAt(i + 1, 'near');
      if (d && n(i + 1) !== 'yesterday') {
        const r = { from: d.start, to: d.end };
        add({ key: 'due', start: i, end: i + 1 + d.len, strong: true, part: `Due ${rangeLabel(d)}`, apply: (f) => (f.due = r) });
        next(1 + d.len);
        continue;
      }
    }

    // When (each kind's own date)
    if (w === 'between') {
      const a = dateAt(i + 1, 'near');
      if (a && is(i + 1 + a.len, 'and', '&')) {
        const b = dateAt(i + 2 + a.len, 'near');
        if (b) {
          const from = a.start <= b.start ? a.start : b.start;
          const to = a.end >= b.end ? a.end : b.end;
          add({ key: 'when', start: i, end: i + 2 + a.len + b.len, strong: true, part: rangeLabel({ start: from, end: to }), apply: (f) => ((f.from = from), (f.to = to)) });
          next(2 + a.len + b.len);
          continue;
        }
      }
    }
    if (['since', 'after', 'from', 'before', 'until', 'till', 'on'].includes(w)) {
      const d = dateAt(i + 1, w === 'since' || w === 'after' || w === 'from' ? 'past' : 'near');
      if (d) {
        const r: { from?: string; to?: string } =
          w === 'since' || w === 'from' ? { from: d.start } : w === 'after' ? { from: shift(d.end, 1) } : w === 'before' ? { to: shift(d.start, -1) } : w === 'on' ? { from: d.start, to: d.end } : { to: d.end };
        const word = w === 'from' ? 'Since' : w === 'till' ? 'Until' : w === 'on' ? 'On' : w[0]!.toUpperCase() + w.slice(1);
        add({ key: 'when', start: i, end: i + 1 + d.len, strong: true, part: `${word} ${rangeLabel(d)}`, apply: (f) => Object.assign(f, r) });
        next(1 + d.len);
        continue;
      }
    }
    const p = period(i);
    if (p) {
      add({ key: 'when', start: i, end: i + p.len, strong: true, part: p.label, apply: (f) => ((f.from = p.from), (f.to = p.to)) });
      next(p.len);
      continue;
    }
    if (w === 'today' || w === 'yesterday' || w === 'tomorrow') {
      const d = dateAt(i, 'near')!;
      add({ key: 'when', start: i, end: i + 1, strong: false, part: w[0]!.toUpperCase() + w.slice(1), apply: (f) => ((f.from = d.start), (f.to = d.end)) });
      next(1);
      continue;
    }

    // Approval and state
    if (seq(i, ['waiting', 'for', 'approval']) || seq(i, ['awaiting', 'approval']) || seq(i, ['pending', 'approval']) || seq(i, ['waiting', 'approval']) || seq(i, ['to', 'approve'])) {
      const len = seq(i, ['waiting', 'for', 'approval']) ? 3 : 2;
      add({ key: 'approval', start: i, end: i + len, strong: true, part: 'Waiting for approval', apply: (f) => (f.approval = true) });
      next(len);
      continue;
    }
    if ((seq(i, ['in', 'progress']) || w === 'in-progress') && n(i - 1) !== 'work') {
      const len = w === 'in-progress' ? 1 : 2;
      add({ key: 'status', start: i, end: i + len, strong: true, part: STATUS_LABEL.IN_PROGRESS, apply: (f) => (f.statuses = [...new Set([...(f.statuses ?? []), 'IN_PROGRESS' as const])]) });
      next(len);
      continue;
    }
    if (seq(i, ['in', 'review']) || seq(i, ['under', 'review'])) {
      add({ key: 'status', start: i, end: i + 2, strong: true, part: STATUS_LABEL.REVIEW, apply: (f) => (f.statuses = [...new Set([...(f.statuses ?? []), 'REVIEW' as const])]) });
      next(2);
      continue;
    }
    if (is(i, 'are', 'is') && (n(i + 1) === 'blocked' || DONE_WORDS[n(i + 1)] !== undefined)) {
      const word = n(i + 1);
      if (word === 'blocked') add({ key: 'status', start: i, end: i + 2, strong: true, part: STATUS_LABEL.BLOCKED, apply: (f) => (f.statuses = [...new Set([...(f.statuses ?? []), 'BLOCKED' as const])]) });
      else add({ key: 'done', start: i, end: i + 2, strong: true, part: DONE_WORDS[word] ? 'Done' : 'Open', apply: (f) => (f.done = DONE_WORDS[word]) });
      next(2);
      continue;
    }
    if (w === 'not' && ['done', 'completed', 'finished', 'closed', 'complete'].includes(n(i + 1))) {
      add({ key: 'done', start: i, end: i + 2, strong: true, part: 'Open', apply: (f) => (f.done = false) });
      next(2);
      continue;
    }
    if (w === 'blocked' || DONE_WORDS[w] !== undefined) {
      const k = kindAt(i + 1);
      if (k) {
        if (w === 'blocked') add({ key: 'status', start: i, end: i + 1, strong: true, part: STATUS_LABEL.BLOCKED, apply: (f) => (f.statuses = [...new Set([...(f.statuses ?? []), 'BLOCKED' as const])]) });
        else add({ key: 'done', start: i, end: i + 1, strong: true, part: DONE_WORDS[w] ? 'Done' : 'Open', apply: (f) => (f.done = DONE_WORDS[w]) });
        kindReading(i + 1, k, true);
        next(1 + k.len);
        continue;
      }
    }

    // Priority
    const prio = (t: string) => PRIORITY_WORDS[t];
    const dashed = /^(low|normal|medium|high|urgent|critical)-prio(?:rity)?$|^prio(?:rity)?-(low|normal|medium|high|urgent|critical)$/.exec(w);
    const pr =
      dashed ? { p: prio(dashed[1] ?? dashed[2]!)!, len: 1 }
      : prio(w) && is(i + 1, 'priority', 'prio') ? { p: prio(w)!, len: 2 }
      : is(i, 'priority', 'prio') && prio(n(i + 1)) ? { p: prio(n(i + 1))!, len: 2 }
      : w === 'urgent' ? { p: 'URGENT' as const, len: 1 }
      : null;
    if (pr) {
      add({ key: 'priority', start: i, end: i + pr.len, strong: true, part: PRIORITY_LABEL[pr.p], apply: (f) => (f.priorities = [...new Set([...(f.priorities ?? []), pr.p])]) });
      next(pr.len);
      continue;
    }

    // People
    if (seq(i, ['assigned', 'to'])) {
      const who = whoAt(i + 2);
      if (who) {
        add({ key: 'assignee', start: i, end: i + 2 + who.len, strong: true, part: who.part, apply: (f) => (f.assignee = [...new Set([...(Array.isArray(f.assignee) ? f.assignee : []), ...who.ids])]) });
        next(2 + who.len);
        continue;
      }
    }
    if (w === 'unassigned' || seq(i, ['not', 'assigned']) || seq(i, ['no', 'assignee']) || seq(i, ['without', 'assignee']) || seq(i, ['without', 'an', 'assignee'])) {
      const len = w === 'unassigned' ? 1 : seq(i, ['without', 'an', 'assignee']) ? 3 : 2;
      add({ key: 'assignee', start: i, end: i + len, strong: true, part: 'nobody', apply: (f) => (f.assignee = 'none') });
      next(len);
      continue;
    }
    for (const [verb, key] of [
      [['created', 'made', 'added', 'raised'], 'creator'],
      [['organised', 'organized', 'hosted'], 'organizer'],
    ] as const) {
      if ((verb as readonly string[]).includes(w) && is(i + 1, 'by')) {
        const who = whoAt(i + 2);
        if (who) {
          add({ key, start: i, end: i + 2 + who.len, strong: true, part: who.part, apply: (f) => (f[key] = [...new Set([...(f[key] ?? []), ...who.ids])]) });
          next(2 + who.len);
          break;
        }
      }
    }
    if (i !== at) continue;
    if (w === 'my') {
      const k = kindAt(i + 1);
      if (k) {
        add({ key: 'mine', start: i, end: i + 1, strong: true, part: 'Mine', apply: (f) => (f.mine = true) });
        kindReading(i + 1, k, true);
        next(1 + k.len);
        continue;
      }
    }
    if (w === 'mine' || seq(i, ['for', 'me'])) {
      const len = w === 'mine' ? 1 : 2;
      add({ key: 'mine', start: i, end: i + len, strong: false, part: 'Mine', apply: (f) => (f.mine = true) });
      next(len);
      continue;
    }

    // Projects (only with a cue)
    if (w === 'in' || w === 'project' || w === 'for' || w === 'on' || w === 'at') {
      const found = projectAt(i + 1);
      if (found) {
        add({ key: 'project', start: w === 'project' ? i : i + 1, end: i + 1 + found.len, strong: w === 'in' || w === 'project', part: found.p.code, apply: (f) => (f.projectId = found.p.id) });
        next(1 + found.len);
        continue;
      }
    }
    {
      const found = projectAt(i);
      if (found) {
        const k = kindAt(i + found.len);
        if (is(i + found.len, 'project')) {
          add({ key: 'project', start: i, end: i + found.len + 1, strong: true, part: found.p.code, apply: (f) => (f.projectId = found.p.id) });
          next(found.len + 1);
          continue;
        }
        if (k) {
          add({ key: 'project', start: i, end: i + found.len, strong: true, part: found.p.code, apply: (f) => (f.projectId = found.p.id) });
          kindReading(i + found.len, k, true);
          next(found.len + k.len);
          continue;
        }
      }
    }

    // Kinds
    const k = kindAt(i);
    if (k) {
      const strong = kindStrong(i, k);
      if (!k.cuedOnly || strong || startsWithCommand) {
        kindReading(i, k, strong);
        next(k.len);
        continue;
      }
    }
    i += 1;
  }

  // Weak readings count only beside a strong one, another weak one, or a command.
  const strong = readings.filter((r) => r.strong).length;
  const weak = readings.length - strong;
  const kept = strong > 0 || weak >= 2 || (startsWithCommand && weak >= 1) ? readings : [];
  if (kept.length === 0) return none;

  const used = new Set<number>();
  for (const r of kept) for (let k = r.start; k < r.end; k++) used.add(k);
  const off = new Set(opts.off ?? []);
  const filters: ReaderFilters = {};
  const parts = new Map<ReaderChipKey, { parts: string[]; text: string[] }>();
  for (const r of [...kept].sort((a, b) => a.start - b.start)) {
    if (off.has(r.key)) continue;
    const had = parts.get(r.key);
    // One chip per key: a second due date, project or "since" is left out (its words too).
    if (had && !MERGED.has(r.key)) continue;
    r.apply(filters);
    const words = toks.slice(r.start, r.end).map((t) => t.raw.replace(/[,.;:!?]+$/, '')).join(' ');
    if (had) {
      if (!had.parts.includes(r.part)) had.parts.push(r.part);
      had.text.push(words);
    } else parts.set(r.key, { parts: [r.part], text: [words] });
  }
  const chips: ReaderChip[] = [];
  for (const key of READER_CHIP_KEYS) {
    const c = parts.get(key);
    if (!c) continue;
    chips.push({ key, label: chipLabel(key, c.parts, filters), text: c.text.join(' ') });
  }
  const words = toks
    .filter((t, k) => !used.has(k) && (t.quoted || !FILLERS.has(t.n)))
    .map((t) => t.raw)
    .join(' ');
  return { chips, words, filters };
}

function chipLabel(key: ReaderChipKey, parts: string[], f: ReaderFilters): string {
  const or = (list: string[]) => list.join(' or ');
  switch (key) {
    case 'kind': {
      const labels = (f.kinds ?? []).map((k) => KIND_LABEL[k]);
      return labels.map((l, i) => (i === 0 ? l : l.toLowerCase())).join(' or ');
    }
    case 'priority': {
      const ps = f.priorities ?? [];
      if (ps.length === 1) return PRIORITY_LABEL[ps[0]!];
      return `${or(ps.map((p) => (p === 'URGENT' ? 'Urgent' : p[0] + p.slice(1).toLowerCase())))} priority`;
    }
    case 'status':
      return or((f.statuses ?? []).map((s) => STATUS_LABEL[s]));
    case 'assignee':
      return f.assignee === 'none' ? 'Unassigned' : `Assigned to ${or(parts.filter((p) => p !== 'nobody'))}`;
    case 'creator':
      return `Created by ${or(parts)}`;
    case 'organizer':
      return `Organised by ${or(parts)}`;
    default:
      return parts[0] ?? '';
  }
}
