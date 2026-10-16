/**
 * Repeating meetings. A series is its first meeting (holding the rule) plus a real meeting for
 * each later date, created about three months / 26 meetings ahead and topped up by a daily job.
 * Each meeting can be changed, cancelled or deleted on its own; these functions change "all
 * upcoming meetings in the series". Past meetings are never changed: a new schedule for a series
 * that has started splits it, so the meetings already held keep the old one.
 */
import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { zonedDayKey } from '../../lib/due-date';
import type { AttendeeRepository } from './attendee-repository';
import type { MeetingRecord, MeetingRepository, MeetingSeriesStore, RecurrenceRule, UpdateMeetingData } from './meeting-repository';
import type { MeetingChangeKind } from './meeting-service';
import { isValidTimeZone } from './meeting-validation';
import { alignToRule, horizonEnd, instantOf, seriesRule, seriesStarts, shiftRuleDays, SERIES_MAX_UPCOMING, untilBefore, wallOf } from './meeting-series';

export interface MeetingSeriesDeps {
  meetings: MeetingRepository & MeetingSeriesStore;
  attendees: Pick<AttendeeRepository, 'add' | 'listByMeeting' | 'markInvited'>;
  /** Company time zone, for meetings stored without one. */
  defaultTimeZone?: string;
  /** Fired for each meeting a series operation created, changed, cancelled or deleted. */
  onChanged?: (meeting: MeetingRecord, kind: MeetingChangeKind) => void | Promise<void>;
  now?: () => Date;
}

/** What a change to all upcoming meetings did. */
export interface SeriesChange {
  /** The meeting acted on, after the change (null when it was deleted). */
  meeting: MeetingRecord | null;
  /** The series' first meeting now (a new one when the change split the series). */
  rootId: string;
  /**
   * The series that ended because the change split it, and the meeting its calendar notice goes
   * from: its last meeting that took place, else its first meeting (even if deleted).
   */
  endedRootId?: string;
  endedMeeting?: MeetingRecord;
  /** Did the dates, times, length, zone or repeat change (calendars need the series again)? */
  scheduleChanged: boolean;
  /** Meetings changed, cancelled or deleted. */
  changed: MeetingRecord[];
  /** Meetings created to fill the new schedule. */
  created: MeetingRecord[];
  /** Does the series have meetings that already happened (still in its calendar)? */
  history: boolean;
}

const DETAIL_FIELDS = ['title', 'description', 'category', 'location', 'onlineLink', 'projectId', 'organizerId'] as const;
const OPEN = new Set(['DRAFT', 'SCHEDULED']);

const DAY_MS = 86_400_000;
const placeOf = (m: MeetingRecord) => m.recurrenceStart ?? m.startAt;
const durationOf = (m: MeetingRecord) => (m.endAt ? m.endAt.getTime() - m.startAt.getTime() : null);

/** A rule as compared for "did the schedule change" (the server-kept anchor day aside). */
function ruleKey(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return 'null';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rule).sort(([a], [b]) => a.localeCompare(b))) {
    if (k === 'anchorDay' || v === null || v === undefined || v === false) continue;
    out[k] = k === 'weekdays' ? [...(v as number[])].sort((a, b) => a - b) : v;
  }
  if (Array.isArray(out.weekdays) && out.weekdays.length === 0) delete out.weekdays;
  return JSON.stringify(out);
}

function withoutAnchor(rule: RecurrenceRule): RecurrenceRule {
  const copy = { ...rule };
  delete copy.anchorDay;
  return copy;
}

const isUniqueClash = (err: unknown) => (err as { code?: string } | null)?.code === 'P2002';

