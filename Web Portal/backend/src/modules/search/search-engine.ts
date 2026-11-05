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
import { canSeeDraft, type SearchScopeAll } from './search-scope';

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
/** One search's spelling pass, all its words together, stops after this long (security review, 1.23). */
export const TYPO_BUDGET_MS = 60;

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
  /**
   * Review M4: the same days for a task's due date, which is stored as the day's UTC midnight
   * (lib/due-date) — `dueFrom` the first day's, `dueTo` the day after the last's. Absent: from / to.
   */
  dueFrom?: Date;
  dueTo?: Date;
  includeArchived?: boolean;
  limit: number;
  /**
   * Security review (1.23): only items holding every word — no spelling or some-words pass, no counts
   * (the top bar's other kinds, which show whole matches only). Absent: the full search.
   */
  exactOnly?: boolean;
  /** Where the page starts; `extra`: in the list of the extra passes (see the cursor). */
  offset?: number;
  extra?: boolean;
  withCounts?: boolean;
  /** Only these items (meaning-search candidates): visibility and filters still apply. */
  only?: { kind: SearchKind; id: string }[];
  /**
   * The archived projects (by their own status or all their companies), read once for this search
   * (`withArchived`) instead of for every row; absent: the rule is asked row by row (LIVE_PROJECT_SQL).
   */
  archivedIds?: string[];
  /** Deleted projects, read with the archived ones (prepare). */
  deletedIds?: string[];
  /** What is the person's own, read once for the search (prepare): ranking only, never visibility. */
  mine?: { tasks: string[]; projects: string[]; meetings: string[] };
  /**
   * 1.23.1: the task half failing (a database error) leaves the other kinds — the result says
   * `tasksUnavailable` — and is told here, for each failing step (the caller records it once). Absent:
   * a failure fails the search (the AI panel's candidates).
   */
  onTasksFailed?: (err: unknown) => void;
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
  /** 1.23.1: the tasks couldn't be searched this time; the other kinds are here (see onTasksFailed). */
  tasksUnavailable?: true;
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
const anyOf = (col: Prisma.Sql, group: Group) => (group.length ? Prisma.sql`(${Prisma.join(group.map((a) => Prisma.sql`${col} LIKE ${like(a)} ESCAPE '!'`), ' OR ')})` : Prisma.sql`FALSE`);
const allOf = (col: Prisma.Sql, groups: Group[]) => (groups.length ? Prisma.sql`(${Prisma.join(groups.map((g) => anyOf(col, g)), ' AND ')})` : Prisma.sql`TRUE`);
const howMany = (col: Prisma.Sql, groups: Group[]) => (groups.length ? Prisma.sql`(${Prisma.join(groups.map((g) => Prisma.sql`(${anyOf(col, g)})`), ' + ')})` : Prisma.sql`0`);
const ids = (list: readonly string[]) => (list.length ? Prisma.join(list) : Prisma.sql`NULL`);
const inList = (col: Prisma.Sql, list: readonly string[] | null) => (list === null ? Prisma.sql`TRUE` : list.length ? Prisma.sql`${col} IN (${ids(list)})` : Prisma.sql`FALSE`);
/** Every word starts a word of the title (after a line break or a space): "found" in "foundation", not "crack" in "hydrocracker". */
const startsAWord = (a: string) => [`%\n${escapeLike(a)}%`, `% ${escapeLike(a)}%`].map((pattern) => Prisma.sql`si.head LIKE ${Buffer.from(pattern, 'utf8')} ESCAPE '!'`);
const wordStarts = (groups: Group[]) =>
  groups.length ? Prisma.sql`(${Prisma.join(groups.map((g) => Prisma.sql`(${Prisma.join(g.flatMap(startsAWord), ' OR ')})`), ' AND ')})` : Prisma.sql`FALSE`;
