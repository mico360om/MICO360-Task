import { describe, it, expect } from 'vitest';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import { memoryNamedSeries } from './named-series-memory.fixture';
import { createNamedSeriesService } from './named-series-service';
import type { ActionItemRecord } from './action-item-repository';
import type { CreateMeetingData } from './meeting-repository';

/**
 * The world: project p1 (team: mgr manages it, ana and ben are members), project p2 (team: cara).
 * dan is in the company but not on p1's team; xena is from another company (an invitee on p1).
 * ceo is an administrator.
 */
const TEAM: Record<string, string[]> = { p1: ['mgr', 'ana', 'ben'], p2: ['cara', 'mgr'] };
const MANAGERS: Record<string, string[]> = { p1: ['mgr'], p2: ['cara'] };
const OTHER_COMPANY = new Set(['xena']);
const NOW = new Date('2026-11-20T08:00:00Z');
const day = (d: number, h = 6) => new Date(Date.UTC(2026, 10, d, h));

function setup() {
  const meetings = memoryMeetings();
  const attendees = memoryAttendees();
  const store = memoryNamedSeries(meetings, attendees);
  const changed: string[][] = [];
  const service = createNamedSeriesService({
    store,
    meetings,
    canViewProject: async (u, roles, p) => roles.includes('ADMIN') || (TEAM[p] ?? []).includes(u),
    canManageProject: async (u, roles, p) => roles.includes('ADMIN') || (MANAGERS[p] ?? []).includes(u),
    // companies: someone of another company sees a project meeting they are on as an invitee.
    meetingView: async (viewer, m) => {
      const own = m.organizerId === viewer.id || m.createdById === viewer.id || m.attendeeUserIds.includes(viewer.id);
      if (!own) return null;
      return m.projectId && OTHER_COMPANY.has(viewer.id) ? 'invitee' : 'full';
    },
    userNames: async (ids) => new Map(ids.map((id) => [id, id.toUpperCase()])),
    // 1.23 integration (the 1.22.3 number rule): t-hr's task is in a project only mgr (and an administrator) may open.
    taskKeys: async (ids, viewer) => Object.fromEntries(ids.filter((id) => id !== 't-hr' || viewer.id === 'mgr' || viewer.roles.includes('ADMIN')).map((id) => [id, `KEY-${id}`])),
    rolesOf: async (id) => (id === 'ceo' ? ['ADMIN'] : ['EMPLOYEE']),
    attendeesOf: (id) => attendees.listByMeeting(id),
    agendaOf: async (id) => agenda.filter((g) => g.meetingId === id),
    inviteCandidates: async (_viewer, target) => ('projectId' in target && target.projectId === 'p1' ? ['mgr', 'ana', 'ben', 'dan'] : ['cara']).map((id) => ({ id, name: id.toUpperCase() })),
    onMeetingsChanged: (ids) => changed.push(ids),
    timeZone: 'Asia/Muscat',
    now: () => NOW,
  });
  const agenda: Array<{ meetingId: string; title: string; ownerId: string | null; expectedMinutes: number | null; position: number }> = [];
  const as = (id: string) => ({ id, roles: id === 'ceo' ? ['ADMIN'] : ['EMPLOYEE'] });
  async function meeting(title: string, d: number, extra: Partial<CreateMeetingData> & { people?: string[] } = {}) {
    const { people = [], ...rest } = extra;
    const m = await meetings.create({ title, startAt: day(d), endAt: day(d, 7), status: 'SCHEDULED', projectId: 'p1', organizerId: 'mgr', createdById: 'mgr', ...rest });
    for (const userId of people) await attendees.add({ meetingId: m.id, userId });
    return m;
  }
  async function family(title: string, days: number[], extra: Partial<CreateMeetingData> = {}) {
    const root = await meeting(title, days[0]!, { recurrenceRule: { freq: 'WEEKLY', interval: 1 }, recurrenceStart: day(days[0]!), ...extra });
    const rest = [];
    for (const d of days.slice(1)) rest.push(await meeting(title, d, { recurrenceParentId: root.id, recurrenceStart: day(d), ...extra }));
    return [root, ...rest];
  }
  let itemSeq = 0;
  function item(meetingId: string, description: string, extra: Partial<ActionItemRecord> = {}): ActionItemRecord {
    const rec: ActionItemRecord = {
      id: `ai${++itemSeq}`, meetingId, agendaItemId: null, sourceNoteId: null, projectId: 'p1', description, assigneeId: null, priority: 'NORMAL',
      status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'mgr', createdAt: NOW, updatedAt: NOW, ...extra,
    };
    store.actionItems.push(rec);
    return rec;
  }
  /** A hand-made series of these meetings (as "New series…" and "Add existing" would make it). */
  async function series(name: string, ids: string[], extra: { projectId?: string | null; companyId?: string | null; createdById?: string } = {}) {
    const s = await store.create({ name, projectId: extra.projectId === undefined ? 'p1' : extra.projectId, companyId: extra.companyId ?? null, auto: false, createdById: extra.createdById ?? 'mgr' });
    await store.link(ids, s.id);
    return s;
  }
  return { meetings, attendees, store, service, changed, agenda, as, meeting, family, item, series };
}

