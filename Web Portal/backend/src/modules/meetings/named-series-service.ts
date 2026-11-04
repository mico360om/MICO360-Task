/**
 * 1.23 Meeting series: who sees which of a series' meetings, the meeting page's series line and
 * list, "Open from earlier meetings", the Series page, and the changes — make, rename, add, remove,
 * merge, delete — with their rules (named-series.ts holds the pure parts; ledger rulings R1–R14).
 *
 * Permissions are the meeting rules, never looser: a person sees a series' meetings they may open
 * (the full or the invitee view of each), and nothing — no title, date or count — of the others.
 */
import { ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { isOverdue } from '../../lib/due-date';
import type { ActionItemRecord, ActionItemStatus, Priority } from './action-item-repository';
import type { AgendaItemRecord } from './agenda-repository';
import type { AttendeeRecord } from './attendee-repository';
import type { MeetingAccessCore, MeetingRecord, MeetingRepository } from './meeting-repository';
import type { InviteTarget } from './meeting-invitees';
import {
  SERIES_NAME_MAX,
  inDateOrder,
  latestOf,
  placeOf,
  prefillLink,
  samePlace,
  seriesNav,
  type NamedSeriesRecord,
  type SeriesMeetingItem,
  type SeriesMeetingRow,
  type SeriesNav,
} from './named-series';
import type { NamedSeriesStore } from './named-series-store';

export interface SeriesViewer {
  id: string;
  roles: string[];
}

type View = 'full' | 'invitee';

export interface NamedSeriesDeps {
  store: NamedSeriesStore;
  /** The meeting store: the full record a pre-fill copies from. */
  meetings: Pick<MeetingRepository, 'findById'>;
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  canManageProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /**
   * companies (CompanyAccess.meetingView): how one of a meeting's own people (organizer, creator,
   * attendee) sees it — 'invitee' from another company, or null (no active company). Its answer for
   * such a person depends only on the meeting's project, so it is asked once per project. Absent:
   * they see it in full.
   */
  meetingView?: (viewer: SeriesViewer, m: MeetingAccessCore) => Promise<View | null>;
  userNames: (ids: string[]) => Promise<Map<string, string>>;
  taskKeys?: (taskIds: string[]) => Promise<Record<string, string>>;
  /** A person's current roles (the minutes are made for someone other than the person asking). */
  rolesOf?: (userId: string) => Promise<string[]>;
  /** The people and agenda "New meeting in this series" copies. */
  attendeesOf?: (meetingId: string) => Promise<AttendeeRecord[]>;
  agendaOf?: (meetingId: string) => Promise<Array<Pick<AgendaItemRecord, 'title' | 'ownerId' | 'expectedMinutes' | 'position'>>>;
  /** Who the invite picker offers for a meeting of this project (company): only they are copied. */
  inviteCandidates?: (viewer: SeriesViewer, target: InviteTarget) => Promise<Array<{ id: string; name: string }>>;
  /** These meetings' series changed (their live event). */
  onMeetingsChanged?: (meetingIds: string[]) => void;
  /** Company time zone: an action item is overdue once its due day is before today there. */
  timeZone?: string;
  now?: () => Date;
}

/** An open action item of an earlier meeting of the series — the same item, with the meeting it came from. */
export interface CarryOverItem {
  id: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: ActionItemStatus;
  priority: Priority;
  dueDate: Date | null;
  overdue: boolean;
  /** The board task it is tracked as (null in an invitee's view). */
  taskId: string | null;
  taskKey: string | null;
  createdById: string;
  meeting: { id: string; title: string; startAt: Date };
}

export interface SeriesSummary {
  id: string;
  name: string;
  projectId: string | null;
  companyId: string | null;
  auto: boolean;
}

/** A meeting's series as its page shows it. */
export interface MeetingSeriesContext extends SeriesNav {
  series: SeriesSummary;
  meetings: SeriesMeetingItem[];
  openFromEarlier: CarryOverItem[];
  /** May rename (and on the Series page delete or merge) the series. */
  canManage: boolean;
  /** May take this meeting (a repeat: its whole family) out of the series. */
  canRemove: boolean;
  /** This meeting repeats and its family is all the series holds: it can't leave (a repeat always has a series). */
  keepsRepeat: boolean;
  /** May add a meeting to the series ("New meeting in this series"). */
  canAdd: boolean;
}

export interface SeriesPage {
  series: SeriesSummary & { createdById: string };
  meetings: SeriesMeetingItem[];
  openActionItems: CarryOverItem[];
  canManage: boolean;
  /** May delete it: manages it, and it isn't just one repeat family. */
  canDelete: boolean;
  /** It holds one repeat family and nothing else (it can't be deleted). */
  keepsRepeat: boolean;
  /** May add meetings: a new one, or existing ones (the picker offers only theirs to add). */
  canAdd: boolean;
  /** The meetings this person may take out. */
  removable: string[];
  /** "Merge another series into this one": the other series of its project (company) this person manages. */
  mergeOptions: Array<{ id: string; name: string }>;
}

export interface SeriesOptions {
  /** May put this meeting in a series (or take it out). */
  canChange: boolean;
  /** It repeats: "add all its meetings?" (`familySize` of them). */
  repeats: boolean;
  familySize: number;
  /** The series it is in now. */
  current: { id: string; name: string; auto: boolean } | null;
  /** The series of its project (company) this person may see, other than its own. */
  series: Array<{ id: string; name: string }>;
}

export type PrefillPerson = { kind: 'user'; id: string; name: string } | { kind: 'guest'; email: string; name: string };

/** "New meeting in this series": the form's starting values (the person changes anything). */
export interface SeriesPrefill {
  seriesId: string;
  seriesName: string;
  title: string;
  projectId: string | null;
  companyId: string | null;
  location: string | null;
  onlineLink: string | null;
  /** The latest meeting's length (null: it had no end). */
  durationMinutes: number | null;
  description: string | null;
  people: PrefillPerson[];
  agendaItems: Array<{ title: string; ownerId: string | null; expectedMinutes: number | null }>;
}

/** The series facts the minutes print ("Series: …" and "Open from earlier meetings"). */
export interface MinutesSeries {
  name: string;
  openFromEarlier: CarryOverItem[];
}

const isAdmin = (roles: readonly string[]) => roles.includes('ADMIN');
const OPEN_STATUSES = new Set<ActionItemStatus>(['OPEN', 'IN_PROGRESS', 'PENDING']);

class SeriesConflict extends HttpError {
  constructor(message: string, code: string, details?: unknown) {
    super(message, code, 409, details);
  }
}

const WORDS = {
  notFound: 'Series not found.',
  meetingNotFound: 'Meeting not found.',
  name: 'Give the series a name (up to 200 characters).',
  place: 'Only meetings of the series’ project can be in it.',
  placeCompany: 'Only meetings of the series’ company (without a project) can be in it.',
  cannotChange: 'Only the meeting’s organizer, the project’s managers or an administrator can change which series it is in.',
  cannotManage: 'Only the person who made this series, the project’s managers or an administrator can change it.',
  repeats: (n: number) => `This meeting repeats — add all its ${n} meetings?`,
  keepsRepeat: 'A repeating meeting is always in a series, and this series holds only its meetings. You can rename the series instead.',
  inAnother: (name: string) => `This meeting is already in the series “${name}”. Remove it from there first.`,
  sameSeries: 'Choose another series to merge into this one.',
};

export function createNamedSeriesService(deps: NamedSeriesDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? 'UTC';
  const changed = (ids: string[]) => {
    if (ids.length) deps.onMeetingsChanged?.(ids);
  };

  /**
   * How this person sees each of these meetings (left out: not at all) — the meeting rule
   * (meeting-access.ts viewOf): an administrator everything; one of a meeting's own people as the
   * companies rule says; anyone else a project meeting of a project they can see, in full.
   */
  async function viewsOf(viewer: SeriesViewer, rows: readonly SeriesMeetingRow[]): Promise<Map<string, View>> {
    const out = new Map<string, View>();
    if (isAdmin(viewer.roles)) {
      for (const r of rows) out.set(r.id, 'full');
      return out;
    }
    const ownView = new Map<string, Promise<View | null>>();
    const projectSeen = new Map<string, Promise<boolean>>();
    for (const r of rows) {
      const own = r.organizerId === viewer.id || r.createdById === viewer.id || r.attendeeUserIds.includes(viewer.id);
      let view: View | null = null;
      if (own) {
        const key = r.projectId ?? '';
        if (!ownView.has(key)) {
          const core: MeetingAccessCore = { projectId: r.projectId, organizerId: r.organizerId, createdById: r.createdById, attendeeUserIds: r.attendeeUserIds };
          ownView.set(key, deps.meetingView ? deps.meetingView(viewer, core) : Promise.resolve('full'));
        }
        view = await ownView.get(key)!;
      } else if (r.projectId) {
        if (!projectSeen.has(r.projectId)) projectSeen.set(r.projectId, deps.canViewProject(viewer.id, viewer.roles, r.projectId));
        view = (await projectSeen.get(r.projectId)!) ? 'full' : null;
      }
      if (view) out.set(r.id, view);
    }
    return out;
  }

  async function viewOfOne(viewer: SeriesViewer, row: SeriesMeetingRow): Promise<View | null> {
    return (await viewsOf(viewer, [row])).get(row.id) ?? null;
  }

  /** The series as this person may see it: its meetings they may open, or 404 when it isn't theirs to see. */
  async function seen(viewer: SeriesViewer, seriesId: string) {
    const series = await store.find(seriesId);
    if (!series) throw new NotFoundError(WORDS.notFound);
    const rows = await store.meetingsOf(series.id);
    const views = await viewsOf(viewer, rows);
    const visible = rows.filter((r) => views.has(r.id));
    const ok =
      isAdmin(viewer.roles) ||
      visible.length > 0 ||
      (series.projectId ? await deps.canViewProject(viewer.id, viewer.roles, series.projectId) : series.createdById === viewer.id && rows.length === 0);
    if (!ok) throw new NotFoundError(WORDS.notFound);
    return { series, rows, views, visible };
  }

  /** May rename, delete or merge it (R1). */
  async function canManage(viewer: SeriesViewer, series: NamedSeriesRecord): Promise<boolean> {
    if (isAdmin(viewer.roles)) return true;
    if (!series.projectId) return series.createdById === viewer.id;
    if (await deps.canManageProject(viewer.id, viewer.roles, series.projectId)) return true;
    return series.createdById === viewer.id && (await deps.canViewProject(viewer.id, viewer.roles, series.projectId));
  }

  /** May put these meetings in a series of their place, or take them out (R2): each in full view, and theirs or managed. */
  async function mayMove(viewer: SeriesViewer, rows: readonly SeriesMeetingRow[], views?: Map<string, View>): Promise<boolean> {
    if (rows.length === 0) return false;
    if (isAdmin(viewer.roles)) return true;
    const seenAs = views ?? (await viewsOf(viewer, rows));
    if (rows.some((r) => seenAs.get(r.id) !== 'full')) return false;
    const managed = new Map<string, Promise<boolean>>();
    for (const r of rows) {
      if (r.organizerId === viewer.id) continue;
      if (!r.projectId) return false;
      if (!managed.has(r.projectId)) managed.set(r.projectId, deps.canManageProject(viewer.id, viewer.roles, r.projectId));
      if (!(await managed.get(r.projectId)!)) return false;
    }
    return true;
  }

  /** The meetings that move with this one: its repeat family in its place (R6), or itself. */
  async function unitOf(m: SeriesMeetingRow): Promise<SeriesMeetingRow[]> {
    if (!m.familyRootId) return [m];
    const family = (await store.family(m.familyRootId)).filter((r) => samePlace(r, m));
    return family.some((r) => r.id === m.id) ? family : [m, ...family];
  }

  const familyKey = (r: SeriesMeetingRow) => r.familyRootId;

  /** Does this series hold one repeat family and nothing else (R7)? */
  const onlyOneFamily = (rows: readonly SeriesMeetingRow[]) => rows.length > 0 && rows.every((r) => r.familyRootId && r.familyRootId === rows[0]!.familyRootId);

  /** An automatic series left empty goes (R9). */
  async function dropIfEmptyAuto(seriesIds: Iterable<string | null>): Promise<void> {
    for (const id of new Set([...seriesIds].filter((s): s is string => !!s))) {
      const s = await store.find(id);
      if (s?.auto && (await store.meetingsOf(id)).length === 0) await store.remove(id);
    }
  }

  /** A new automatic series for a repeat family, named after its earliest meeting. */
  async function ownSeriesFor(family: readonly SeriesMeetingRow[], createdById: string): Promise<NamedSeriesRecord> {
    const first = inDateOrder(family)[0]!;
    const place = placeOf(first);
    return store.create({ name: first.title.slice(0, SERIES_NAME_MAX), projectId: place.projectId, companyId: place.companyId, auto: true, createdById });
  }

  function cleanName(name: string): string {
    const n = name.trim();
    if (!n || n.length > SERIES_NAME_MAX) throw new ValidationError(WORDS.name, { field: 'name' });
    return n;
  }

  /** May add meetings to it: a new one ("New meeting in this series"), or existing ones of theirs. */
  async function canAddTo(viewer: SeriesViewer, series: NamedSeriesRecord, visible: readonly SeriesMeetingRow[], views: Map<string, View>): Promise<boolean> {
    if (isAdmin(viewer.roles)) return true;
    if (series.projectId) return deps.canViewProject(viewer.id, viewer.roles, series.projectId);
    return visible.some((r) => views.get(r.id) === 'full') || series.createdById === viewer.id;
  }

  const item = (r: SeriesMeetingRow, currentId?: string): SeriesMeetingItem => ({
    id: r.id, title: r.title, status: r.status, startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone, minutesFinal: r.minutesFinal, repeats: !!r.familyRootId,
    ...(currentId ? { current: r.id === currentId } : {}),
  });
  const summary = (s: NamedSeriesRecord): SeriesSummary => ({ id: s.id, name: s.name, projectId: s.projectId, companyId: s.companyId, auto: s.auto });

  /**
   * The open action items of these meetings, as this person may see them (R5): every item of a meeting
   * they see in full, their own of one they see as an invitee (without its task), none otherwise.
   */
  async function openItems(viewer: SeriesViewer, rows: readonly SeriesMeetingRow[], views: Map<string, View>, ownOnly = false): Promise<CarryOverItem[]> {
    const byId = new Map(rows.filter((r) => views.has(r.id)).map((r) => [r.id, r]));
    if (byId.size === 0) return [];
    const items = (await store.openActionItems([...byId.keys()])).filter((i) => {
      if (!i.meetingId || !byId.has(i.meetingId) || !OPEN_STATUSES.has(i.status)) return false;
      return views.get(i.meetingId) === 'full' && !ownOnly ? true : i.assigneeId === viewer.id;
    });
    const full = (i: ActionItemRecord) => views.get(i.meetingId!) === 'full';
    const names = await deps.userNames([...new Set(items.flatMap((i) => (i.assigneeId ? [i.assigneeId] : [])))]);
    const taskIds = [...new Set(items.filter(full).flatMap((i) => (i.taskId ? [i.taskId] : [])))];
    const keys = taskIds.length && deps.taskKeys ? await deps.taskKeys(taskIds) : {};
    const at = now();
    const out = items.map((i): CarryOverItem => {
      const m = byId.get(i.meetingId!)!;
      const task = full(i) && !ownOnly ? i.taskId : null;
      return {
        id: i.id, description: i.description, assigneeId: i.assigneeId, assigneeName: i.assigneeId ? names.get(i.assigneeId) ?? null : null,
        status: i.status, priority: i.priority, dueDate: i.dueDate, overdue: isOverdue(i.dueDate, timeZone, at),
        taskId: task, taskKey: (task && keys[task]) || null, createdById: i.createdById,
        meeting: { id: m.id, title: m.title, startAt: m.startAt },
      };
    });
    // Oldest meeting first; within one, soonest due first.
    return out.sort((a, b) => a.meeting.startAt.getTime() - b.meeting.startAt.getTime() || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id));
  }

  /** The meeting as this person sees it, or 404. */
  async function meetingFor(viewer: SeriesViewer, meetingId: string): Promise<{ row: SeriesMeetingRow; view: View }> {
    const row = await store.meeting(meetingId);
    const view = row ? await viewOfOne(viewer, row) : null;
    if (!row || !view) throw new NotFoundError(WORDS.meetingNotFound);
    return { row, view };
  }

  /** The meeting page: its series' name, the meetings this person may open, where it sits, and the carry-over. */
  async function context(viewer: SeriesViewer, meetingId: string): Promise<MeetingSeriesContext | null> {
    const { row } = await meetingFor(viewer, meetingId);
    if (!row.seriesId) return null;
    const series = await store.find(row.seriesId);
    if (!series) return null;
    const rows = await store.meetingsOf(series.id);
    const views = await viewsOf(viewer, rows);
    const visible = rows.filter((r) => views.has(r.id));
    if (!visible.some((r) => r.id === row.id)) visible.push(row);
    const earlier = visible.filter((r) => r.startAt.getTime() < row.startAt.getTime());
    const unit = await unitOf(row);
    const keepsRepeat = !!row.familyRootId && onlyOneFamily(rows);
    const full = views.get(row.id) === 'full';
    return {
      series: summary(series),
      meetings: inDateOrder(visible).map((r) => item(r, row.id)),
      ...seriesNav(visible, row.id),
      openFromEarlier: await openItems(viewer, earlier, views),
      canManage: full && (await canManage(viewer, series)),
      canRemove: !keepsRepeat && (await mayMove(viewer, unit.filter((r) => r.seriesId === series.id))),
      // Said only to someone who sees the whole series (it tells what the series holds).
      keepsRepeat: keepsRepeat && visible.length === rows.length,
      canAdd: full && (await canAddTo(viewer, series, visible, views)),
    };
  }

  /** The Series page. */
  async function page(viewer: SeriesViewer, seriesId: string): Promise<SeriesPage> {
    const { series, rows, views, visible } = await seen(viewer, seriesId);
    const manage = await canManage(viewer, series);
    // What the series holds is said only to someone who sees all of it (else the server answers a delete itself).
    const keepsRepeat = visible.length === rows.length && onlyOneFamily(rows);
    const removable: string[] = [];
    if (!keepsRepeat) {
      for (const r of visible) {
        // A repeat leaves with its whole family: every meeting of it must be theirs to move.
        const unit = r.familyRootId ? rows.filter((x) => x.familyRootId === r.familyRootId) : [r];
        if (await mayMove(viewer, unit, views)) removable.push(r.id);
      }
    }
    const canAdd = await canAddTo(viewer, series, visible, views);
    const mergeOptions: Array<{ id: string; name: string }> = [];
    if (manage) {
      for (const other of await visibleSeries(viewer, (await store.ofPlace(placeOf(series))).filter((s) => s.id !== series.id))) {
        if (await canManage(viewer, other)) mergeOptions.push({ id: other.id, name: other.name });
      }
    }
    return {
      series: { ...summary(series), createdById: series.createdById },
      meetings: inDateOrder(visible).map((r) => item(r)),
      openActionItems: await openItems(viewer, visible, views),
      canManage: manage,
      canDelete: manage && !keepsRepeat,
      keepsRepeat,
      canAdd,
      removable,
      mergeOptions,
    };
  }

  /** The series this person may see among these. */
  async function visibleSeries(viewer: SeriesViewer, list: NamedSeriesRecord[]): Promise<NamedSeriesRecord[]> {
    const out: NamedSeriesRecord[] = [];
    for (const s of list) {
      try {
        const { rows } = await seen(viewer, s.id);
        // An automatic series left empty (its repeats deleted) is no choice.
        if (!(s.auto && rows.length === 0)) out.push(s);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
    }
    return out;
  }

  /** "Add to a series" on a meeting: the series of its project (company) to choose from. */
  async function options(viewer: SeriesViewer, meetingId: string): Promise<SeriesOptions> {
    const { row, view } = await meetingFor(viewer, meetingId);
    const unit = await unitOf(row);
    const current = row.seriesId ? await store.find(row.seriesId) : null;
    const canChange = view === 'full' && (await mayMove(viewer, unit));
    const all = canChange ? await visibleSeries(viewer, (await store.ofPlace(placeOf(row))).filter((s) => s.id !== row.seriesId)) : [];
    return {
      canChange,
      repeats: !!row.familyRootId,
      // How many meetings the family has is said only to someone who may move it (who sees them all).
      familySize: canChange ? unit.length : 0,
      current: current ? { id: current.id, name: current.name, auto: current.auto } : null,
      series: all.map((s) => ({ id: s.id, name: s.name })),
    };
  }

  /**
   * The meetings joining a series with this one, checked: its repeat family when it repeats (asked
   * first: `wholeFamily`), none of them in another series unless that is their automatic one (R10).
   */
  async function joining(viewer: SeriesViewer, target: { id: string | null; projectId: string | null; companyId: string | null }, meetingId: string, wholeFamily: boolean) {
    const { row, view } = await meetingFor(viewer, meetingId);
    if (view !== 'full') throw new ForbiddenError(WORDS.cannotChange);
    if (!samePlace(row, target)) throw new ValidationError(target.projectId ? WORDS.place : WORDS.placeCompany);
    const unit = await unitOf(row);
    // The right to move them first: the question names how many meetings the family has.
    if (!(await mayMove(viewer, unit))) throw new ForbiddenError(WORDS.cannotChange);
    if (row.familyRootId && !wholeFamily) throw new SeriesConflict(WORDS.repeats(unit.length), 'SERIES_REPEATS', { count: unit.length });
    const from = new Set(unit.map((r) => r.seriesId).filter((s): s is string => !!s && s !== target.id));
    for (const id of from) {
      const s = await store.find(id);
      if (s && !(s.auto && row.familyRootId)) throw new SeriesConflict(WORDS.inAnother(s.name), 'IN_ANOTHER_SERIES');
    }
    return { unit, from };
  }

  /** "New series…": a series named by the person, with this meeting (and its repeat family). */
  async function create(viewer: SeriesViewer, input: { name: string; meetingId: string; wholeFamily?: boolean }): Promise<NamedSeriesRecord> {
    const name = cleanName(input.name);
    const { row } = await meetingFor(viewer, input.meetingId);
    const place = placeOf(row);
    const { unit, from } = await joining(viewer, { id: null, ...place }, row.id, !!input.wholeFamily);
    if (!(await mayMove(viewer, unit))) throw new ForbiddenError(WORDS.cannotChange);
    const series = await store.create({ name, projectId: place.projectId, companyId: place.companyId, auto: false, createdById: viewer.id });
    await store.link(unit.map((r) => r.id), series.id);
    await dropIfEmptyAuto(from);
    changed(unit.map((r) => r.id));
    return series;
  }

  async function rename(viewer: SeriesViewer, seriesId: string, name: string): Promise<NamedSeriesRecord> {
    const { series } = await seen(viewer, seriesId);
    if (!(await canManage(viewer, series))) throw new ForbiddenError(WORDS.cannotManage);
    const renamed = await store.rename(series.id, cleanName(name));
    changed((await store.meetingsOf(series.id)).map((r) => r.id));
    return renamed;
  }

  /** Add existing meetings (each with its repeat family, when it repeats). */
  async function addMeetings(viewer: SeriesViewer, seriesId: string, meetingIds: string[], opts: { wholeFamily?: boolean } = {}): Promise<void> {
    const { series } = await seen(viewer, seriesId);
    const moving = new Map<string, SeriesMeetingRow>();
    const from = new Set<string>();
    for (const id of new Set(meetingIds)) {
      const j = await joining(viewer, series, id, !!opts.wholeFamily);
      for (const r of j.unit) if (r.seriesId !== series.id) moving.set(r.id, r);
      for (const s of j.from) from.add(s);
    }
    if (moving.size === 0) return;
    if (!(await mayMove(viewer, [...moving.values()]))) throw new ForbiddenError(WORDS.cannotChange);
    await store.link([...moving.keys()], series.id);
    await dropIfEmptyAuto(from);
    changed([...moving.keys()]);
  }

  /** "Remove from series": a one-off leaves; a repeat leaves with its family, into a series of its own (R7). */
  async function removeMeeting(viewer: SeriesViewer, seriesId: string, meetingId: string): Promise<void> {
    const { series, rows } = await seen(viewer, seriesId);
    const row = rows.find((r) => r.id === meetingId);
    if (!row) throw new NotFoundError(WORDS.meetingNotFound);
    const unit = row.familyRootId ? rows.filter((r) => r.familyRootId === row.familyRootId) : [row];
    if (!(await mayMove(viewer, unit))) {
      // Not even theirs to see: as if it weren't there.
      if (!(await viewOfOne(viewer, row))) throw new NotFoundError(WORDS.meetingNotFound);
      throw new ForbiddenError(WORDS.cannotChange);
    }
    if (row.familyRootId) {
      if (onlyOneFamily(rows)) throw new SeriesConflict(WORDS.keepsRepeat, 'SERIES_KEEPS_REPEAT');
      const own = await ownSeriesFor(unit, viewer.id);
      await store.link(unit.map((r) => r.id), own.id);
    } else {
      await store.link([row.id], null);
    }
    await dropIfEmptyAuto([series.id]);
    changed(unit.map((r) => r.id));
  }

  /** Delete a series: its meetings stay — one-offs in none, each repeat family in a series of its own (R7). */
  async function remove(viewer: SeriesViewer, seriesId: string): Promise<void> {
    const { series, rows } = await seen(viewer, seriesId);
    if (!(await canManage(viewer, series))) throw new ForbiddenError(WORDS.cannotManage);
    if (onlyOneFamily(rows)) throw new SeriesConflict(WORDS.keepsRepeat, 'SERIES_KEEPS_REPEAT');
    const families = new Map<string, SeriesMeetingRow[]>();
    for (const r of rows) {
      const key = familyKey(r);
      if (key) families.set(key, [...(families.get(key) ?? []), r]);
    }
    for (const family of families.values()) {
      const own = await ownSeriesFor(family, viewer.id);
      await store.link(family.map((r) => r.id), own.id);
    }
    await store.remove(series.id);
    changed(rows.map((r) => r.id));
  }

  /** "Merge another series into this one" (same project or company): its meetings come here, and it goes. */
  async function merge(viewer: SeriesViewer, seriesId: string, otherId: string): Promise<void> {
    if (seriesId === otherId) throw new ValidationError(WORDS.sameSeries);
    const { series } = await seen(viewer, seriesId);
    const other = await seen(viewer, otherId);
    if (!samePlace(series, other.series)) throw new ValidationError(series.projectId ? WORDS.place : WORDS.placeCompany);
    if (!(await canManage(viewer, series)) || !(await canManage(viewer, other.series))) throw new ForbiddenError(WORDS.cannotManage);
    const ids = other.rows.map((r) => r.id);
    // Every meeting in it as it is now (one added meanwhile too), so none is left in no series.
    await store.moveAll(other.series.id, series.id);
    await store.remove(other.series.id);
    changed(ids);
  }

  /** "Add existing meetings": the place's one-offs in no series that this person may add (R12). */
  async function candidates(viewer: SeriesViewer, seriesId: string): Promise<SeriesMeetingItem[]> {
    const { series } = await seen(viewer, seriesId);
    const rows = await store.unseriedOfPlace(placeOf(series), 200);
    const views = await viewsOf(viewer, rows);
    const out: SeriesMeetingItem[] = [];
    for (const r of rows) if (await mayMove(viewer, [r], views)) out.push(item(r));
    return out;
  }

  /** "New meeting in this series": the form's starting values, from the latest meeting this person sees in full (R13). */
  async function prefill(viewer: SeriesViewer, seriesId: string): Promise<SeriesPrefill> {
    const { series, visible, views } = await seen(viewer, seriesId);
    const base: SeriesPrefill = {
      seriesId: series.id, seriesName: series.name, title: series.name, projectId: series.projectId, companyId: series.companyId,
      location: null, onlineLink: null, durationMinutes: null, description: null, people: [], agendaItems: [],
    };
    const latestRow = latestOf(visible.filter((r) => views.get(r.id) === 'full'));
    const latest = latestRow ? await deps.meetings.findById(latestRow.id) : null;
    if (!latest) return base;
    const offered = deps.inviteCandidates ? new Map((await deps.inviteCandidates(viewer, series.projectId ? { projectId: series.projectId } : { companyId: series.companyId })).map((p) => [p.id, p.name])) : null;
    const people: PrefillPerson[] = [];
    for (const a of deps.attendeesOf ? await deps.attendeesOf(latest.id) : []) {
      if (a.userId) {
        if (a.userId === viewer.id || !offered?.has(a.userId)) continue;
        people.push({ kind: 'user', id: a.userId, name: offered.get(a.userId)! });
      } else if (a.externalEmail) {
        people.push({ kind: 'guest', email: a.externalEmail, name: a.externalName || a.externalEmail.split('@')[0]! });
      }
    }
    const leads = new Set([viewer.id, ...people.flatMap((p) => (p.kind === 'user' ? [p.id] : []))]);
    const agenda = deps.agendaOf ? [...(await deps.agendaOf(latest.id))].sort((a, b) => a.position - b.position) : [];
    return {
      ...base,
      location: latest.location,
      ...prefillLink(latest),
      durationMinutes: latest.endAt ? Math.max(5, Math.round((latest.endAt.getTime() - latest.startAt.getTime()) / 60_000)) : null,
      people,
      agendaItems: agenda.map((g) => ({ title: g.title, ownerId: g.ownerId && leads.has(g.ownerId) ? g.ownerId : null, expectedMinutes: g.expectedMinutes })),
    };
  }

  /** A new meeting sent with a series ("New meeting in this series"): may it join? Returns the series' id. */
  async function checkJoin(viewer: SeriesViewer, seriesId: string, m: { projectId: string | null; companyId: string | null; organizerId: string }): Promise<string> {
    const { series } = await seen(viewer, seriesId);
    if (!samePlace(m, series)) throw new ValidationError(series.projectId ? WORDS.place : WORDS.placeCompany);
    const allowed =
      isAdmin(viewer.roles) || m.organizerId === viewer.id || (series.projectId ? await deps.canManageProject(viewer.id, viewer.roles, series.projectId) : false);
    if (!allowed) throw new ForbiddenError(WORDS.cannotChange);
    return series.id;
  }

  /**
   * A repeating meeting's series (a repeat is always in one): its own, else its family's in its place,
   * else a new automatic one named after the family's first meeting. Its family's meetings in no
   * series join it. Null for a meeting that doesn't repeat.
   */
  async function ensureFamilySeries(m: MeetingRecord): Promise<string | null> {
    const rootId = m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
    if (!rootId) return m.seriesId ?? null;
    const family = (await store.family(rootId)).filter((r) => samePlace(r, m));
    let seriesId = m.seriesId ?? null;
    if (!seriesId) {
      for (const r of family) {
        const s = r.seriesId ? await store.find(r.seriesId) : null;
        if (s && samePlace(s, m)) {
          seriesId = s.id;
          break;
        }
      }
    }
    if (!seriesId) {
      const place = placeOf(m);
      const name = (inDateOrder(family)[0]?.title ?? m.title).slice(0, SERIES_NAME_MAX);
      seriesId = (await store.create({ name, projectId: place.projectId, companyId: place.companyId, auto: true, createdById: m.createdById })).id;
    }
    const loose = family.filter((r) => !r.seriesId).map((r) => r.id);
    if (!m.seriesId && !loose.includes(m.id)) loose.push(m.id);
    if (loose.length) await store.link(loose, seriesId);
    return seriesId;
  }

  /**
   * After a meeting changed: moved to another project (company), it leaves its series (R8) — a one-off
   * into none, a repeat into the series there that holds its family's meetings, else a new automatic one.
   */
  async function followPlace(m: MeetingRecord): Promise<void> {
    if (m.deletedAt) return;
    if (!m.seriesId) {
      // A repeating meeting in no series (a paused repeat, or one made before 1.23): it gets one (R7).
      if (m.recurrenceParentId || m.recurrenceRule) await ensureFamilySeries(m);
      return;
    }
    const series = await store.find(m.seriesId);
    if (!series || samePlace(m, series)) return;
    const row = await store.meeting(m.id);
    if (!row) return;
    if (!row.familyRootId) {
      await store.link([m.id], null);
    } else {
      let target: string | null = null;
      for (const r of await store.family(row.familyRootId)) {
        if (r.id === m.id || !r.seriesId || !samePlace(r, m)) continue;
        const s = await store.find(r.seriesId);
        if (s && samePlace(s, m)) {
          target = s.id;
          break;
        }
      }
      target ??= (await ownSeriesFor([row], m.createdById)).id;
      await store.link([m.id], target);
    }
    await dropIfEmptyAuto([series.id]);
    changed([m.id]);
  }

  /** The minutes' series facts, as `who` sees them (`ownOnly`: an invitee's copy — only their own items). */
  async function minutesSeries(m: MeetingRecord, who: { userId: string; ownOnly?: boolean; alsoVisibleTo?: string }): Promise<MinutesSeries | null> {
    if (!m.seriesId) return null;
    const series = await store.find(m.seriesId);
    if (!series) return null;
    const earlier = (await store.meetingsOf(series.id)).filter((r) => r.id !== m.id && r.startAt.getTime() < m.startAt.getTime());
    const itemsFor = async (userId: string, ownOnly: boolean) => {
      const viewer = { id: userId, roles: deps.rolesOf ? await deps.rolesOf(userId) : [] };
      return openItems(viewer, earlier, await viewsOf(viewer, earlier), ownOnly);
    };
    let items = await itemsFor(who.userId, !!who.ownOnly);
    // The AI's draft (R15): the organizer's view, kept to the items the person asking may see too.
    if (who.alsoVisibleTo && who.alsoVisibleTo !== who.userId) {
      const theirs = new Set((await itemsFor(who.alsoVisibleTo, false)).map((i) => i.id));
      items = items.filter((i) => theirs.has(i.id));
    }
    return { name: series.name, openFromEarlier: items };
  }

  /** After a meeting was deleted: its automatic series, left empty, goes (R9). */
  async function afterDeleted(m: Pick<MeetingRecord, 'seriesId'>): Promise<void> {
    await dropIfEmptyAuto([m.seriesId ?? null]);
  }

  return {
    viewsOf,
    context,
    page,
    options,
    create,
    rename,
    addMeetings,
    removeMeeting,
    remove,
    merge,
    candidates,
    prefill,
    checkJoin,
    ensureFamilySeries,
    followPlace,
    afterDeleted,
    minutesSeries,
    names: (ids: string[]) => store.names(ids),
  };
}

export type NamedSeriesService = ReturnType<typeof createNamedSeriesService>;