export function createMeetingSeriesService(deps: MeetingSeriesDeps) {
  const { meetings, attendees } = deps;
  const now = deps.now ?? (() => new Date());
  const fallbackZone = deps.defaultTimeZone && isValidTimeZone(deps.defaultTimeZone) ? deps.defaultTimeZone : 'UTC';
  const zoneOf = (m: Pick<MeetingRecord, 'timeZone'>) => (m.timeZone && isValidTimeZone(m.timeZone) ? m.timeZone : fallbackZone);
  const changed = async (list: MeetingRecord[], kind: MeetingChangeKind) => {
    for (const m of list) await deps.onChanged?.(m, kind);
  };

  /** The id of a meeting's series (its first meeting), or null for a one-off meeting. */
  function seriesIdOf(m: Pick<MeetingRecord, 'id' | 'recurrenceParentId' | 'recurrenceRule'>): string | null {
    return m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
  }

  async function load(id: string): Promise<MeetingRecord> {
    const m = await meetings.findById(id);
    if (!m) throw new NotFoundError('Meeting not found.');
    return m;
  }

  /** A meeting's series: its first meeting and every meeting of it (deleted ones flagged). */
  async function seriesOf(m: MeetingRecord) {
    const rootId = seriesIdOf(m);
    if (!rootId) throw new ValidationError('This meeting is not part of a series.');
    const root = await meetings.findAnyById(rootId);
    if (!root?.recurrenceRule) throw new ValidationError('This meeting is not part of a series.');
    const rows = await meetings.listSeries(rootId);
    const alive = rows.filter((r) => !r.deletedAt);
    const at = now().getTime();
    // Upcoming: not started yet, and not under way or held — cancelled ones keep their place.
    const upcoming = alive
      .filter((r) => r.startAt.getTime() >= at && (OPEN.has(r.status) || r.status === 'CANCELLED'))
      .sort((a, b) => placeOf(a).getTime() - placeOf(b).getTime());
    const inUpcoming = new Set(upcoming.map((r) => r.id));
    const history = alive.filter((r) => !inUpcoming.has(r.id));
    // Meetings deleted on their own that hadn't happened yet: gaps in the schedule.
    const deletedUpcoming = rows.filter((r) => r.deletedAt && placeOf(r).getTime() >= at);
    return { root, rows, alive, upcoming, history, deletedUpcoming };
  }

  /**
   * The meeting new ones are copied from: the latest one still going ahead on its own schedule,
   * else the latest going ahead, else the latest of all.
   */
  function templateOf(alive: MeetingRecord[], root: MeetingRecord): MeetingRecord {
    const byPlace = [...alive].sort((a, b) => placeOf(b).getTime() - placeOf(a).getTime());
    const live = byPlace.filter((r) => r.status !== 'CANCELLED');
    return live.find((r) => r.startAt.getTime() === placeOf(r).getTime()) ?? live[0] ?? byPlace[0] ?? root;
  }

  /** Create the series' meeting at `start`, copying the template's details and attendees. */
  async function createAt(rootId: string, template: MeetingRecord, start: Date, duration: number | null, timeZone: string): Promise<MeetingRecord | null> {
    let created: MeetingRecord;
    try {
      created = await meetings.create({
        title: template.title,
        description: template.description,
        category: template.category,
        status: template.status === 'DRAFT' ? 'DRAFT' : 'SCHEDULED',
        projectId: template.projectId,
        organizerId: template.organizerId,
        location: template.location,
        onlineLink: template.onlineLink,
        startAt: start,
        endAt: duration != null ? new Date(start.getTime() + duration) : null,
        timeZone,
        recurrenceParentId: rootId,
        recurrenceStart: start,
        templateId: template.templateId,
        // An invited series is in attendees' calendars already (the invitation carried the repeat).
        invitesSentAt: template.invitesSentAt,
        createdById: template.createdById,
      });
    } catch (err) {
      if (isUniqueClash(err)) return null; // another server instance created it a moment ago
      throw err;
    }
    for (const a of await attendees.listByMeeting(template.id)) {
      const copy = await attendees.add({
        meetingId: created.id,
        userId: a.userId,
        externalName: a.externalName,
        externalEmail: a.externalEmail,
        role: a.role,
        department: a.department,
      });
      if (a.invitedAt) await attendees.markInvited?.([copy.id], a.invitedAt);
    }
    return created;
  }

  /** Create the series' meetings that fall due by the horizon (never one it already had). */
  async function extend(rootId: string): Promise<MeetingRecord[]> {
    const root = await meetings.findAnyById(rootId);
    const rule = root?.recurrenceRule;
    if (!root || !rule || rule.paused || root.recurrenceParentId) return [];
    const rows = await meetings.listSeries(rootId);
    const alive = rows.filter((r) => !r.deletedAt);
    // A series from before this version (its first meeting has no place yet) that was cancelled or
    // deleted makes no meetings. A series of this version ends by its rule (cancelling or deleting
    // it sets the end date); a meeting cancelled on its own never stops it.
    if (!root.recurrenceStart) {
      if (!alive.some((r) => r.status !== 'CANCELLED')) return [];
      await meetings.update(root.id, { recurrenceStart: root.startAt });
    }
    const at = now();
    const room = SERIES_MAX_UPCOMING - alive.filter((r) => r.startAt.getTime() >= at.getTime()).length;
    if (room <= 0) return [];
    const last = Math.max(...rows.map((r) => placeOf(r).getTime()));
    const tz = zoneOf(root);
    // About three months ahead — of the series' start, for a series that starts later than that.
    const due = seriesStarts(placeOf(root), rule, tz, horizonEnd(new Date(Math.max(at.getTime(), placeOf(root).getTime()))))
      .filter((s) => s.getTime() > last && s.getTime() >= at.getTime())
      .slice(0, room);
    if (due.length === 0) return [];
    const template = templateOf(alive, root);
    const created: MeetingRecord[] = [];
    for (const start of due) {
      const m = await createAt(rootId, template, start, durationOf(template), tz);
      if (m) created.push(m);
    }
    await changed(created, 'created');
    return created;
  }

  /** Top every running series up (the daily job). One broken series never stops the rest. */
  async function extendAll(onError?: (err: unknown, rootId: string) => void): Promise<{ series: number; created: number }> {
    const roots = await meetings.listSeriesRoots();
    let created = 0;
    for (const root of roots) {
      try {
        created += (await extend(root.id)).length;
      } catch (err) {
        onError?.(err, root.id);
      }
    }
    return { series: roots.length, created };
  }

  /**
   * Make a meeting that now has a rule the first meeting of its series, and create the rest. The
   * first meeting is put on the repeat's first day when it falls outside the chosen days (a
   * Tuesday meeting set to "Mon and Wed" moves to Wednesday), so calendars and the app agree.
   */
  async function start(m: MeetingRecord): Promise<MeetingRecord[]> {
    if (!m.recurrenceRule || m.recurrenceParentId) return [];
    const tz = zoneOf(m);
    const first = alignToRule(m.startAt, withoutAnchor(m.recurrenceRule), tz);
    const patch: UpdateMeetingData = { recurrenceRule: seriesRule(withoutAnchor(m.recurrenceRule), first, tz), recurrenceStart: first };
    const moved = first.getTime() !== m.startAt.getTime();
    if (moved) {
      const duration = durationOf(m);
      Object.assign(patch, { startAt: first, endAt: duration != null ? new Date(first.getTime() + duration) : null });
    }
    await meetings.update(m.id, patch);
    if (moved) {
      if (m.reminderSentAt) await meetings.markReminderSent(m.id, null);
      await changed([await load(m.id)], 'updated');
    }
    return extend(m.id);
  }

  /** The details a series change copies to each upcoming meeting. */
  function detailsOf(patch: UpdateMeetingData): UpdateMeetingData {
    const out: UpdateMeetingData = {};
    for (const k of DETAIL_FIELDS) if (patch[k] !== undefined) (out as Record<string, unknown>)[k] = k === 'title' ? patch.title!.trim() : patch[k];
    // Draft / Scheduled is the series' state; "in progress" or "held" belongs to one meeting.
    if (patch.status && OPEN.has(patch.status)) out.status = patch.status;
    return out;
  }

  /** Change every upcoming meeting of `meetingId`'s series: details, time, length or repeat. */
  async function updateSeries(meetingId: string, patch: UpdateMeetingData): Promise<SeriesChange> {
    const m = await load(meetingId);
    if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError('A meeting title is required.');
    if (patch.status === 'CANCELLED') return cancelSeries(meetingId);
    const s = await seriesOf(m);
    const rootId = s.root.id;
    const details = detailsOf(patch);
    const oldZone = zoneOf(m);
    const tz = patch.timeZone && isValidTimeZone(patch.timeZone) ? patch.timeZone : oldZone;
    const newStart = patch.startAt ?? m.startAt;
    const newEnd = patch.endAt !== undefined ? patch.endAt : m.endAt;
    if (newEnd && newEnd < newStart) throw new ValidationError('The meeting cannot end before it starts.');
    const duration = newEnd ? newEnd.getTime() - newStart.getTime() : null;
    const oldRule = s.root.recurrenceRule!;
    const ruleChanged = patch.recurrenceRule !== undefined && ruleKey(patch.recurrenceRule) !== ruleKey(oldRule);
    const scheduleChanged = newStart.getTime() !== m.startAt.getTime() || duration !== durationOf(m) || tz !== oldZone || ruleChanged;
    const result: SeriesChange = { meeting: null, rootId, changed: [], created: [], history: s.history.length > 0, scheduleChanged };

    if (!scheduleChanged) {
      const targets = s.upcoming.filter((r) => r.status !== 'CANCELLED');
      if (!targets.some((r) => r.id === m.id)) targets.push(m);
      const updates = targets.map((r) => ({ id: r.id, patch: r.id === m.id && patch.status && !OPEN.has(patch.status) ? { ...details, status: patch.status } : details }));
      await meetings.applySeriesChanges(updates);
      result.changed = await Promise.all(targets.map((r) => load(r.id)));
      result.meeting = result.changed.find((r) => r.id === m.id) ?? null;
      await changed(result.changed, 'updated');
      return result;
    }

    if (!s.upcoming.some((r) => r.id === m.id)) throw new ValidationError('Only an upcoming meeting can change the series’ schedule.');

    // "Does not repeat": the series ends with this meeting.
    if (patch.recurrenceRule === null) {
      const later = s.upcoming.filter((r) => placeOf(r) > placeOf(m));
      const own: UpdateMeetingData = { ...details, startAt: newStart, endAt: newEnd, timeZone: tz };
      const changes: Array<{ id: string; patch: UpdateMeetingData }> = [];
      if (m.id === rootId && s.alive.length - later.length <= 1) Object.assign(own, { recurrenceRule: null, recurrenceStart: null });
      else changes.push({ id: rootId, patch: { recurrenceRule: { ...oldRule, count: null, until: zonedDayKey(placeOf(m), oldZone) } } });
      changes.push({ id: m.id, patch: own });
      await meetings.applySeriesChanges(changes, later.map((r) => r.id));
      result.meeting = await load(m.id);
      result.changed = [result.meeting, ...later];
      await changed([result.meeting], 'updated');
      await changed(later, 'deleted');
      return result;
    }

    // The day this meeting moved to: none when only its time changed; else counted from its place
    // in the series, so a meeting moved on its own before moves the series from its own day.
    const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / DAY_MS;
    const newDay = zonedDayKey(newStart, tz);
    const dayShift = newDay === zonedDayKey(m.startAt, oldZone) ? 0 : Math.round(dayNumber(newDay) - dayNumber(zonedDayKey(placeOf(m), oldZone)));
    const sameDays = !ruleChanged && dayShift === 0;
    // The new schedule's days: as given, or — when this meeting's day moved — the series' days moved
    // with it (a Tuesday series moved to Thursday repeats on Thursdays).
    let baseRule = withoutAnchor(ruleChanged ? patch.recurrenceRule! : oldRule);
    if (!ruleChanged && dayShift !== 0) baseRule = shiftRuleDays(baseRule, dayShift, wallOf(newStart, tz));
    const newWall = wallOf(newStart, tz);
    const at = now().getTime();
    const byPlace = (a: MeetingRecord, b: MeetingRecord) => placeOf(a).getTime() - placeOf(b).getTime();
    const deletedGaps = s.deletedUpcoming.filter((r) => r.id !== rootId);
    // A series split off at `first` counts only the meetings it has left.
    const countFrom = (r: RecurrenceRule, first: MeetingRecord): RecurrenceRule => {
      if (first.id === rootId || r.count == null) return r;
      const used = s.rows.filter((x) => placeOf(x) < placeOf(first)).length;
      return { ...r, count: Math.max(1, r.count - used) };
    };

    // Each meeting of the new schedule: its place in the series and when it now starts.
    let plan: Array<{ row: MeetingRecord; place: Date; start: Date }>;
    let removed: MeetingRecord[];
    let anchor: Date;
    let rule: RecurrenceRule;
    if (sameDays) {
      // The same days, a new time or length: every upcoming meeting keeps its day — a meeting
      // deleted or cancelled on its own included, so no meeting slides into another's date. The
      // edited meeting takes the date and time given; one whose new time has already passed keeps
      // its own and takes just the new length. A series that has started goes on from its first
      // meeting still to come: meetings deleted on their own before it have no place in it.
      const timed = (r: MeetingRecord) => {
        const day = wallOf(placeOf(r), oldZone);
        return instantOf(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), newWall.getUTCHours(), newWall.getUTCMinutes())), tz);
      };
      const all = [...s.upcoming, ...deletedGaps].sort(byPlace);
      const firstAlive = Math.max(0, all.findIndex((r) => !r.deletedAt));
      removed = all.slice(0, firstAlive);
      plan = all.slice(firstAlive).map((row) => {
        const place = timed(row);
        const start = row.id === m.id ? newStart : row.deletedAt || place.getTime() >= at ? place : row.startAt;
        return { row, place, start };
      });
      anchor = plan[0]!.place;
      rule = seriesRule(baseRule, anchor, tz);
    } else {
      // New days: meetings deleted or cancelled on their own are dropped, and the meetings left are
      // laid out afresh from the first upcoming one, moved like this one was: by the same number of
      // days, to this meeting's new time of day.
      const slots = s.upcoming.filter((r) => r.status !== 'CANCELLED').sort(byPlace);
      const first = slots[0];
      if (!first) throw new ValidationError('The series has no upcoming meeting to move.');
      const firstDay = wallOf(placeOf(first), oldZone);
      const anchorWall = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate() + dayShift, newWall.getUTCHours(), newWall.getUTCMinutes()));
      anchor = alignToRule(instantOf(anchorWall, tz), baseRule, tz);
      rule = seriesRule(baseRule, anchor, tz);
      // A meeting already held keeps its place: kept out of the new dates of the same series.
      const held = new Set(first.id !== rootId ? [] : s.history.map((r) => placeOf(r).getTime()));
      const starts = seriesStarts(anchor, countFrom(rule, first), tz, horizonEnd(new Date(Math.max(at, anchor.getTime()))))
        .filter((d) => d.getTime() >= at && !held.has(d.getTime()))
        .slice(0, SERIES_MAX_UPCOMING);
      // Checked before anything is written: a refused change leaves the series as it was.
      if (starts.length === 0) throw new ValidationError('The new repeat has no upcoming meetings.');
      plan = slots.slice(0, starts.length).map((row, i) => ({ row, place: starts[i]!, start: starts[i]! }));
      removed = [...slots.slice(starts.length), ...s.upcoming.filter((r) => r.status === 'CANCELLED'), ...deletedGaps];
    }
    const head = plan[0]!.row;
    const split = head.id !== rootId;
    rule = countFrom(rule, head);

    const newRootId = split ? head.id : rootId;
    const changes: Array<{ id: string; patch: UpdateMeetingData }> = [];
    if (split) changes.push({ id: rootId, patch: { recurrenceRule: { ...oldRule, count: null, until: untilBefore(placeOf(head), oldZone) } } });
    plan.forEach(({ row, place, start }, i) => {
      const p: UpdateMeetingData = {
        ...(row.status === 'CANCELLED' || row.deletedAt ? {} : details),
        startAt: start,
        endAt: duration != null ? new Date(start.getTime() + duration) : null,
        timeZone: tz,
        recurrenceStart: place,
      };
      if (i === 0) p.recurrenceRule = rule;
      if (split) p.recurrenceParentId = i === 0 ? null : newRootId;
      changes.push({ id: row.id, patch: p });
    });
    await meetings.applySeriesChanges(changes, removed.map((r) => r.id));
    for (const { row, start } of plan) {
      if (!row.deletedAt && row.reminderSentAt && start.getTime() !== row.startAt.getTime()) await meetings.markReminderSent(row.id, null);
    }

    result.changed = await Promise.all(plan.filter((p) => !p.row.deletedAt).map((p) => load(p.row.id)));
    // Then the dates after the last meeting kept, up to three months / 26 meetings ahead.
    const last = Math.max(...plan.map((p) => p.place.getTime()));
    const room = SERIES_MAX_UPCOMING - plan.filter((p) => !p.row.deletedAt && p.start.getTime() >= at).length;
    const more = seriesStarts(anchor, rule, tz, horizonEnd(new Date(Math.max(at, anchor.getTime()))))
      .filter((d) => d.getTime() > last && d.getTime() >= at)
      .slice(0, Math.max(0, room));
    const template = templateOf(result.changed, result.changed[0] ?? m);
    for (const start of more) {
      const created = await createAt(newRootId, template, start, duration, tz);
      if (created) result.created.push(created);
    }
    // The edited meeting — or, when the new schedule has no place for it, the series' next one.
    result.meeting = result.changed.find((r) => r.id === m.id) ?? result.changed.find((r) => r.status !== 'CANCELLED') ?? result.changed[0] ?? null;
    if (split) {
      result.endedRootId = rootId;
      result.endedMeeting = [...s.history].sort(byPlace).at(-1) ?? s.root;
      result.rootId = newRootId;
    }
    const removedAlive = removed.filter((r) => !r.deletedAt);
    await changed(result.changed, 'updated');
    await changed(result.created, 'created');
    await changed(removedAlive, 'deleted');
    result.changed.push(...removedAlive);
    return result;
  }

  /** End the series before its first upcoming meeting (or at its last one when none has happened). */
  async function endSeries(s: Awaited<ReturnType<typeof seriesOf>>) {
    const rule = s.root.recurrenceRule!;
    const tz = zoneOf(s.root);
    const first = s.upcoming[0];
    const last = [...s.rows].sort((a, b) => placeOf(b).getTime() - placeOf(a).getTime())[0]!;
    const until = s.history.length > 0 && first ? untilBefore(placeOf(first), tz) : zonedDayKey(placeOf(last), tz);
    await meetings.update(s.root.id, { recurrenceRule: { ...rule, count: null, until } });
  }

  /** Cancel every upcoming meeting of the series; no more are created. */
  async function cancelSeries(meetingId: string): Promise<SeriesChange> {
    const m = await load(meetingId);
    const s = await seriesOf(m);
    const targets = s.upcoming.filter((r) => r.status !== 'CANCELLED');
    await meetings.applySeriesChanges(targets.map((r) => ({ id: r.id, patch: { status: 'CANCELLED' } })));
    await endSeries(s);
    const done = await Promise.all(targets.map((r) => load(r.id)));
    await changed(done, 'cancelled');
    return { meeting: await meetings.findById(m.id), rootId: s.root.id, changed: done, created: [], history: s.history.length > 0, scheduleChanged: true };
  }

  /** Delete every upcoming meeting of the series; no more are created. */
  async function deleteSeries(meetingId: string): Promise<SeriesChange> {
    const m = await load(meetingId);
    const s = await seriesOf(m);
    await meetings.removeMany(s.upcoming.map((r) => r.id));
    await endSeries(s);
    await changed(s.upcoming, 'deleted');
    return { meeting: await meetings.findById(m.id), rootId: s.root.id, changed: s.upcoming, created: [], history: s.history.length > 0, scheduleChanged: true };
  }

  /**
   * The meetings that decide who may change a whole series: its first meeting, and the meetings
   * still to come (not cancelled) — once a series has started, changes reach only those.
   */
  async function seriesEditFacts(m: MeetingRecord): Promise<{ root: MeetingRecord; upcoming: MeetingRecord[] }> {
    const s = await seriesOf(m);
    return { root: s.root, upcoming: s.upcoming.filter((r) => r.status !== 'CANCELLED') };
  }

  /** A meeting's series as the apps show it: its first meeting's id, rule and zone (null for a one-off). */
  async function describe(m: MeetingRecord): Promise<{ id: string; rule: RecurrenceRule; timeZone: string } | null> {
    const rootId = seriesIdOf(m);
    if (!rootId) return null;
    const root = rootId === m.id ? m : await meetings.findAnyById(rootId);
    return root?.recurrenceRule ? { id: rootId, rule: root.recurrenceRule, timeZone: zoneOf(root) } : null;
  }

  /**
   * Upcoming meetings later in the series than this one (attendee changes carry on to them) —
   * none when this meeting has already started: correcting who came to it changes nothing ahead.
   */
  async function laterMeetings(meetingId: string): Promise<MeetingRecord[]> {
    const m = await load(meetingId);
    if (!seriesIdOf(m)) return [];
    const s = await seriesOf(m);
    if (!s.upcoming.some((r) => r.id === m.id)) return [];
    return s.upcoming.filter((r) => r.status !== 'CANCELLED' && placeOf(r) > placeOf(m));
  }

  return { seriesIdOf, seriesEditFacts, describe, start, extend, extendAll, updateSeries, cancelSeries, deleteSeries, laterMeetings };
}

export type MeetingSeriesService = ReturnType<typeof createMeetingSeriesService>;