const seriesIdOf = async (t: ReturnType<typeof setup>, id: string) => (await t.meetings.findById(id))?.seriesId ?? null;

describe('what a person sees of a series on a meeting', () => {
  it('a project member sees every meeting, in date order, with "n of N", Previous and Next', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3);
    const b = await t.meeting('Monthly 2', 10);
    const c = await t.meeting('Monthly 3', 17);
    await t.series('Monthly OXY review', [c.id, a.id, b.id]);
    const ctx = (await t.service.context(t.as('ana'), b.id))!;
    expect(ctx.series.name).toBe('Monthly OXY review');
    expect(ctx.meetings.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
    expect(ctx.meetings.find((m) => m.current)?.id).toBe(b.id);
    expect(ctx).toMatchObject({ position: 2, total: 3, previous: { id: a.id }, next: { id: c.id } });
  });

  it('someone on only some meetings sees only those: the counts and the neighbours skip the rest (no leak)', async () => {
    const t = setup();
    const a = await t.meeting('Secret 1', 3);
    const b = await t.meeting('Dan is here', 10, { people: ['dan'] });
    const c = await t.meeting('Secret 3', 17);
    const d = await t.meeting('Dan again', 24, { people: ['dan'] });
    await t.series('Board', [a.id, b.id, c.id, d.id]);
    const ctx = (await t.service.context(t.as('dan'), d.id))!;
    expect(ctx.meetings.map((m) => m.id)).toEqual([b.id, d.id]);
    expect(ctx).toMatchObject({ position: 2, total: 2, previous: { id: b.id, title: 'Dan is here' }, next: null });
    expect(JSON.stringify(ctx)).not.toContain('Secret');
  });

  it('someone who can see one meeting only gets the series name — no count, no links', async () => {
    const t = setup();
    const a = await t.meeting('Hidden', 3);
    const b = await t.meeting('Only this', 10, { people: ['dan'] });
    await t.series('Board', [a.id, b.id]);
    const ctx = (await t.service.context(t.as('dan'), b.id))!;
    expect(ctx.series.name).toBe('Board');
    expect(ctx.meetings.map((m) => m.id)).toEqual([b.id]);
    expect(ctx).toMatchObject({ position: null, previous: null, next: null });
    expect(ctx.openFromEarlier).toEqual([]);
  });

  it('someone who can’t open the meeting gets nothing (404)', async () => {
    const t = setup();
    const a = await t.meeting('Monthly', 3);
    await t.series('Board', [a.id]);
    await expect(t.service.context(t.as('cara'), a.id)).rejects.toMatchObject({ status: 404 });
  });

  it('a meeting in no series has no series', async () => {
    const t = setup();
    const a = await t.meeting('Alone', 3);
    expect(await t.service.context(t.as('ana'), a.id)).toBeNull();
  });

  it('an administrator sees everything', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 10);
    await t.series('Board', [a.id, b.id]);
    expect((await t.service.context(t.as('ceo'), b.id))!.meetings).toHaveLength(2);
  });

  it('cancelled meetings are listed but skipped by the count and the neighbours', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 10, { status: 'CANCELLED' });
    const c = await t.meeting('Three', 17);
    await t.series('Board', [a.id, b.id, c.id]);
    const ctx = (await t.service.context(t.as('ana'), c.id))!;
    expect(ctx.meetings).toHaveLength(3);
    expect(ctx).toMatchObject({ position: 2, total: 2, previous: { id: a.id } });
  });
});

