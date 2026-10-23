import { describe, it, expect } from 'vitest';
import type { TimelineProject } from '../api/planning';
import {
  barShape,
  busyTotals,
  datesLine,
  doneLine,
  filterTimeline,
  heatLevel,
  heatScale,
  lateNote,
  markerDays,
  markerLabel,
  meetingMarkers,
  milestoneLine,
  monthMarks,
  nextLine,
  ownerOptions,
  rangeFor,
  readTimelineState,
  riskLabel,
  shiftAnchor,
  sortTimeline,
  statusLine,
  subline,
  targetLine,
  timelineSummary,
  writeTimelineState,
  xOf,
} from './timeline';

const TODAY = '2026-10-24';

function tp(id: string, extra: Partial<TimelineProject> = {}): TimelineProject {
  return {
    id,
    code: id.toUpperCase(),
    name: `Project ${id}`,
    color: '#2F6FAE',
    icon: null,
    imageUrl: null,
    status: 'ACTIVE',
    owner: null,
    start: '2026-10-01',
    startIsCreated: false,
    target: '2026-12-10',
    tasks: { total: 10, done: 5, open: 5, overdue: 0 },
    progress: 50,
    timeUsed: 33,
    health: 'on-track',
    daysLate: 0,
    dueByWeek: [],
    milestones: [],
    nextMilestone: null,
    milestonesSoon: 0,
    meetings: [],
    meetingsThisWeek: 0,
    ...extra,
  };
}

const SARA = { id: 'u1', name: 'Sara Ahmed', avatarUrl: null };
const OMAR = { id: 'u2', name: 'Omar Said', avatarUrl: null };
const FALCON = tp('fcrm', { name: 'Falcon CRM', health: 'late', daysLate: 3, target: '2026-10-21', progress: 85, timeUsed: 100, owner: OMAR, tasks: { total: 20, done: 17, open: 3, overdue: 1 } });
const MOBILE = tp('mob', { name: 'Mobile App (Phase 2)', health: 'at-risk', progress: 9, timeUsed: 45, owner: SARA, milestonesSoon: 2, meetingsThisWeek: 1 });
const RIG = tp('rig', { name: 'Rig Inspection Portal', health: 'on-track', progress: 62, owner: SARA, target: '2026-11-20', milestonesSoon: 1, meetingsThisWeek: 2 });
const MSSP = tp('mssp', { name: 'MICO360 Services', health: 'no-target', target: null, timeUsed: null, progress: 20 });
const LATER = tp('later', { name: 'Archive Portal', health: 'late', daysLate: 10, target: '2026-10-14', owner: OMAR });

describe('timeline state in the address', () => {
  it('reads the view, place, owner, sort and status filter, falling back to the defaults', () => {
    expect(readTimelineState(new URLSearchParams(''))).toEqual({ view: 'quarter', at: null, owner: '', sort: 'attention', show: '' });
    expect(readTimelineState(new URLSearchParams('view=half&at=2026-11-02&owner=u1&sort=name&show=late'))).toEqual({
      view: 'half',
      at: '2026-11-02',
      owner: 'u1',
      sort: 'name',
      show: 'late',
    });
    expect(readTimelineState(new URLSearchParams('view=decade&at=soon&sort=size&show=fine'))).toEqual({ view: 'quarter', at: null, owner: '', sort: 'attention', show: '' });
  });

  it('writes only what differs from the defaults and keeps anything else', () => {
    const next = writeTimelineState(new URLSearchParams('task=t1&view=half'), { view: 'quarter', show: 'at-risk', owner: 'u2' });
    expect(next.toString()).toBe('task=t1&show=at-risk&owner=u2');
  });
});

describe('the shown weeks', () => {
  it('shows 6, 13 or 26 weeks, starting one, two or four weeks before the anchor week', () => {
    expect(rangeFor('month', '2026-10-19')).toEqual({ from: '2026-10-12', to: '2026-11-22' });
    expect(rangeFor('quarter', '2026-10-19')).toEqual({ from: '2026-10-05', to: '2027-01-03' });
    expect(rangeFor('half', '2026-10-19')).toEqual({ from: '2026-09-21', to: '2027-03-21' });
  });

  it('pages by about the shown length: 4 weeks, a quarter, half a year', () => {
    expect(shiftAnchor('month', '2026-10-19', 1)).toBe('2026-11-16');
    expect(shiftAnchor('quarter', '2026-10-19', -1)).toBe('2026-07-20');
    expect(shiftAnchor('half', '2026-10-19', 1)).toBe('2027-04-19');
  });
});

