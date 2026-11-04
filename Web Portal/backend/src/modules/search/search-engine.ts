import { Prisma, type PrismaClient } from '@prisma/client';
import { LIVE_PROJECT_SQL } from '../companies/project-archive';
import { describeTaskHits, numberOf, numberSql, type TaskSearchHit } from './task-search-engine';
import { escapeLike, parseTaskQuery } from './task-search-query';
import { normalizeForSearch } from './text-normalize';
import { visibleTasksSql } from './task-search-scope';
import { describeIndexed, projectLooks } from './search-describe';
import { allowedTypos } from './search-fuzzy';
import { SEARCH_KINDS, type SearchHit, type SearchKind } from './search-types';
import type { IndexKind } from './search-docs';
import type { SearchScopeAll } from './search-scope';

/**
 * 1.23 Search everything — the standard search, always there (AI or not): every kind of item the
 * person may open (search-scope) that holds the words, from both indexes in one query (tasks in
 * task_search_index, everything else in search_index), so the order and the counts per kind are one.
 *
 * Matching: every word (or "phrase") somewhere in the item, part of a word too, Arabic-normalised; a
 * task's number however it is typed finds it first (1.22.3). When fewer than FEW items hold every
 * word, two more passes add results below them: spelling mistakes (each word against the index's
 * words, search-fuzzy) — "close" — and then items holding some of the words — "some".
 *
 * Ranking: the number; every word in the title or ID; the phrase as typed; every word in the
 * description (a note's text, the minutes' summary next; file text last); open before done; recent
 * before old; the person's own (assigned, organizer, author, uploader, inspector) a little first.
 */

/** Fewer exact results than this and the spelling and some-words passes run. */
export const FEW = 5;
/** Counts per kind stop at this many ("1000+"). */
export const COUNT_CAP = 1000;
/** The spelling and some-words passes add at most this many each. */
const EXTRA = 50;

export interface SearchAllInput {
  q: string;
  scope: SearchScopeAll;
  viewerId: string;
  kinds?: SearchKind[];
  projectId?: string;
  /** Task column categories (TODO, DONE…): only tasks then. */
  taskStatuses?: string[];
  /** true: finished items only; false: open ones only. */
  done?: boolean;
  /** Items of this person (assigned, organizer or attendee, author, uploader, inspector, on the project). */
  personId?: string;
  /** Its date (a task's due date, a meeting's start, a note written…) on or after / before. */
  from?: Date;
  to?: Date;
  includeArchived?: boolean;
  limit: number;
  /** Where the page starts; `extra`: in the list of the extra passes (see the cursor). */
  offset?: number;
  extra?: boolean;
  withCounts?: boolean;
}

export interface SearchAllResult {
  hits: SearchHit[];
  next: { offset: number; extra: boolean } | null;
  /** Per kind (first page), counted up to COUNT_CAP each. */
  counts?: Record<SearchKind, number>;
  total?: number;
  totalCapped?: boolean;
  /** Spelling corrections that found results ("genarator" → "generator"). */
  corrected: { from: string; to: string }[];
}

/** A word and the spellings it may also be found by. */
type Group = string[];
interface Pass {
  groups: Group[];
  /** At least this many groups must be in an item. */
  min: number;
  /** The task number condition (exact pass only). */
  byNumber: Prisma.Sql | null;
  /** The whole query, for "the phrase as typed" (two words or more). */
  phrase: string | null;
}