describe('Open from earlier meetings (carry-over)', () => {
  it('lists the open action items of earlier meetings of the series — the same items, with their meeting', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3);
    const b = await t.meeting('Monthly 2', 10);
    const c = await t.meeting('Monthly 3', 17);
    await t.series('Board', [a.id, b.id, c.id]);
    const open = t.item(a.id, 'Send the drawings', { assigneeId: 'ana', dueDate: new Date('2026-11-05T00:00:00Z'), taskId: 't1' });
    t.item(a.id, 'Done already', { status: 'COMPLETED' });
    t.item(a.id, 'Dropped', { status: 'CANCELLED' });
    const going = t.item(b.id, 'Book the crane', { status: 'IN_PROGRESS' });
    const pending = t.item(b.id, 'Waiting on the client', { status: 'PENDING' });
    t.item(c.id, 'From this meeting itself');
    const ctx = (await t.service.context(t.as('ana'), c.id))!;
    expect(ctx.openFromEarlier.map((i) => i.id).sort()).toEqual([open.id, going.id, pending.id].sort());
    const first = ctx.openFromEarlier.find((i) => i.id === open.id)!;
    expect(first).toMatchObject({ description: 'Send the drawings', assigneeName: 'ANA', status: 'OPEN', taskKey: 'KEY-t1', meeting: { id: a.id, title: 'Monthly 1' }, overdue: true });
    // The first meeting has nothing earlier.
    expect((await t.service.context(t.as('ana'), a.id))!.openFromEarlier).toEqual([]);
  });

  it('1.23 integration: names a linked task’s number only for someone who may open that task (the 1.22.3 rule)', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3);
    const b = await t.meeting('Monthly 2', 10);
    const s = await t.series('Board', [a.id, b.id]);
    // Its task was moved to a project ana and ben aren't on: the item still says it has a task, not its number.
    const moved = t.item(a.id, 'Hire the scaffold', { taskId: 't-hr' });
    const asAna = (await t.service.context(t.as('ana'), b.id))!.openFromEarlier.find((i) => i.id === moved.id)!;
    expect(asAna).toMatchObject({ taskId: 't-hr', taskKey: null });
    const asMgr = (await t.service.context(t.as('mgr'), b.id))!.openFromEarlier.find((i) => i.id === moved.id)!;
    expect(asMgr).toMatchObject({ taskId: 't-hr', taskKey: 'KEY-t-hr' });
    // The Series page's open items and the minutes follow the same rule.
    expect((await t.service.page(t.as('ben'), s.id)).openActionItems.find((i) => i.id === moved.id)).toMatchObject({ taskKey: null });
    expect((await t.service.page(t.as('ceo'), s.id)).openActionItems.find((i) => i.id === moved.id)).toMatchObject({ taskKey: 'KEY-t-hr' });
  });

  it('shows only items of earlier meetings the person may open', async () => {
    const t = setup();
    const a = await t.meeting('Hidden', 3);
    const b = await t.meeting('Dan is here', 10, { people: ['dan'] });
    const c = await t.meeting('Now', 17, { people: ['dan'] });
    await t.series('Board', [a.id, b.id, c.id]);
    t.item(a.id, 'Hidden item', { assigneeId: 'dan' });
    const seen = t.item(b.id, 'Seen item');
    const ctx = (await t.service.context(t.as('dan'), c.id))!;
    expect(ctx.openFromEarlier.map((i) => i.id)).toEqual([seen.id]);
  });

  it('an invitee from another company sees only their own items, without the project’s tasks', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { people: ['xena'] });
    const b = await t.meeting('Monthly 2', 10, { people: ['xena'] });
    await t.series('Board', [a.id, b.id]);
    const mine = t.item(a.id, 'Xena’s item', { assigneeId: 'xena', taskId: 't9' });
    t.item(a.id, 'Someone else’s', { assigneeId: 'ana' });
    const ctx = (await t.service.context(t.as('xena'), b.id))!;
    expect(ctx.openFromEarlier.map((i) => i.id)).toEqual([mine.id]);
    expect(ctx.openFromEarlier[0]).toMatchObject({ taskId: null, taskKey: null });
    expect(ctx.canManage).toBe(false);
    expect(ctx.canRemove).toBe(false);
  });

  it('gives the minutes the items as one person sees them, or only their own', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { people: ['xena'] });
    const b = await t.meeting('Monthly 2', 10, { people: ['xena'] });
    await t.series('Board', [a.id, b.id]);
    t.item(a.id, 'Xena’s item', { assigneeId: 'xena' });
    t.item(a.id, 'Ana’s item', { assigneeId: 'ana' });
    const record = (await t.meetings.findById(b.id))!;
    const team = (await t.service.minutesSeries(record, { userId: 'mgr' }))!;
    expect(team.name).toBe('Board');
    expect(team.openFromEarlier.map((i) => i.description).sort()).toEqual(['Ana’s item', 'Xena’s item']);
    const own = (await t.service.minutesSeries(record, { userId: 'xena', ownOnly: true }))!;
    expect(own.openFromEarlier.map((i) => i.description)).toEqual(['Xena’s item']);
    const lone = await t.meeting('Alone', 12);
    expect(await t.service.minutesSeries((await t.meetings.findById(lone.id))!, { userId: 'mgr' })).toBeNull();
  });
});