describe('sorting, filters and the summary', () => {
  const all = [RIG, MSSP, MOBILE, LATER, FALCON];

  it('needs attention first: late (most days late first), then at risk, then on track, then no target', () => {
    expect(sortTimeline(all, 'attention').map((p) => p.id)).toEqual(['later', 'fcrm', 'mob', 'rig', 'mssp']);
  });

  it('sorts by name, or by target date with no target last', () => {
    expect(sortTimeline(all, 'name').map((p) => p.name)).toEqual(['Archive Portal', 'Falcon CRM', 'MICO360 Services', 'Mobile App (Phase 2)', 'Rig Inspection Portal']);
    expect(sortTimeline(all, 'target').map((p) => p.id)).toEqual(['later', 'fcrm', 'rig', 'mob', 'mssp']);
  });

  it('filters by owner and by status (late or at risk)', () => {
    expect(filterTimeline(all, { owner: 'u1', show: '' }).map((p) => p.id)).toEqual(['rig', 'mob']);
    expect(filterTimeline(all, { owner: '', show: 'late' }).map((p) => p.id)).toEqual(['later', 'fcrm']);
    expect(filterTimeline(all, { owner: 'u2', show: 'at-risk' })).toEqual([]);
  });

  it('lists each owner once, by name', () => {
    expect(ownerOptions(all)).toEqual([OMAR, SARA].map(({ id, name }) => ({ id, name })));
  });

  it('counts the cards: open projects, late, at risk, milestones in 30 days, meetings this week', () => {
    expect(timelineSummary(all)).toEqual({ open: 5, late: 2, atRisk: 1, milestonesSoon: 3, meetingsThisWeek: 3 });
  });

  it('says what is shown, for screen readers as the filters change', () => {
    expect(statusLine(timelineSummary(all), '', 5)).toBe('5 open projects · 2 late · 1 at risk');
    expect(statusLine(timelineSummary([RIG]), '', 1)).toBe('1 open project · none late or at risk');
    expect(statusLine(timelineSummary(all), 'late', 2)).toBe('Showing the 2 late projects');
    expect(statusLine(timelineSummary(all), 'at-risk', 1)).toBe('Showing the 1 project at risk');
    expect(statusLine(timelineSummary([]), '', 0)).toBe('No open projects');
  });
});

describe('busy weeks', () => {
  it('adds up the shown projects’ open tasks due each week', () => {
    expect(busyTotals([tp('a', { dueByWeek: [1, 0, 4] }), tp('b', { dueByWeek: [5, 2, 0] })], 3)).toEqual([6, 2, 4]);
    expect(busyTotals([], 2)).toEqual([0, 0]);
  });

  it('picks four steps that grow with the busiest week', () => {
    expect(heatScale([6, 11, 14, 19, 0])).toEqual({ size: 5, labels: ['1–5', '6–10', '11–15', '16+'] });
    expect(heatScale([1, 3, 0])).toEqual({ size: 1, labels: ['1', '2', '3', '4+'] });
    expect(heatScale([])).toEqual({ size: 1, labels: ['1', '2', '3', '4+'] });
    expect(heatScale([40])).toEqual({ size: 10, labels: ['1–10', '11–20', '21–30', '31+'] });
  });

  it('puts each week on its step: 0 is quiet', () => {
    expect([0, 1, 5, 6, 10, 11, 16, 19, 99].map((n) => heatLevel(n, 5))).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 4]);
  });
});

