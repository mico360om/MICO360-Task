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
import { alignToRule, horizonEnd, instantOf, seriesRule, seriesStarts, SERIES_MAX_UPCOMING, untilBefore, wallOf } from './meeting-series';

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
  /** The series that ended because the change split it, and its last meeting that took place. */
  endedRootId?: string;
  endedMeeting?: MeetingRecord;
  /** Meetings changed, cancelled or deleted. */
  changed: MeetingRecord[];
  /** Meetings created to fill the new schedule. */
  created: MeetingRecord[];
  /** Does the series have meetings that already happened (still in its calendar)? */
  history: boolean;
}

const DETAIL_FIELDS = ['title', 'description', 'category', 'location', 'onlineLink', 'projectId', 'organizerId'] as const;
const OPEN = new Set(['DRAFT', 'SCHEDULED']);

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
    return { root, rows, alive, upcoming, history };
  }

  /** The meeting new ones are copied from: the latest one on its own schedule, else the latest. */
  function templateOf(alive: MeetingRecord[], root: MeetingRecord): MeetingRecord {
    const byPlace = [...alive].sort((a, b) => placeOf(b).getTime() - placeOf(a).getTime());
    return byPlace.find((r) => r.startAt.getTime() === placeOf(r).getTime()) ?? byPlace[0] ?? root;
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
    const at = now();
    const room = SERIES_MAX_UPCOMING - alive.filter((r) => r.startAt.getTime() >= at.getTime()).length;
    if (room <= 0) return [];
    const last = Math.max(...rows.map((r) => placeOf(r).getTime()));
    const tz = zoneOf(root);
    const due = seriesStarts(placeOf(root), rule, tz, horizonEnd(at))
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

  /** Make a meeting that now has a rule the first meeting of its series, and create the rest. */
  async function start(m: MeetingRecord): Promise<MeetingRecord[]> {
    if (!m.recurrenceRule || m.recurrenceParentId) return [];
    const rule = seriesRule(m.recurrenceRule, m.startAt, zoneOf(m));
    await meetings.update(m.id, { recurrenceRule: rule, recurrenceStart: m.startAt });
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
    const ruleGiven = patch.recurrenceRule !== undefined;
    const scheduleChanged =
      newStart.getTime() !== m.startAt.getTime() || duration !== durationOf(m) || tz !== oldZone || (ruleGiven && ruleKey(patch.recurrenceRule) !== ruleKey(oldRule));
    const result: SeriesChange = { meeting: null, rootId, changed: [], created: [], history: s.history.length > 0 };

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
      await meetings.removeMany(later.map((r) => r.id), { detach: true });
      const own: UpdateMeetingData = { ...details, startAt: newStart, endAt: newEnd, timeZone: tz };
      if (m.id === rootId && s.alive.length - later.length <= 1) Object.assign(own, { recurrenceRule: null, recurrenceStart: null });
      else await meetings.update(rootId, { recurrenceRule: { ...oldRule, count: null, until: zonedDayKey(placeOf(m), oldZone) } });
      await meetings.applySeriesChanges([{ id: m.id, patch: own }]);
      result.meeting = await load(m.id);
      result.changed = [result.meeting, ...later];
      await changed([result.meeting], 'updated');
      await changed(later, 'deleted');
      return result;
    }

    // The new schedule starts at the first upcoming meeting, moved like this one was: by the same
    // number of days, to this meeting's new time of day.
    const first = s.upcoming[0]!;
    const dayShift = Math.round((Date.parse(`${zonedDayKey(newStart, tz)}T00:00:00Z`) - Date.parse(`${zonedDayKey(m.startAt, oldZone)}T00:00:00Z`)) / 86_400_000);
    const firstDay = wallOf(placeOf(first), oldZone);
    const newWall = wallOf(newStart, tz);
    const anchorWall = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate() + dayShift, newWall.getUTCHours(), newWall.getUTCMinutes()));
    const baseRule = withoutAnchor(ruleGiven ? patch.recurrenceRule! : oldRule);
    const anchor = alignToRule(instantOf(anchorWall, tz), baseRule, tz);
    const split = first.id !== rootId;
    let rule = seriesRule(baseRule, anchor, tz);
    if (split && rule.count != null) {
      const used = s.rows.filter((r) => placeOf(r) < placeOf(first)).length;
      rule = { ...rule, count: Math.max(1, rule.count - used) };
    }
    const at = now().getTime();
    const starts = seriesStarts(anchor, rule, tz, horizonEnd(now()))
      .filter((d) => d.getTime() >= at)
      .slice(0, SERIES_MAX_UPCOMING);
    const newRootId = split ? first.id : rootId;
    if (split) {
      result.endedRootId = rootId;
      result.endedMeeting = [...s.history].sort((a, b) => placeOf(b).getTime() - placeOf(a).getTime())[0];
      result.rootId = newRootId;
      await meetings.update(rootId, { recurrenceRule: { ...oldRule, count: null, until: untilBefore(placeOf(first), oldZone) } });
    }
    if (starts.length === 0) throw new ValidationError('The new repeat has no upcoming meetings.');

    const updates: Array<{ id: string; patch: UpdateMeetingData }> = [];
    const paired = s.upcoming.slice(0, starts.length);
    paired.forEach((r, i) => {
      const at = starts[i]!;
      const p: UpdateMeetingData = {
        ...(r.status === 'CANCELLED' ? {} : details),
        startAt: at,
        endAt: duration != null ? new Date(at.getTime() + duration) : null,
        timeZone: tz,
        recurrenceStart: at,
      };
      if (i === 0) p.recurrenceRule = rule;
      if (split) p.recurrenceParentId = i === 0 ? null : newRootId;
      updates.push({ id: r.id, patch: p });
    });
    await meetings.applySeriesChanges(updates);
    for (const r of paired) {
      const moved = updates.find((u) => u.id === r.id)!.patch.startAt!;
      if (r.reminderSentAt && moved.getTime() !== r.startAt.getTime()) await meetings.markReminderSent(r.id, null);
    }
    const leftovers = s.upcoming.slice(starts.length);
    await meetings.removeMany(leftovers.map((r) => r.id), { detach: true });

    result.changed = await Promise.all(paired.map((r) => load(r.id)));
    const template = templateOf(result.changed, result.changed[0]!);
    for (const at of starts.slice(paired.length)) {
      const created = await createAt(newRootId, template, at, duration, tz);
      if (created) result.created.push(created);
    }
    result.meeting = result.changed.find((r) => r.id === m.id) ?? null;
    await changed(result.changed, 'updated');
    await changed(result.created, 'created');
    await changed(leftovers, 'deleted');
    result.changed.push(...leftovers);
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
    return { meeting: await meetings.findById(m.id), rootId: s.root.id, changed: done, created: [], history: s.history.length > 0 };
  }

  /** Delete every upcoming meeting of the series; no more are created. */
  async function deleteSeries(meetingId: string): Promise<SeriesChange> {
    const m = await load(meetingId);
    const s = await seriesOf(m);
    await meetings.removeMany(s.upcoming.map((r) => r.id));
    await endSeries(s);
    await changed(s.upcoming, 'deleted');
    return { meeting: await meetings.findById(m.id), rootId: s.root.id, changed: s.upcoming, created: [], history: s.history.length > 0 };
  }

  /** A meeting's series as the apps show it: its first meeting's id, rule and zone (null for a one-off). */
  async function describe(m: MeetingRecord): Promise<{ id: string; rule: RecurrenceRule; timeZone: string } | null> {
    const rootId = seriesIdOf(m);
    if (!rootId) return null;
    const root = rootId === m.id ? m : await meetings.findAnyById(rootId);
    return root?.recurrenceRule ? { id: rootId, rule: root.recurrenceRule, timeZone: zoneOf(root) } : null;
  }

  /** Upcoming meetings later in the series than this one (attendee changes carry on to them). */
  async function laterMeetings(meetingId: string): Promise<MeetingRecord[]> {
    const m = await load(meetingId);
    if (!seriesIdOf(m)) return [];
    const s = await seriesOf(m);
    return s.upcoming.filter((r) => r.status !== 'CANCELLED' && placeOf(r) > placeOf(m));
  }

  return { seriesIdOf, describe, start, extend, extendAll, updateSeries, cancelSeries, deleteSeries, laterMeetings };
}

export type MeetingSeriesService = ReturnType<typeof createMeetingSeriesService>;