describe('making a series and adding meetings', () => {
  it('the organizer makes a series from their meeting ("New series…")', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { organizerId: 'ana' });
    const s = await t.service.create(t.as('ana'), { name: '  Monthly OXY review ', meetingId: a.id });
    expect(s).toMatchObject({ name: 'Monthly OXY review', projectId: 'p1', companyId: null, auto: false, createdById: 'ana' });
    expect(await seriesIdOf(t, a.id)).toBe(s.id);
    expect(t.changed.flat()).toContain(a.id);
  });

  it('someone else on the team may not, a manager may', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { organizerId: 'ana', createdById: 'ana' });
    await expect(t.service.create(t.as('ben'), { name: 'X', meetingId: a.id })).rejects.toMatchObject({ status: 403 });
    await expect(t.service.create(t.as('mgr'), { name: 'X', meetingId: a.id })).resolves.toMatchObject({ name: 'X' });
  });

  it('needs a name', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3);
    await expect(t.service.create(t.as('mgr'), { name: '   ', meetingId: a.id })).rejects.toMatchObject({ status: 400 });
    await expect(t.service.create(t.as('mgr'), { name: 'x'.repeat(201), meetingId: a.id })).rejects.toMatchObject({ status: 400 });
  });

  it('an invitee from another company can’t change series, even for a meeting they organize', async () => {
    const t = setup();
    const a = await t.meeting('Theirs', 3, { organizerId: 'xena', createdById: 'xena' });
    await expect(t.service.create(t.as('xena'), { name: 'X', meetingId: a.id })).rejects.toMatchObject({ status: 403 });
  });

  it('a repeating meeting asks first, then brings all its meetings; its automatic series goes', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10, 17]);
    const auto = await t.store.create({ name: 'Weekly site', projectId: 'p1', companyId: null, auto: true, createdById: 'mgr' });
    await t.store.link(fam.map((m) => m.id), auto.id);
    await expect(t.service.create(t.as('mgr'), { name: 'Site meetings', meetingId: fam[1]!.id })).rejects.toMatchObject({ status: 409, code: 'SERIES_REPEATS' });
    const s = await t.service.create(t.as('mgr'), { name: 'Site meetings', meetingId: fam[1]!.id, wholeFamily: true });
    for (const m of fam) expect(await seriesIdOf(t, m.id)).toBe(s.id);
    expect(t.store.series.has(auto.id)).toBe(false);
  });

  it('adds existing meetings of the project; a meeting of another project can’t join', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    const b = await t.meeting('Two', 10);
    const other = await t.meeting('Elsewhere', 11, { projectId: 'p2' });
    await t.service.addMeetings(t.as('mgr'), s.id, [b.id]);
    expect(await seriesIdOf(t, b.id)).toBe(s.id);
    await expect(t.service.addMeetings(t.as('mgr'), s.id, [other.id])).rejects.toMatchObject({ status: 400 });
    expect(await seriesIdOf(t, other.id)).toBeNull();
  });

  it('a meeting in another series must leave it first; one already in this series is fine', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 10);
    const s1 = await t.series('First', [a.id]);
    await t.series('Second', [b.id]);
    await expect(t.service.addMeetings(t.as('mgr'), s1.id, [b.id])).rejects.toMatchObject({ status: 409, code: 'IN_ANOTHER_SERIES' });
    await expect(t.service.addMeetings(t.as('mgr'), s1.id, [a.id])).resolves.toBeUndefined();
  });

  it('an organizer adds their own meeting, not someone else’s', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    const mine = await t.meeting('Ana’s', 10, { organizerId: 'ana', createdById: 'ana' });
    const bens = await t.meeting('Ben’s', 11, { organizerId: 'ben', createdById: 'ben' });
    await t.service.addMeetings(t.as('ana'), s.id, [mine.id]);
    await expect(t.service.addMeetings(t.as('ana'), s.id, [bens.id])).rejects.toMatchObject({ status: 403 });
  });

  it('a series someone can’t see is not there for them (404)', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    const mine = await t.meeting('Cara’s', 4, { projectId: 'p2', organizerId: 'cara', createdById: 'cara' });
    await expect(t.service.addMeetings(t.as('cara'), s.id, [mine.id])).rejects.toMatchObject({ status: 404 });
    await expect(t.service.page(t.as('cara'), s.id)).rejects.toMatchObject({ status: 404 });
  });

  it('the picker offers the project’s meetings in no series that the person may add', async () => {
    const t = setup();
    const a = await t.meeting('In it', 3);
    const s = await t.series('Board', [a.id]);
    const free = await t.meeting('Free', 5);
    const anas = await t.meeting('Ana’s free one', 6, { organizerId: 'ana', createdById: 'ana' });
    await t.meeting('Elsewhere', 7, { projectId: 'p2' });
    await t.family('Repeats', [8, 15]);
    expect((await t.service.candidates(t.as('mgr'), s.id)).map((m) => m.id).sort()).toEqual([free.id, anas.id].sort());
    expect((await t.service.candidates(t.as('ana'), s.id)).map((m) => m.id)).toEqual([anas.id]);
  });
});