/** A meeting seen in full (search-scope): one by one, every meeting of some projects, or a company's without a project. */
const fullMeetingSql = (meetings: SearchScopeAll['meetings']): Prisma.Sql => {
  if (meetings.full === null) return Prisma.sql`TRUE`;
  const parts = [inList(Prisma.sql`m.id`, meetings.full)];
  if (meetings.fullProjects?.length) parts.push(Prisma.sql`m.projectId IN (${Prisma.join(meetings.fullProjects)})`);
  if (meetings.fullStandaloneCompany) parts.push(Prisma.sql`(m.projectId IS NULL AND m.companyId = ${meetings.fullStandaloneCompany})`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
};
/** A meeting whose draft minutes may be seen (with fullMeetingSql): canEditMeetingRecord's rule. */
const editableMeetingSql = (meetings: SearchScopeAll['meetings']): Prisma.Sql => {
  if (meetings.editable === null) return Prisma.sql`TRUE`;
  const parts = [inList(Prisma.sql`m.id`, meetings.editable)];
  if (meetings.editableProjects?.length) parts.push(Prisma.sql`m.projectId IN (${Prisma.join(meetings.editableProjects)})`);
  if (meetings.editor) parts.push(Prisma.sql`(m.organizerId = ${meetings.editor} OR m.createdById = ${meetings.editor})`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
};
const notIn = (col: Prisma.Sql, list: readonly string[]) => (list.length ? Prisma.sql`${col} NOT IN (${Prisma.join(list)})` : Prisma.sql`TRUE`);
/** The person's own item (see SearchAllInput.mine), for the ranking. */
const mineOf = (mine: NonNullable<SearchAllInput['mine']>, viewerId: string) => Prisma.sql`(CASE si.kind
  WHEN 'project' THEN ${inList(Prisma.sql`si.recordId`, mine.projects)}
  WHEN 'meeting' THEN ${inList(Prisma.sql`m.id`, mine.meetings)}
  WHEN 'minutes' THEN ${inList(Prisma.sql`m.id`, mine.meetings)}
  ELSE si.personId = ${viewerId} END)`;
/** A live project (not archived), from the archived ones read for the search; null: ask row by row; TRUE with archived ones asked for. */
const liveSql = (input: { includeArchived?: boolean; archivedIds?: string[] }): Prisma.Sql | null => {
  if (input.includeArchived) return Prisma.sql`TRUE`;
  if (!input.archivedIds) return null;
  return input.archivedIds.length ? Prisma.sql`p.id NOT IN (${Prisma.join(input.archivedIds)})` : Prisma.sql`TRUE`;
};
/**
 * 1.23.1: the task half's work, when the search's caller asked to be told of its failure: a failure is
 * told and answers `none` (the other kinds are still searched); otherwise it fails the search as before.
 */
const tasksOf = <T>(input: SearchAllInput, work: Promise<T>, none: T): Promise<T> =>
  input.onTasksFailed
    ? work.catch((err: unknown) => {
        input.onTasksFailed!(err);
        return none;
      })
    : work;
const recency = (at: Prisma.Sql) => Prisma.sql`GREATEST(0, 25 - LEAST(25, ABS(DATEDIFF(${at}, NOW())) / 7))`;

export function createSearchEngine({
  prisma,
  timeZone,
  suggest,
  onStale,
  clock = () => performance.now(),
}: {
  prisma: PrismaClient;
  timeZone: string;
  /** Spellings a word may be a mistake for (the vocabulary), each stopping at `deadline`; absent: no spelling pass. */
  suggest?: (word: string, opts?: { deadline?: number }) => Promise<string[]>;
  /** An item the index was behind on: re-index it. */
  onStale?: (kind: SearchKind, id: string) => void;
  /** The clock the spelling pass's deadline is on (the vocabulary's: performance.now). */
  clock?: () => number;
}) {
  /** The task half of the query: tasks this person may open that hold the words, with the filters. */
  function taskPart(pass: Pass, input: SearchAllInput, scored: boolean): Prisma.Sql | null {
    const kinds = input.kinds;
    if (kinds && !kinds.includes('task')) return null;
    const onlyTasks = input.only?.filter((o) => o.kind === 'task').map((o) => o.id);
    if (onlyTasks && onlyTasks.length === 0) return null;
    const prepared = !!input.deletedIds && (!!input.archivedIds || !!input.includeArchived);
    // visibleTasksSql's rule, with the deleted and archived projects read once for the search (the same
    // projects): no project row needs reading for each task.
    const live = input.includeArchived ? Prisma.sql`TRUE` : notIn(Prisma.sql`t.projectId`, input.archivedIds ?? []);
    const visible = prepared
      ? Prisma.sql`t.deletedAt IS NULL AND ${notIn(Prisma.sql`t.projectId`, input.deletedIds!)} AND ${pass.byNumber ? Prisma.sql`(${live} OR ${pass.byNumber})` : live} AND ${inList(Prisma.sql`t.projectId`, input.scope.projectIds)}`
      : visibleTasksSql({ projectIds: input.scope.projectIds }, { includeArchived: input.includeArchived, ...(pass.byNumber ? { archivedWhen: pass.byNumber } : {}) });
    const doc = Prisma.sql`si.doc`;
    const some = pass.min < pass.groups.length;
    const words = pass.min >= pass.groups.length ? allOf(doc, pass.groups) : Prisma.sql`${howMany(doc, pass.groups)} >= ${pass.min}`;
    const where: Prisma.Sql[] = [visible, pass.byNumber ? Prisma.sql`(${words} OR ${pass.byNumber})` : words];
    if (onlyTasks) where.push(Prisma.sql`t.id IN (${Prisma.join(onlyTasks)})`);
    if (input.projectId) where.push(Prisma.sql`t.projectId = ${input.projectId}`);
    if (input.taskStatuses?.length) where.push(Prisma.sql`c.category IN (${Prisma.join(input.taskStatuses)})`);
    const done = Prisma.sql`(t.completedAt IS NOT NULL OR c.category = 'DONE')`;
    if (input.done === true) where.push(done);
    if (input.done === false) where.push(Prisma.sql`NOT ${done}`);
    const assigned = (userId: string) => Prisma.sql`EXISTS (SELECT 1 FROM task_assignees a WHERE a.taskId = t.id AND a.userId = ${userId})`;
    if (input.personId) where.push(assigned(input.personId));
    const dueFrom = input.dueFrom ?? input.from;
    const dueTo = input.dueTo ?? input.to;
    if (dueFrom) where.push(Prisma.sql`t.dueDate >= ${dueFrom}`);
    if (dueTo) where.push(Prisma.sql`t.dueDate < ${dueTo}`);
    const score = scored
      ? Prisma.sql`(${pass.byNumber ?? Prisma.sql`FALSE`}) * 1000
        + (${allOf(Prisma.sql`si.head`, pass.groups)}) * 200 + ${howMany(Prisma.sql`si.head`, pass.groups)} * 20 + (${wordStarts(pass.groups)}) * 50
        + ${pass.phrase ? Prisma.sql`(si.head LIKE ${like(pass.phrase)} ESCAPE '!') * 100 + (si.doc LIKE ${like(pass.phrase)} ESCAPE '!') * 300` : Prisma.sql`0`}
        + (${allOf(Prisma.sql`COALESCE(si.lead, '')`, pass.groups)}) * 80
        + ${some ? Prisma.sql`${howMany(doc, pass.groups)} * 40` : Prisma.sql`0`} + 10
        + (NOT ${done}) * 30 + (${input.mine ? inList(Prisma.sql`t.id`, input.mine.tasks) : assigned(input.viewerId)}) * 15 + ${recency(Prisma.sql`t.updatedAt`)}`
      : Prisma.sql`0`;
    // The index first (one quick pass over the words), then only the matching tasks are read: left to
    // itself the planner reads every task of every project first.
    return Prisma.sql`SELECT 'task' AS kind, t.id AS id, ${score} AS score, t.updatedAt AS at
      FROM task_search_index si STRAIGHT_JOIN tasks t ON t.id = si.taskId ${prepared ? Prisma.empty : Prisma.sql`STRAIGHT_JOIN projects p ON p.id = t.projectId`} STRAIGHT_JOIN kanban_columns c ON c.id = t.columnId
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
    const live = liveSql(input) ?? (input.includeArchived ? Prisma.sql`TRUE` : LIVE_PROJECT_SQL);
    const some = pass.min < pass.groups.length;
    const full = fullMeetingSql(meetings);
    const seen = Prisma.sql`(${full} OR ${inList(Prisma.sql`m.id`, invitee)})`;
    const editable = editableMeetingSql(meetings);
    const visible = Prisma.sql`(
      (si.kind IN ('project', 'inspection') AND p.deletedAt IS NULL AND ${inList(Prisma.sql`si.projectId`, projectIds)} AND ${live})
      OR (si.kind = 'file' AND ft.deletedAt IS NULL AND p.deletedAt IS NULL AND ${inList(Prisma.sql`ft.projectId`, projectIds)} AND ${live})
      OR (si.kind = 'meeting' AND m.deletedAt IS NULL AND ${seen})
      OR (si.kind = 'note' AND m.deletedAt IS NULL AND ${full})
      OR (si.kind = 'minutes' AND m.deletedAt IS NULL AND ((si.status = 'APPROVED' AND ${seen}) OR (si.status <> 'APPROVED' AND ${full} AND ${editable}))))`;
    const words = pass.min >= pass.groups.length ? allOf(txt, pass.groups) : Prisma.sql`${howMany(txt, pass.groups)} >= ${pass.min}`;
    const where: Prisma.Sql[] = [Prisma.sql`si.kind IN (${Prisma.join(wanted)})`, visible, words];
    if (input.only) {
      const others = input.only.filter((o) => o.kind !== 'task');
      if (others.length === 0) return null;
      where.push(Prisma.sql`(si.kind, si.recordId) IN (${Prisma.join(others.map((o) => Prisma.sql`(${o.kind}, ${o.id})`))})`);
    }
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
      ? Prisma.sql`(${allOf(Prisma.sql`si.head`, pass.groups)}) * 200 + ${howMany(Prisma.sql`si.head`, pass.groups)} * 20 + (${wordStarts(pass.groups)}) * 50
        + ${pass.phrase ? Prisma.sql`(si.head LIKE ${like(pass.phrase)} ESCAPE '!') * 100 + (${txt} LIKE ${like(pass.phrase)} ESCAPE '!') * 300` : Prisma.sql`0`}
        + (${allOf(Prisma.sql`COALESCE(si.lead, '')`, pass.groups)}) * ${leadWeight}
        + ${some ? Prisma.sql`${howMany(txt, pass.groups)} * 40` : Prisma.sql`0`} + ${kindWeight}
        + (NOT COALESCE(${done}, FALSE)) * 30 + COALESCE(${input.mine ? mineOf(input.mine, input.viewerId) : theirs(input.viewerId)}, FALSE) * 15 + ${recency(when)}`
      : Prisma.sql`0`;
    return Prisma.sql`SELECT si.kind AS kind, si.recordId AS id, ${score} AS score, ${when} AS at
      FROM search_index si
      LEFT JOIN tasks ft ON ft.id = si.taskId
      LEFT JOIN kanban_columns fc ON fc.id = ft.columnId
      LEFT JOIN meetings m ON m.id = si.meetingId
      LEFT JOIN projects p ON p.id = (CASE WHEN si.kind = 'file' THEN ft.projectId WHEN si.meetingId IS NOT NULL THEN m.projectId ELSE si.projectId END)
      WHERE ${Prisma.join(where, ' AND ')}`;
  }

  /**
   * The best `limit` from `offset`, best first: each half ordered and cut on its own (a sort that keeps
   * only the best few), then the two merged in the same order — one order across both indexes.
   */
  async function rows(pass: Pass, input: SearchAllInput, limit: number, offset: number): Promise<{ kind: SearchKind; id: string }[]> {
    const task = taskPart(pass, input, true);
    const other = indexPart(pass, input, true);
    if (!task && !other) return [];
    const need = offset + limit;
    type Row = { kind: SearchKind; id: string; score: unknown; at: Date | null };
    const best = (part: Prisma.Sql) => prisma.$queryRaw<Row[]>`SELECT kind, id, score, at FROM (${part}) x ORDER BY score DESC, at DESC, id DESC LIMIT ${need}`;
    const lists = await Promise.all([task ? tasksOf(input, best(task), [] as Row[]) : Promise.resolve([] as Row[]), other ? best(other) : Promise.resolve([] as Row[])]);
    const time = (d: Date | null) => (d ? new Date(d).getTime() : 0);
    return lists
      .flat()
      .map((r) => ({ ...r, score: Number(r.score) }))
      .sort((a, b) => b.score - a.score || time(b.at) - time(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(offset, need)
      .map(({ kind, id }) => ({ kind, id }));
  }

  /**
   * What a search reads once instead of for each row: the deleted and the archived projects (the same
   * rule, LIVE_PROJECT_SQL) and what is the person's own (their tasks, projects and meetings — for the
   * ranking's "own a little first"; a very busy person's is asked row by row instead).
   */
  async function withArchived(input: SearchAllInput): Promise<SearchAllInput> {
    if (input.deletedIds) return input;
    const MINE_CAP = 5000;
    const [projects, tasks, ownProjects, meetings] = await Promise.all([
      prisma.$queryRaw<{ id: string; deleted: number | bigint; live: number | bigint }[]>`SELECT p.id AS id, (p.deletedAt IS NOT NULL) AS deleted, ${LIVE_PROJECT_SQL} AS live FROM projects p WHERE p.deletedAt IS NOT NULL OR NOT ${LIVE_PROJECT_SQL}`,
      prisma.$queryRaw<{ id: string }[]>`SELECT taskId AS id FROM task_assignees WHERE userId = ${input.viewerId} LIMIT ${MINE_CAP + 1}`,
      prisma.$queryRaw<{ id: string }[]>`SELECT p.id AS id FROM projects p WHERE p.ownerId = ${input.viewerId} OR p.managerId = ${input.viewerId} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ${input.viewerId}) LIMIT ${MINE_CAP + 1}`,
      prisma.$queryRaw<{ id: string }[]>`SELECT m.id AS id FROM meetings m WHERE m.organizerId = ${input.viewerId} OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meetingId = m.id AND ma.userId = ${input.viewerId}) LIMIT ${MINE_CAP + 1}`,
    ]);
    const busy = tasks.length > MINE_CAP || ownProjects.length > MINE_CAP || meetings.length > MINE_CAP;
    return {
      ...input,
      deletedIds: projects.filter((p) => Number(p.deleted)).map((p) => p.id),
      ...(input.includeArchived ? {} : { archivedIds: projects.filter((p) => !Number(p.deleted) && !Number(p.live)).map((p) => p.id) }),
      ...(busy ? {} : { mine: { tasks: tasks.map((r) => r.id), projects: ownProjects.map((r) => r.id), meetings: meetings.map((r) => r.id) } }),
    };
  }

  async function counts(pass: Pass, input: SearchAllInput): Promise<Record<SearchKind, number>> {
    const out = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;
    const task = taskPart(pass, input, false);
    const other = indexPart(pass, input, false);
    // Each kind counted in full (review M1: one cap across kinds left some at 0), shown up to COUNT_CAP.
    type Count = { kind: string; n: bigint | number };
    const count = (part: Prisma.Sql) => prisma.$queryRaw<Count[]>`SELECT kind, COUNT(*) AS n FROM (${part}) x GROUP BY kind`;
    const results = await Promise.all([task ? tasksOf(input, count(task), [] as Count[]) : Promise.resolve([] as Count[]), other ? count(other) : Promise.resolve([] as Count[])]);
    for (const r of results.flat()) if ((SEARCH_KINDS as readonly string[]).includes(r.kind)) out[r.kind as SearchKind] = Math.min(Number(r.n), COUNT_CAP + 1);
    return out;
  }

  /** Results as they are now, in this order; each `accept`ed by the words found in it. */
  async function describe(found: { kind: SearchKind; id: string; match?: 'close' | 'some' }[], terms: string[], accept: (words: string[]) => boolean, input: SearchAllInput, byNumber?: (task: { key: string; formerKeys: string[] }) => string | null): Promise<SearchHit[]> {
    const taskIds = found.filter((f) => f.kind === 'task').map((f) => f.id);
    const others = found.filter((f): f is { kind: Exclude<SearchKind, 'task'>; id: string } => f.kind !== 'task');
    const [tasks, indexed] = await Promise.all([
      tasksOf(input, describeTaskHits(prisma, taskIds, terms, { timeZone, max: 2, ...(byNumber ? { byNumber } : {}), accept, onStale: (id) => onStale?.('task', id) }), []),
      describeIndexed(prisma, others, { terms, accept, invitee: new Set(input.scope.meetings.invitee), canSeeDraft: (m) => canSeeDraft(input.scope.meetings, m), timeZone, onStale: (kind, id) => onStale?.(kind, id) }),
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

  /** 1.23.1: with someone to tell, a failing task half leaves the other kinds, and the result says so. */
  async function search(given: SearchAllInput): Promise<SearchAllResult> {
    const tell = given.onTasksFailed;
    if (!tell) return searchEverything(given);
    let failed = false;
    const result = await searchEverything({
      ...given,
      onTasksFailed: (err) => {
        failed = true;
        tell(err);
      },
    });
    return failed ? { ...result, tasksUnavailable: true } : result;
  }

  async function searchEverything(given: SearchAllInput): Promise<SearchAllResult> {
    const { terms, whole } = parseTaskQuery(given.q);
    const input = terms.length ? await withArchived(given) : given;
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit)));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const empty: SearchAllResult = { hits: [], next: null, corrected: [], ...(input.withCounts ? { counts: Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>, total: 0, totalCapped: false } : {}) };
    if (terms.length === 0) return empty;
    const exact: Pass = { groups: terms.map((t) => [t]), min: terms.length, byNumber: numberSql(whole, input.q), phrase: terms.length > 1 ? whole : null };
    const byNumber = (task: { key: string; formerKeys: string[] }) => numberOf(task, whole, input.q);
    const all = (words: string[]) => words.length === terms.length;

    if (!input.extra) {
      const wantCounts = !input.exactOnly && (input.withCounts || offset === 0);
      // With a kind (or a task status) chosen, the type chips still count every kind: those counts
      // leave that choice out (every other filter holds); the total is of what is shown.
      const [page, counted, facets] = await Promise.all([
        rows(exact, input, limit + 1, offset),
        wantCounts ? counts(exact, input) : Promise.resolve(null),
        wantCounts && input.withCounts && narrowed(input) ? counts(exact, unnarrowed(input)) : Promise.resolve(null),
      ]);
      const total = counted ? Object.values(counted).reduce((a, b) => a + b, 0) : null;
      // Plenty hold every word (or this is a later page of them, or only whole matches are asked for): those, a page at a time.
      if (offset > 0 || total === null || total >= FEW || input.exactOnly) {
        const hits = await describe(page.slice(0, limit), terms, all, input, byNumber);
        return {
          hits,
          next: page.length > limit ? { offset: offset + limit, extra: false } : null,
          corrected: [],
          ...(input.withCounts && counted ? { counts: facets ?? counted, total: total!, totalCapped: Object.values(counted).some((n) => n > COUNT_CAP) } : {}),
        };
      }
      // Fewer than FEW hold every word: they are all in this first page already.
      return withExtras(input, exact, terms, limit, 0, byNumber, page.slice(0, FEW));
    }
    return withExtras(input, exact, terms, limit, offset, byNumber);
  }

  const narrowed = (input: SearchAllInput) => Boolean(input.kinds?.length || input.taskStatuses?.length);
  const unnarrowed = (input: SearchAllInput): SearchAllInput => ({ ...input, kinds: undefined, taskStatuses: undefined });

  /**
   * Few hold every word: those, then items found by corrected spellings, then items holding some of
   * the words — one list (each pass's best), paged in memory.
   */
  async function withExtras(
    input: SearchAllInput,
    exact: Pass,
    terms: string[],
    limit: number,
    offset: number,
    byNumber: (task: { key: string; formerKeys: string[] }) => string | null,
    exactRows?: { kind: SearchKind; id: string }[],
  ): Promise<SearchAllResult> {
    // Spelling mistakes: each word of 4 letters or more also as the indexed words it may be a mistake for.
    // Security review (1.23): all of a search's words share one deadline (the server has one thread).
    const alternatives = new Map<string, string[]>();
    const deadline = clock() + TYPO_BUDGET_MS;
    if (suggest) for (const t of terms.slice(0, 6)) if (allowedTypos(t) > 0) {
      const alts = (await suggest(t, { deadline })).filter((a) => a !== t);
      if (alts.length) alternatives.set(t, alts);
    }
    const closeGroups = terms.map((t) => [t, ...(alternatives.get(t) ?? [])]);
    /** The exact few, then the corrected spellings' results, then those with some of the words. */
    const buildList = async (from: SearchAllInput, known?: { kind: SearchKind; id: string }[]) => {
      const firstRows = known ?? (await rows(exact, from, FEW, 0));
      const seen = new Set(firstRows.map((r) => `${r.kind}:${r.id}`));
      const list: { kind: SearchKind; id: string; match?: 'close' | 'some' }[] = [...firstRows];
      const fresh = (r: { kind: SearchKind; id: string }) => !seen.has(`${r.kind}:${r.id}`) && (seen.add(`${r.kind}:${r.id}`), true);
      if (alternatives.size) {
        for (const r of await rows({ groups: closeGroups, min: terms.length, byNumber: null, phrase: null }, from, EXTRA, 0)) if (fresh(r)) list.push({ ...r, match: 'close' });
      }
      // Some of the words (two words or more): at least half of them — only while there are still few.
      if (terms.length > 1 && list.length < FEW) {
        for (const r of await rows({ groups: closeGroups, min: Math.ceil(terms.length / 2), byNumber: null, phrase: null }, from, EXTRA, 0)) if (fresh(r)) list.push({ ...r, match: 'some' });
      }
      return list;
    };
    const kindsOf = (items: { kind: SearchKind }[]) => {
      const c = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;
      for (const item of items) c[item.kind] += 1;
      return c;
    };
    /**
     * The type chips with a kind chosen: what the search would show with no kind chosen — every kind
     * holding every word, and (when few do) the extra passes' results too.
     */
    const facetsOf = async (): Promise<Record<SearchKind, number>> => {
      const all = unnarrowed(input);
      const exactCounts = await counts(exact, all);
      if (Object.values(exactCounts).reduce((a, b) => a + b, 0) >= FEW) return exactCounts;
      const extras = kindsOf((await buildList(all)).filter((i) => i.match));
      return Object.fromEntries(SEARCH_KINDS.map((k) => [k, exactCounts[k] + extras[k]])) as Record<SearchKind, number>;
    };
    const [list, facets] = await Promise.all([buildList(input, exactRows), input.withCounts && narrowed(input) ? facetsOf() : Promise.resolve(null)]);

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
    return {
      hits: checked,
      next: list.length > offset + limit ? { offset: offset + limit, extra: true } : null,
      corrected,
      ...(input.withCounts ? { counts: facets ?? kindsOf(list), total: list.length, totalCapped: false } : {}),
    };
  }

  /**
   * The AI panel's candidates: items holding any of these words (more of them first), or — `only`, no
   * words — just those items (meaning-search candidates); the person's scope and filters as always.
   */
  async function anyWords(given: SearchAllInput & { words: string[] }): Promise<SearchHit[]> {
    const groups = [...new Set(given.words.map(normalizeForSearch).filter(Boolean))].map((w) => [w]);
    if (groups.length === 0 && !given.only?.length) return [];
    const input = await withArchived(given);
    const found = await rows({ groups, min: groups.length ? 1 : 0, byNumber: null, phrase: null }, input, Math.max(1, Math.min(50, input.limit)), 0);
    return describe(found, groups.flat(), (words) => groups.length === 0 || words.length > 0, input);
  }

  return { search, anyWords, describe, rows, counts };
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