const like = (term: string) => Buffer.from(`%${escapeLike(term)}%`, 'utf8');
const anyOf = (col: Prisma.Sql, group: Group) => Prisma.sql`(${Prisma.join(group.map((a) => Prisma.sql`${col} LIKE ${like(a)} ESCAPE '!'`), ' OR ')})`;
const allOf = (col: Prisma.Sql, groups: Group[]) => Prisma.sql`(${Prisma.join(groups.map((g) => anyOf(col, g)), ' AND ')})`;
const howMany = (col: Prisma.Sql, groups: Group[]) => Prisma.sql`(${Prisma.join(groups.map((g) => Prisma.sql`(${anyOf(col, g)})`), ' + ')})`;
const ids = (list: readonly string[]) => (list.length ? Prisma.join(list) : Prisma.sql`NULL`);
const inList = (col: Prisma.Sql, list: readonly string[] | null) => (list === null ? Prisma.sql`TRUE` : list.length ? Prisma.sql`${col} IN (${ids(list)})` : Prisma.sql`FALSE`);
const recency = (at: Prisma.Sql) => Prisma.sql`GREATEST(0, 25 - LEAST(25, ABS(DATEDIFF(${at}, NOW())) / 7))`;

export function createSearchEngine({
  prisma,
  timeZone,
  suggest,
  onStale,
}: {
  prisma: PrismaClient;
  timeZone: string;
  /** Spellings a word may be a mistake for (the vocabulary); absent: no spelling pass. */
  suggest?: (word: string) => Promise<string[]>;
  /** An item the index was behind on: re-index it. */
  onStale?: (kind: SearchKind, id: string) => void;
}) {
  /** The task half of the query: tasks this person may open that hold the words, with the filters. */
  function taskPart(pass: Pass, input: SearchAllInput, scored: boolean): Prisma.Sql | null {
    const kinds = input.kinds;
    if (kinds && !kinds.includes('task')) return null;
    const visible = visibleTasksSql({ projectIds: input.scope.projectIds }, { includeArchived: input.includeArchived, ...(pass.byNumber ? { archivedWhen: pass.byNumber } : {}) });
    const doc = Prisma.sql`si.doc`;
    const words = pass.min >= pass.groups.length ? allOf(doc, pass.groups) : Prisma.sql`${howMany(doc, pass.groups)} >= ${pass.min}`;
    const where: Prisma.Sql[] = [visible, pass.byNumber ? Prisma.sql`(${words} OR ${pass.byNumber})` : words];
    if (input.projectId) where.push(Prisma.sql`t.projectId = ${input.projectId}`);
    if (input.taskStatuses?.length) where.push(Prisma.sql`c.category IN (${Prisma.join(input.taskStatuses)})`);
    const done = Prisma.sql`(t.completedAt IS NOT NULL OR c.category = 'DONE')`;
    if (input.done === true) where.push(done);
    if (input.done === false) where.push(Prisma.sql`NOT ${done}`);
    const assigned = (userId: string) => Prisma.sql`EXISTS (SELECT 1 FROM task_assignees a WHERE a.taskId = t.id AND a.userId = ${userId})`;
    if (input.personId) where.push(assigned(input.personId));
    if (input.from) where.push(Prisma.sql`t.dueDate >= ${input.from}`);
    if (input.to) where.push(Prisma.sql`t.dueDate < ${input.to}`);
    const score = scored
      ? Prisma.sql`(${pass.byNumber ?? Prisma.sql`FALSE`}) * 1000
        + (${allOf(Prisma.sql`si.head`, pass.groups)}) * 200 + ${howMany(Prisma.sql`si.head`, pass.groups)} * 20
        + ${pass.phrase ? Prisma.sql`(si.head LIKE ${like(pass.phrase)} ESCAPE '!') * 100 + (si.doc LIKE ${like(pass.phrase)} ESCAPE '!') * 60` : Prisma.sql`0`}
        + (${allOf(Prisma.sql`COALESCE(si.lead, '')`, pass.groups)}) * 80
        + ${howMany(doc, pass.groups)} * 40 + 10
        + (NOT ${done}) * 30 + (${assigned(input.viewerId)}) * 15 + ${recency(Prisma.sql`t.updatedAt`)}`
      : Prisma.sql`0`;
    return Prisma.sql`SELECT 'task' AS kind, t.id AS id, ${score} AS score, t.updatedAt AS at
      FROM task_search_index si JOIN tasks t ON t.id = si.taskId JOIN projects p ON p.id = t.projectId JOIN kanban_columns c ON c.id = t.columnId
      WHERE ${Prisma.join(where, ' AND ')}`;
  }

  /** The other half: projects, meetings, notes, minutes, files and inspections this person may see. */
  function indexPart(pass: Pass, input: SearchAllInput, scored: boolean): Prisma.Sql | null {
    if (input.taskStatuses?.length) return null; // a task status: tasks only
    const wanted = (input.kinds ?? [...SEARCH_KINDS]).filter((k): k is IndexKind => k !== 'task');
    if (wanted.length === 0) return null;
    const { projectIds, meetings } = input.scope;
    const invitee = meetings.invitee;
    // What a meeting seen as an invitee is searched by: its limited text (never decisions or action items).
    const txt = invitee.length ? Prisma.sql`(CASE WHEN si.kind = 'meeting' AND si.meetingId IN (${ids(invitee)}) THEN si.limited ELSE si.doc END)` : Prisma.sql`si.doc`;
    const live = input.includeArchived ? Prisma.sql`TRUE` : LIVE_PROJECT_SQL;
    const full = inList(Prisma.sql`m.id`, meetings.full);
    const seen = Prisma.sql`(${full} OR ${inList(Prisma.sql`m.id`, invitee)})`;
    const editable = inList(Prisma.sql`m.id`, meetings.editable);
    const visible = Prisma.sql`(
      (si.kind IN ('project', 'inspection') AND p.deletedAt IS NULL AND ${inList(Prisma.sql`si.projectId`, projectIds)} AND ${live})
      OR (si.kind = 'file' AND ft.deletedAt IS NULL AND p.deletedAt IS NULL AND ${inList(Prisma.sql`ft.projectId`, projectIds)} AND ${live})
      OR (si.kind = 'meeting' AND m.deletedAt IS NULL AND ${seen})
      OR (si.kind = 'note' AND m.deletedAt IS NULL AND ${full})
      OR (si.kind = 'minutes' AND m.deletedAt IS NULL AND ((si.status = 'APPROVED' AND ${seen}) OR (si.status <> 'APPROVED' AND ${full} AND ${editable}))))`;
    const words = pass.min >= pass.groups.length ? allOf(txt, pass.groups) : Prisma.sql`${howMany(txt, pass.groups)} >= ${pass.min}`;
    const where: Prisma.Sql[] = [Prisma.sql`si.kind IN (${Prisma.join(wanted)})`, visible, words];
    if (input.projectId) where.push(Prisma.sql`p.id = ${input.projectId}`);
    const done = Prisma.sql`(CASE si.kind
      WHEN 'project' THEN p.status IN ('COMPLETED', 'ARCHIVED')
      WHEN 'inspection' THEN si.status = 'FINISHED'
      WHEN 'file' THEN (ft.completedAt IS NOT NULL OR fc.category = 'DONE')
      WHEN 'minutes' THEN si.status = 'APPROVED'
      ELSE m.status IN ('COMPLETED', 'CANCELLED') END)`;
    if (input.done === true) where.push(Prisma.sql`COALESCE(${done}, FALSE)`);
    if (input.done === false) where.push(Prisma.sql`NOT COALESCE(${done}, FALSE)`);
    const theirs = (userId: string) => Prisma.sql`(CASE si.kind
      WHEN 'project' THEN (p.ownerId = ${userId} OR p.managerId = ${userId} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ${userId}))
      WHEN 'meeting' THEN (m.organizerId = ${userId} OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meetingId = m.id AND ma.userId = ${userId}))
      WHEN 'minutes' THEN (m.organizerId = ${userId} OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meetingId = m.id AND ma.userId = ${userId}))
      ELSE si.personId = ${userId} END)`;
    if (input.personId) where.push(Prisma.sql`COALESCE(${theirs(input.personId)}, FALSE)`);
    const when = Prisma.sql`COALESCE(CASE WHEN si.kind = 'meeting' THEN m.startAt END, si.at, si.indexedAt)`;
    if (input.from) where.push(Prisma.sql`${when} >= ${input.from}`);
    if (input.to) where.push(Prisma.sql`${when} < ${input.to}`);
    const leadWeight = Prisma.sql`(CASE si.kind WHEN 'file' THEN 0 WHEN 'note' THEN 30 WHEN 'minutes' THEN 50 ELSE 80 END)`;
    const kindWeight = Prisma.sql`(CASE si.kind WHEN 'file' THEN -20 WHEN 'note' THEN 0 WHEN 'minutes' THEN 0 ELSE 10 END)`;
    const score = scored
      ? Prisma.sql`(${allOf(Prisma.sql`si.head`, pass.groups)}) * 200 + ${howMany(Prisma.sql`si.head`, pass.groups)} * 20
        + ${pass.phrase ? Prisma.sql`(si.head LIKE ${like(pass.phrase)} ESCAPE '!') * 100 + (${txt} LIKE ${like(pass.phrase)} ESCAPE '!') * 60` : Prisma.sql`0`}
        + (${allOf(Prisma.sql`COALESCE(si.lead, '')`, pass.groups)}) * ${leadWeight}
        + ${howMany(txt, pass.groups)} * 40 + ${kindWeight}
        + (NOT COALESCE(${done}, FALSE)) * 30 + COALESCE(${theirs(input.viewerId)}, FALSE) * 15 + ${recency(when)}`
      : Prisma.sql`0`;
    return Prisma.sql`SELECT si.kind AS kind, si.recordId AS id, ${score} AS score, ${when} AS at
      FROM search_index si
      LEFT JOIN tasks ft ON ft.id = si.taskId
      LEFT JOIN kanban_columns fc ON fc.id = ft.columnId
      LEFT JOIN meetings m ON m.id = si.meetingId
      LEFT JOIN projects p ON p.id = (CASE WHEN si.kind = 'file' THEN ft.projectId WHEN si.meetingId IS NOT NULL THEN m.projectId ELSE si.projectId END)
      WHERE ${Prisma.join(where, ' AND ')}`;
  }

  const union = (pass: Pass, input: SearchAllInput, scored: boolean): Prisma.Sql | null => {
    const parts = [taskPart(pass, input, scored), indexPart(pass, input, scored)].filter((p): p is Prisma.Sql => !!p);
    return parts.length ? Prisma.join(parts, ' UNION ALL ') : null;
  };

  async function rows(pass: Pass, input: SearchAllInput, limit: number, offset: number): Promise<{ kind: SearchKind; id: string }[]> {
    const u = union(pass, input, true);
    if (!u) return [];
    return prisma.$queryRaw<{ kind: SearchKind; id: string }[]>`SELECT kind, id FROM (${u}) x ORDER BY score DESC, at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  async function counts(pass: Pass, input: SearchAllInput): Promise<Record<SearchKind, number>> {
    const out = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;
    const parts = [taskPart(pass, input, false), indexPart(pass, input, false)].filter((p): p is Prisma.Sql => !!p);
    // Each kind counted up to COUNT_CAP + 1 (a big result set is never counted in full).
    const results = await Promise.all(parts.map((part) => prisma.$queryRaw<{ kind: string; n: bigint | number }[]>`SELECT kind, COUNT(*) AS n FROM (SELECT kind FROM (${part}) y LIMIT ${(COUNT_CAP + 1) * SEARCH_KINDS.length}) x GROUP BY kind`));
    for (const r of results.flat()) if ((SEARCH_KINDS as readonly string[]).includes(r.kind)) out[r.kind as SearchKind] = Math.min(Number(r.n), COUNT_CAP + 1);
    return out;
  }

  /** Results as they are now, in this order; each `accept`ed by the words found in it. */
  async function describe(found: { kind: SearchKind; id: string; match?: 'close' | 'some' }[], terms: string[], accept: (words: string[]) => boolean, input: SearchAllInput, byNumber?: (task: { key: string; formerKeys: string[] }) => string | null): Promise<SearchHit[]> {
    const taskIds = found.filter((f) => f.kind === 'task').map((f) => f.id);
    const others = found.filter((f): f is { kind: Exclude<SearchKind, 'task'>; id: string } => f.kind !== 'task');
    const [tasks, indexed] = await Promise.all([
      describeTaskHits(prisma, taskIds, terms, { timeZone, max: 2, ...(byNumber ? { byNumber } : {}), accept, onStale: (id) => onStale?.('task', id) }),
      describeIndexed(prisma, others, { terms, accept, invitee: new Set(input.scope.meetings.invitee), timeZone, onStale: (kind, id) => onStale?.(kind, id) }),
    ]);
    const looks = await projectLooks(prisma, tasks.map((t) => t.projectId));
    const taskHits = new Map(tasks.map((t) => [t.id, fromTask(t, looks.get(t.projectId) ?? null)]));
    const out: SearchHit[] = [];
    for (const f of found) {
      const hit = f.kind === 'task' ? taskHits.get(f.id) : indexed.get(`${f.kind}:${f.id}`);
      if (hit) out.push(f.match ? { ...hit, match: f.match } : hit);
    }
    return out;
  }

  async function search(input: SearchAllInput): Promise<SearchAllResult> {
    const { terms, whole } = parseTaskQuery(input.q);
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit)));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const empty: SearchAllResult = { hits: [], next: null, corrected: [], ...(input.withCounts ? { counts: Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>, total: 0, totalCapped: false } : {}) };
    if (terms.length === 0) return empty;
    const exact: Pass = { groups: terms.map((t) => [t]), min: terms.length, byNumber: numberSql(whole, input.q), phrase: terms.length > 1 ? whole : null };
    const byNumber = (task: { key: string; formerKeys: string[] }) => numberOf(task, whole, input.q);
    const all = (words: string[]) => words.length === terms.length;

    if (!input.extra) {
      const [page, counted] = await Promise.all([rows(exact, input, limit + 1, offset), input.withCounts || offset === 0 ? counts(exact, input) : Promise.resolve(null)]);
      const total = counted ? Object.values(counted).reduce((a, b) => a + b, 0) : null;
      // Plenty hold every word (or this is a later page of them): those, a page at a time.
      if (offset > 0 || total === null || total >= FEW) {
        const hits = await describe(page.slice(0, limit), terms, all, input, byNumber);
        return {
          hits,
          next: page.length > limit ? { offset: offset + limit, extra: false } : null,
          corrected: [],
          ...(input.withCounts && counted ? { counts: counted, total: total!, totalCapped: Object.values(counted).some((n) => n > COUNT_CAP) } : {}),
        };
      }
    }
    return withExtras(input, exact, terms, limit, input.extra ? offset : 0, byNumber);
  }

  /**
   * Few hold every word: those, then items found by corrected spellings, then items holding some of
   * the words — one list (each pass's best), paged in memory.
   */
  async function withExtras(input: SearchAllInput, exact: Pass, terms: string[], limit: number, offset: number, byNumber: (task: { key: string; formerKeys: string[] }) => string | null): Promise<SearchAllResult> {
    const firstRows = await rows(exact, input, FEW, 0);
    const seen = new Set(firstRows.map((r) => `${r.kind}:${r.id}`));
    const list: { kind: SearchKind; id: string; match?: 'close' | 'some' }[] = [...firstRows];
    const fresh = (r: { kind: SearchKind; id: string }) => !seen.has(`${r.kind}:${r.id}`) && (seen.add(`${r.kind}:${r.id}`), true);

    // Spelling mistakes: each word of 4 letters or more also as the indexed words it may be a mistake for.
    const alternatives = new Map<string, string[]>();
    if (suggest) for (const t of terms.slice(0, 6)) if (allowedTypos(t) > 0) {
      const alts = (await suggest(t)).filter((a) => a !== t);
      if (alts.length) alternatives.set(t, alts);
    }
    const closeGroups = terms.map((t) => [t, ...(alternatives.get(t) ?? [])]);
    if (alternatives.size) {
      for (const r of await rows({ groups: closeGroups, min: terms.length, byNumber: null, phrase: null }, input, EXTRA, 0)) if (fresh(r)) list.push({ ...r, match: 'close' });
    }
    // Some of the words (two words or more): at least half of them.
    if (terms.length > 1) {
      const min = Math.ceil(terms.length / 2);
      for (const r of await rows({ groups: closeGroups, min, byNumber: null, phrase: null }, input, EXTRA, 0)) if (fresh(r)) list.push({ ...r, match: 'some' });
    }

    const flat = [...new Set(closeGroups.flat())];
    const groupsFound = (words: string[]) => closeGroups.filter((g) => g.some((a) => words.includes(a))).length;
    const minSome = terms.length > 1 ? Math.ceil(terms.length / 2) : terms.length;
    // Every result is checked as it is now: an exact one must still hold every word (or be the task
    // its number names); a corrected one every word in some spelling; the rest at least half of them.
    const pageItems = list.slice(offset, offset + limit);
    const [exactHits, extraHits] = await Promise.all([
      describe(pageItems.filter((i) => !i.match), terms, (words) => terms.every((t) => words.includes(t)), input, byNumber),
      describe(pageItems.filter((i) => !!i.match), flat, (words) => groupsFound(words) >= minSome, input),
    ]);
    const byKey = new Map([...exactHits, ...extraHits].map((h) => [`${h.kind}:${h.id}`, h]));
    const checked = pageItems.map((i) => byKey.get(`${i.kind}:${i.id}`)).filter((h): h is SearchHit => !!h);
    const corrected: { from: string; to: string }[] = [];
    for (const [from, alts] of alternatives) {
      const shown = checked.filter((h) => h.match === 'close');
      const to = alts.find((alt) => shown.some((h) => mentions(h, alt)));
      if (to) corrected.push({ from, to });
    }
    const counts = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;
    for (const item of list) counts[item.kind] += 1;
    return {
      hits: checked,
      next: list.length > offset + limit ? { offset: offset + limit, extra: true } : null,
      corrected,
      ...(input.withCounts ? { counts, total: list.length, totalCapped: false } : {}),
    };
  }

  return { search, describe, rows, counts };
}

export type SearchEngine = ReturnType<typeof createSearchEngine>;

/** Does a result show this (normalised) word, in its title or a match? */
function mentions(hit: SearchHit, word: string): boolean {
  return [hit.title, hit.key ?? '', ...hit.matches.map((m) => m.snippet)].some((s) => normalizeForSearch(s).includes(word));
}

/** A task result as every result is shown. */
export function fromTask(t: TaskSearchHit, look: SearchHit['project']): SearchHit {
  return {
    kind: 'task',
    id: t.id,
    title: t.title,
    titleRanges: t.titleRanges,
    key: t.key,
    formerKeys: t.formerKeys,
    project: look ?? { id: t.project.id, code: t.project.code, name: t.project.name, archived: t.project.archived, color: '#8B1E1E', icon: null, imageUrl: null },
    status: { label: t.status.name, category: t.status.category, done: t.done },
    date: t.dueDate ? { at: t.dueDate, kind: 'due' } : null,
    people: t.assigneeCount ? { names: t.assignees.map((a) => a.name), count: t.assigneeCount } : null,
    matches: t.matches,
    target: { type: 'task', taskId: t.id },
  };
}