describe('taking meetings out, deleting, merging, renaming', () => {
  it('Remove from series takes a one-off out; a series made by hand stays, even empty', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    await t.service.removeMeeting(t.as('mgr'), s.id, a.id);
    expect(await seriesIdOf(t, a.id)).toBeNull();
    expect(t.store.series.has(s.id)).toBe(true);
  });

  it('a repeat leaves with its whole family, which gets a series of its own', async () => {
    const t = setup();
    const one = await t.meeting('One-off', 2);
    const fam = await t.family('Weekly site', [3, 10]);
    const s = await t.series('Board', [one.id, ...fam.map((m) => m.id)]);
    await t.service.removeMeeting(t.as('mgr'), s.id, fam[1]!.id);
    const own = await seriesIdOf(t, fam[0]!.id);
    expect(own).not.toBe(s.id);
    expect(await seriesIdOf(t, fam[1]!.id)).toBe(own);
    expect(t.store.series.get(own!)).toMatchObject({ name: 'Weekly site', auto: true, projectId: 'p1' });
    expect(await seriesIdOf(t, one.id)).toBe(s.id);
  });

  it('a repeat alone in its series can’t leave it (a repeating meeting always has a series)', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10]);
    const s = await t.series('Site', fam.map((m) => m.id));
    await expect(t.service.removeMeeting(t.as('mgr'), s.id, fam[0]!.id)).rejects.toMatchObject({ status: 409, code: 'SERIES_KEEPS_REPEAT' });
    await expect(t.service.remove(t.as('mgr'), s.id)).rejects.toMatchObject({ status: 409, code: 'SERIES_KEEPS_REPEAT' });
    const ctx = (await t.service.context(t.as('mgr'), fam[0]!.id))!;
    expect(ctx).toMatchObject({ keepsRepeat: true, canRemove: false });
  });

  it('an automatic series left empty goes', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const auto = await t.store.create({ name: 'Auto', projectId: 'p1', companyId: null, auto: true, createdById: 'mgr' });
    await t.store.link([a.id], auto.id);
    await t.service.removeMeeting(t.as('mgr'), auto.id, a.id);
    expect(t.store.series.has(auto.id)).toBe(false);
  });

  it('deleting a series leaves its meetings: one-offs in none, each repeat family in a series of its own', async () => {
    const t = setup();
    const one = await t.meeting('One-off', 2);
    const fam = await t.family('Weekly site', [3, 10]);
    const s = await t.series('Board', [one.id, ...fam.map((m) => m.id)]);
    await t.service.remove(t.as('mgr'), s.id);
    expect(t.store.series.has(s.id)).toBe(false);
    expect(await seriesIdOf(t, one.id)).toBeNull();
    const own = await seriesIdOf(t, fam[0]!.id);
    expect(own).toBeTruthy();
    expect(await seriesIdOf(t, fam[1]!.id)).toBe(own);
    expect((await t.meetings.findById(one.id))).not.toBeNull(); // never deleted
  });

  it('only administrators, the project’s managers and the series’ maker may rename, delete or merge', async () => {
    const t = setup();
    const a = await t.meeting('One', 3, { people: ['ben'] });
    const s = await t.series('Board', [a.id], { createdById: 'ana' });
    await expect(t.service.rename(t.as('ben'), s.id, 'New')).rejects.toMatchObject({ status: 403 });
    await expect(t.service.rename(t.as('ana'), s.id, 'By the maker')).resolves.toMatchObject({ name: 'By the maker' });
    await expect(t.service.rename(t.as('mgr'), s.id, 'By the manager')).resolves.toMatchObject({ name: 'By the manager' });
    await expect(t.service.rename(t.as('ceo'), s.id, ' ')).rejects.toMatchObject({ status: 400 });
    await expect(t.service.remove(t.as('ben'), s.id)).rejects.toMatchObject({ status: 403 });
  });

  it('merges another series of the same project into this one', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 10);
    const c = await t.meeting('Three', 12, { projectId: 'p2' });
    const s1 = await t.series('Old schedule', [a.id]);
    const s2 = await t.series('New schedule', [b.id]);
    const s3 = await t.series('Elsewhere', [c.id], { projectId: 'p2' });
    await expect(t.service.merge(t.as('mgr'), s1.id, s3.id)).rejects.toMatchObject({ status: 400 });
    await expect(t.service.merge(t.as('mgr'), s1.id, s1.id)).rejects.toMatchObject({ status: 400 });
    await t.service.merge(t.as('mgr'), s1.id, s2.id);
    expect(await seriesIdOf(t, b.id)).toBe(s1.id);
    expect(t.store.series.has(s2.id)).toBe(false);
  });
});