describe('bar geometry', () => {
  const range = { from: '2026-10-05', to: '2027-01-03' }; // 13 weeks, 91 days

  it('places a day as a share of the shown days', () => {
    expect(xOf('2026-10-05', range.from, 91)).toBe(0);
    expect(xOf('2027-01-04', range.from, 91)).toBe(100);
    expect(xOf('2026-10-12', range.from, 91)).toBeCloseTo(7.692, 2);
  });

  it('runs a bar from the start to the end of the target day, cut at the edges', () => {
    const shape = barShape(tp('a', { start: '2026-10-12', target: '2026-10-25' }), range, TODAY);
    expect(shape.bar).toMatchObject({ startsBefore: false, endsAfter: false, open: false });
    expect(shape.bar!.left).toBeCloseTo(7.692, 2);
    expect(shape.bar!.width).toBeCloseTo((14 / 91) * 100, 2);
    expect(shape.over).toBeNull();
    const cut = barShape(tp('b', { start: '2026-09-01', target: '2027-02-01' }), range, TODAY).bar!;
    expect(cut).toMatchObject({ left: 0, width: 100, startsBefore: true, endsAfter: true });
  });

  it('fills a bar to the share done of the whole bar, also when its start is cut off', () => {
    expect(barShape(tp('a', { start: '2026-10-12', target: '2026-10-25', progress: 40 }), range, TODAY).bar!.fill).toBeCloseTo(40, 5);
    // 5 Sep → 4 Nov is 61 days; half done ends half a day into the shown weeks, which show 31 of its days.
    expect(barShape(tp('b', { start: '2026-09-05', target: '2026-11-04', progress: 50 }), range, TODAY).bar!.fill).toBeCloseTo((0.5 / 31) * 100, 3);
    expect(barShape(tp('c', { start: '2026-09-05', target: '2026-11-04', progress: 10 }), range, TODAY).bar!.fill).toBe(0);
  });

  it('hatches a late project from the day after its target to the end of today', () => {
    const shape = barShape(tp('late', { start: '2026-10-05', target: '2026-10-21', health: 'late', daysLate: 3 }), range, TODAY);
    expect(shape.over!.left).toBeCloseTo((17 / 91) * 100, 2);
    expect(shape.over!.width).toBeCloseTo((3 / 91) * 100, 2);
  });

  it('runs a project without a target to the end, open-ended', () => {
    const shape = barShape(tp('open', { start: '2026-10-19', target: null, health: 'no-target' }), range, TODAY);
    expect(shape.bar).toMatchObject({ open: true, endsAfter: true });
    expect(shape.bar!.left + shape.bar!.width).toBeCloseTo(100, 5);
  });

  it('shows no bar for a project wholly outside the shown weeks', () => {
    expect(barShape(tp('past', { start: '2026-01-01', target: '2026-02-01' }), range, TODAY).bar).toBeNull();
    expect(barShape(tp('future', { start: '2027-03-01', target: '2027-06-01' }), range, TODAY).bar).toBeNull();
  });

  it('labels the months where they begin, with the year on the first and on January', () => {
    expect(monthMarks(range.from, range.to)).toEqual([
      { key: '2026-10', label: 'October 2026', left: 0 },
      { key: '2026-11', label: 'November', left: expect.closeTo((27 / 91) * 100, 3) },
      { key: '2026-12', label: 'December', left: expect.closeTo((57 / 91) * 100, 3) },
      { key: '2027-01', label: 'January 2027', left: expect.closeTo((88 / 91) * 100, 3) },
    ]);
    // A first month with only a few days shown gives its label to the next one.
    expect(monthMarks('2026-10-26', '2027-01-24')[0]).toEqual({ key: '2026-11', label: 'November 2026', left: expect.closeTo((6 / 91) * 100, 3) });
  });
});

describe('meeting markers', () => {
  const m = (id: string, day: string, title = `Meeting ${id}`) => ({ id, title, startAt: `${day}T06:00:00.000Z`, day });
  const weeks = ['2026-10-18', '2026-10-25', '2026-11-01'];
  const list = [m('a', '2026-10-20'), m('b', '2026-10-22'), m('c', '2026-10-22'), m('d', '2026-10-30'), m('e', '2026-11-01', 'Kick-off')];

  it('groups a project’s meetings by day when days are wide enough (Month)', () => {
    const groups = meetingMarkers(list, weeks, 'day');
    expect(groups.map((g) => [g.first, g.last, g.meetings.length])).toEqual([
      ['2026-10-20', '2026-10-20', 1],
      ['2026-10-22', '2026-10-22', 2],
      ['2026-10-30', '2026-10-30', 1],
      ['2026-11-01', '2026-11-01', 1],
    ]);
  });

  it('groups them by week otherwise, so markers never overlap', () => {
    const groups = meetingMarkers(list, weeks, 'week');
    expect(groups.map((g) => [g.first, g.last, g.meetings.map((x) => x.id).join('')])).toEqual([
      ['2026-10-20', '2026-10-22', 'abc'],
      ['2026-10-30', '2026-10-30', 'd'],
      ['2026-11-01', '2026-11-01', 'e'],
    ]);
  });

  it('names a marker by its meeting, or how many and when', () => {
    const [week, single] = [meetingMarkers(list, weeks, 'week')[0]!, meetingMarkers(list, weeks, 'week')[2]!];
    expect(markerLabel(single)).toBe('Meeting Kick-off, Sun 1 Nov');
    expect(markerLabel(meetingMarkers(list, weeks, 'day')[1]!)).toBe('2 meetings, Thu 22 Oct');
    expect(markerLabel(week)).toBe('3 meetings, 20–22 Oct');
    expect(markerDays(week)).toBe('20–22 Oct');
    expect(markerDays({ first: '2026-10-30', last: '2026-11-01' })).toBe('30 Oct – 1 Nov');
    expect(markerDays(single)).toBe('Sun 1 Nov');
  });
});