describe('the series page', () => {
  it('shows the visible meetings, the series’ open action items and what the person may do', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 30, { people: ['dan'] });
    const s = await t.series('Board', [a.id, b.id]);
    t.item(a.id, 'Open in one');
    t.item(b.id, 'Open in two');
    const mgr = await t.service.page(t.as('mgr'), s.id);
    expect(mgr.meetings.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(mgr.openActionItems.map((i) => i.description).sort()).toEqual(['Open in one', 'Open in two']);
    expect(mgr).toMatchObject({ canManage: true, canDelete: true, canAdd: true });
    expect(mgr.removable.sort()).toEqual([a.id, b.id].sort());
    // Merge: the project's other series the person manages.
    const other = await t.meeting('Old schedule', 1);
    const old = await t.series('Old schedule', [other.id]);
    await t.series('Elsewhere', [(await t.meeting('P2', 2, { projectId: 'p2' })).id], { projectId: 'p2' });
    expect((await t.service.page(t.as('mgr'), s.id)).mergeOptions).toEqual([{ id: old.id, name: 'Old schedule' }]);
    expect((await t.service.page(t.as('dan'), s.id)).mergeOptions).toEqual([]);
    const dan = await t.service.page(t.as('dan'), s.id);
    expect(dan.meetings.map((m) => m.id)).toEqual([b.id]);
    expect(dan.openActionItems.map((i) => i.description)).toEqual(['Open in two']);
    expect(dan).toMatchObject({ canManage: false, removable: [] });
  });

  it('lists a meeting’s choices for "Add to a series": its project’s series it may see', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    const other = await t.meeting('Elsewhere', 4, { projectId: 'p2' });
    await t.series('P2 series', [other.id], { projectId: 'p2' });
    const b = await t.meeting('Two', 10, { organizerId: 'ana', createdById: 'ana' });
    const opts = await t.service.options(t.as('ana'), b.id);
    expect(opts).toMatchObject({ canChange: true, repeats: false, current: null });
    expect(opts.series.map((x) => x.name)).toEqual(['Board']);
    expect((await t.service.options(t.as('ben'), b.id)).canChange).toBe(false);
    expect(s).toBeTruthy();
  });
});

describe('New meeting in this series', () => {
  it('is pre-filled from the latest meeting: name, project, people the picker offers, place, link, length, agenda', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { location: 'Room 1' });
    const b = await t.meeting('Monthly 2', 10, { location: 'Room 2', onlineLink: 'https://meet.example.com/abc', people: ['ana', 'cara'] });
    await t.attendees.add({ meetingId: b.id, externalName: 'Guest', externalEmail: 'guest@client.test' });
    await t.meeting('Monthly 3 (cancelled)', 17, { status: 'CANCELLED' });
    const s = await t.series('Monthly OXY review', [a.id, b.id]);
    t.agenda.push({ meetingId: b.id, title: 'Progress', ownerId: 'ana', expectedMinutes: 15, position: 0 });
    t.agenda.push({ meetingId: b.id, title: 'Safety', ownerId: 'cara', expectedMinutes: null, position: 1 });
    const pre = await t.service.prefill(t.as('ben'), s.id);
    expect(pre).toMatchObject({
      seriesId: s.id, seriesName: 'Monthly OXY review', title: 'Monthly OXY review', projectId: 'p1', companyId: null,
      location: 'Room 2', onlineLink: 'https://meet.example.com/abc', durationMinutes: 60,
    });
    // cara isn't someone the picker offers for p1: left out, and her agenda item has no lead.
    expect(pre.people).toEqual([{ kind: 'user', id: 'ana', name: 'ANA' }, { kind: 'guest', email: 'guest@client.test', name: 'Guest' }]);
    expect(pre.agendaItems).toEqual([{ title: 'Progress', ownerId: 'ana', expectedMinutes: 15 }, { title: 'Safety', ownerId: null, expectedMinutes: null }]);
  });

  it('1.23 integration: from a meeting whose link Teams made — no link copied, the Teams tick instead', async () => {
    const t = setup();
    const a = await t.meeting('Monthly 1', 3, { onlineLink: 'https://teams.microsoft.com/l/meetup-join/x', onlineMeetingProvider: 'TEAMS' });
    const s = await t.series('Monthly OXY review', [a.id]);
    const pre = await t.service.prefill(t.as('ben'), s.id);
    expect(pre.onlineLink).toBeNull();
    expect(pre.teamsLink).toBe(true);
    const b = await t.meeting('Monthly 2', 10, { onlineLink: 'https://meet.example.com/abc' });
    const plain = await t.series('Plain', [b.id]);
    expect(await t.service.prefill(t.as('ben'), plain.id)).toMatchObject({ onlineLink: 'https://meet.example.com/abc', teamsLink: false });
  });

  it('checks a new meeting may join: the series’ project, and the person may add it', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    await expect(t.service.checkJoin(t.as('ana'), s.id, { projectId: 'p1', companyId: null, organizerId: 'ana' })).resolves.toBe(s.id);
    await expect(t.service.checkJoin(t.as('ana'), s.id, { projectId: 'p2', companyId: null, organizerId: 'ana' })).rejects.toMatchObject({ status: 400 });
    await expect(t.service.checkJoin(t.as('ana'), s.id, { projectId: 'p1', companyId: null, organizerId: 'ben' })).rejects.toMatchObject({ status: 403 });
    await expect(t.service.checkJoin(t.as('cara'), s.id, { projectId: 'p1', companyId: null, organizerId: 'cara' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('repeating meetings are always in a series', () => {
  it('a new repeating meeting in no series gets one named after it; its other meetings join it', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10]);
    const id = await t.service.ensureFamilySeries((await t.meetings.findById(fam[0]!.id))!);
    expect(t.store.series.get(id!)).toMatchObject({ name: 'Weekly site', auto: true, projectId: 'p1', createdById: 'mgr' });
    expect(await seriesIdOf(t, fam[1]!.id)).toBe(id);
    // Asked again: the same series.
    expect(await t.service.ensureFamilySeries((await t.meetings.findById(fam[1]!.id))!)).toBe(id);
  });

  it('a repeat already in a series keeps it', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3]);
    const s = await t.series('Board', [fam[0]!.id]);
    expect(await t.service.ensureFamilySeries((await t.meetings.findById(fam[0]!.id))!)).toBe(s.id);
  });

  it('moving a one-off to another project takes it out of the series', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    await t.meetings.update(a.id, { projectId: 'p2' });
    await t.service.followPlace((await t.meetings.findById(a.id))!);
    expect(await seriesIdOf(t, a.id)).toBeNull();
    expect(t.store.series.has(s.id)).toBe(true);
  });

  it('repeats moved together get one new series in the new project', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10, 17]);
    const s = await t.series('Board', fam.map((m) => m.id));
    for (const m of fam.slice(1)) await t.meetings.update(m.id, { projectId: 'p2' });
    for (const m of fam.slice(1)) await t.service.followPlace((await t.meetings.findById(m.id))!);
    const moved = await seriesIdOf(t, fam[1]!.id);
    expect(moved).not.toBe(s.id);
    expect(await seriesIdOf(t, fam[2]!.id)).toBe(moved);
    expect(t.store.series.get(moved!)).toMatchObject({ projectId: 'p2', auto: true, name: 'Weekly site' });
    expect(await seriesIdOf(t, fam[0]!.id)).toBe(s.id);
  });

  it('a meeting still in its series’ place is left alone', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const s = await t.series('Board', [a.id]);
    await t.service.followPlace((await t.meetings.findById(a.id))!);
    expect(await seriesIdOf(t, a.id)).toBe(s.id);
    expect(t.changed).toEqual([]);
  });
});