describe('wording', () => {
  const beta = { id: 'm1', key: 'MOB-2', title: 'Beta build', date: '2026-11-06', done: false };

  it('sums a project up under its name', () => {
    expect(subline(tp('a', { progress: 62, nextMilestone: { ...beta, title: 'Pilot on rig 3', date: '2026-11-12' }, milestones: [beta] }), TODAY)).toBe('62% · next ◆ Pilot on rig 3 · 12 Nov');
    expect(subline(tp('a', { progress: 85, nextMilestone: { ...beta, title: 'Handover', date: '2026-10-20' }, milestones: [beta] }), TODAY)).toBe('85% · next ◆ Handover · overdue');
    expect(subline(tp('a', { progress: 20 }), TODAY)).toBe('20% · no milestones');
    expect(subline(tp('a', { progress: 100, milestones: [{ ...beta, done: true }] }), TODAY)).toBe('100% · every milestone reached');
    expect(subline(tp('a', { progress: 5, nextMilestone: { ...beta, date: null }, milestones: [beta] }), TODAY)).toBe('5% · next ◆ Beta build · no date');
    expect(subline(tp('a', { progress: 5, nextMilestone: { ...beta, date: '2027-02-03' }, milestones: [beta] }), TODAY)).toBe('5% · next ◆ Beta build · 3 Feb 2027');
  });

  it('labels an at-risk bar and a late one', () => {
    expect(riskLabel(MOBILE)).toBe('9% done · 45% of the time used');
    expect(lateNote(FALCON, TODAY)).toBe('Target 21 Oct · 3 days late');
    expect(lateNote(tp('a', { target: '2026-10-23', daysLate: 1 }), TODAY)).toBe('Target 23 Oct · 1 day late');
  });

  it('gives the details: dates, done, overdue and the next milestone', () => {
    expect(datesLine(tp('a', { start: '2026-10-01', target: '2026-12-10' }))).toBe('1 Oct → 10 Dec 2026');
    expect(datesLine(tp('a', { start: '2026-12-01', target: '2027-01-15' }))).toBe('1 Dec 2026 → 15 Jan 2027');
    expect(datesLine(tp('a', { start: '2026-10-01', startIsCreated: true, target: null }))).toBe('1 Oct 2026 (created) → no target date');
    expect(doneLine(tp('a', { tasks: { total: 11, done: 1, open: 10, overdue: 3 }, progress: 9, timeUsed: 45, health: 'at-risk' }))).toBe('1 of 11 tasks (9%) · 45% of the time used');
    expect(doneLine(tp('a', { tasks: { total: 1, done: 0, open: 1, overdue: 0 }, progress: 0, timeUsed: null, health: 'no-target' }))).toBe('0 of 1 task (0%)');
    expect(doneLine(tp('a', { tasks: { total: 0, done: 0, open: 0, overdue: 0 }, progress: 0 }))).toBe('No tasks yet');
    expect(nextLine(tp('a', { nextMilestone: beta, milestones: [beta] }), TODAY)).toBe('◆ Beta build, 6 Nov');
    expect(nextLine(tp('a'), TODAY)).toBe('No milestones');
  });

  it('gives a phone row its next milestone', () => {
    expect(milestoneLine(tp('a', { nextMilestone: beta, milestones: [beta] }), TODAY)).toBe('Next ◆ Beta build · 6 Nov');
    expect(milestoneLine(tp('a'), TODAY)).toBe('No milestones');
    expect(milestoneLine(tp('a', { milestones: [{ ...beta, done: true }] }), TODAY)).toBe('Every milestone reached');
  });

  it('gives a phone row its target', () => {
    expect(targetLine(tp('a', { target: '2026-12-10' }), TODAY)).toBe('Target 10 Dec');
    expect(targetLine(FALCON, TODAY)).toBe('Target 21 Oct · 3 days late');
    expect(targetLine(MSSP, TODAY)).toBe('No target date');
  });
});