// ── Review fixes (1.23.0 review, 5 Nov) ──────────────────────────────────────────────────────────
describe('review fixes', () => {
  it('no count of a family someone can’t see: options and the "add all N?" question come only with the right to move it', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10, 17, 24, 31]);
    await t.attendees.add({ meetingId: fam[4]!.id, userId: 'dan' });
    const opts = await t.service.options(t.as('dan'), fam[4]!.id);
    expect(opts).toMatchObject({ canChange: false, familySize: 0 });
    await expect(t.service.create(t.as('dan'), { name: 'X', meetingId: fam[4]!.id })).rejects.toMatchObject({ status: 403 });
    // The organizer still gets the question, with the count.
    await expect(t.service.create(t.as('mgr'), { name: 'X', meetingId: fam[4]!.id })).rejects.toMatchObject({ status: 409, details: { count: 5 } });
  });

  it('the AI’s carry-over (organizer’s view) holds only items the person asking may see too', async () => {
    const t = setup();
    const a = await t.meeting('Hidden from ben', 3, { projectId: null, companyId: 'c1', organizerId: 'mgr', createdById: 'mgr' });
    const b = await t.meeting('Ben made this', 10, { projectId: null, companyId: 'c1', organizerId: 'mgr', createdById: 'ben' });
    await t.series('Standalone', [a.id, b.id], { projectId: null, companyId: 'c1' });
    t.item(a.id, 'Only the organizer may see this');
    const record = (await t.meetings.findById(b.id))!;
    expect((await t.service.minutesSeries(record, { userId: 'mgr' }))!.openFromEarlier).toHaveLength(1);
    expect((await t.service.minutesSeries(record, { userId: 'mgr', alsoVisibleTo: 'ben' }))!.openFromEarlier).toEqual([]);
    expect((await t.service.minutesSeries(record, { userId: 'mgr', alsoVisibleTo: 'mgr' }))!.openFromEarlier).toHaveLength(1);
  });

  it('an automatic series emptied by deleting its meetings goes, and empty automatic series are never offered', async () => {
    const t = setup();
    const fam = await t.family('Made by mistake', [3, 10]);
    const id = (await t.service.ensureFamilySeries((await t.meetings.findById(fam[0]!.id))!))!;
    const other = await t.meeting('Another', 5, { organizerId: 'ana', createdById: 'ana' });
    // An empty automatic series (left from before) is not offered.
    const stale = await t.store.create({ name: 'Stale auto', projectId: 'p1', companyId: null, auto: true, createdById: 'mgr' });
    expect((await t.service.options(t.as('ana'), other.id)).series.map((s) => s.name)).toEqual(['Made by mistake']);
    for (const m of fam) {
      const rec = (await t.meetings.findById(m.id))!;
      await t.meetings.softDelete(m.id);
      await t.service.afterDeleted(rec);
    }
    expect(t.store.series.has(id)).toBe(false);
    expect(t.store.series.has(stale.id)).toBe(true); // only the meeting's own series is looked at
    expect((await t.service.options(t.as('ana'), other.id)).series).toEqual([]);
  });

  it('a repeating meeting in no series (a paused repeat, or one made before 1.23) gets one when it changes', async () => {
    const t = setup();
    const fam = await t.family('Paused weekly', [3, 10]);
    await t.service.followPlace((await t.meetings.findById(fam[1]!.id))!);
    const id = await seriesIdOf(t, fam[0]!.id);
    expect(id).toBeTruthy();
    expect(await seriesIdOf(t, fam[1]!.id)).toBe(id);
  });

  it('says a repeat can’t leave only to someone who sees the whole series', async () => {
    const t = setup();
    const fam = await t.family('Weekly site', [3, 10, 17]);
    await t.attendees.add({ meetingId: fam[2]!.id, userId: 'dan' });
    const s = await t.series('Site', fam.map((m) => m.id));
    expect((await t.service.context(t.as('dan'), fam[2]!.id))!.keepsRepeat).toBe(false);
    expect((await t.service.context(t.as('mgr'), fam[2]!.id))!.keepsRepeat).toBe(true);
    expect((await t.service.page(t.as('dan'), s.id)).keepsRepeat).toBe(false);
  });

  it('the meeting page says whether the person may add a meeting to the series', async () => {
    const t = setup();
    const a = await t.meeting('One', 3, { people: ['xena'] });
    await t.series('Board', [a.id]);
    expect((await t.service.context(t.as('ana'), a.id))!.canAdd).toBe(true);
    expect((await t.service.context(t.as('xena'), a.id))!.canAdd).toBe(false);
  });

  it('merging moves every meeting of the other series, even one that joined after the page was read', async () => {
    const t = setup();
    const a = await t.meeting('One', 3);
    const b = await t.meeting('Two', 10);
    const s1 = await t.series('Keep', [a.id]);
    const s2 = await t.series('Merge me', [b.id]);
    const late = await t.meeting('Joined late', 12);
    const realMeetingsOf = t.store.meetingsOf.bind(t.store);
    let first = true;
    t.store.meetingsOf = async (id) => {
      const rows = await realMeetingsOf(id);
      if (id === s2.id && first) {
        first = false;
        await t.store.link([late.id], s2.id); // someone adds a meeting meanwhile
      }
      return rows;
    };
    await t.service.merge(t.as('mgr'), s1.id, s2.id);
    expect(await seriesIdOf(t, late.id)).toBe(s1.id);
  });
});
