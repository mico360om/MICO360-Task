import { describe, it, expect } from 'vitest';
import type { CreateTaskChange, MeetingChange, MinutesChange, ProposalChange, UpdateTaskChange } from '../api/mico-ai';
import {
  cardHeading,
  changeLabel,
  confirmBody,
  countdown,
  initialTicks,
  lengthLabel,
  linesOf,
  meetingWhen,
  remainingNeeds,
  resultSummary,
  undoLeft,
  zoneLabel,
  shortDay,
  textOf,
  undoSummary,
} from './mico-ai-proposal';

const base = { needs: [], problem: null, locked: false, warning: null, result: null, undo: null };
const create = (id: string, extra: Partial<CreateTaskChange> = {}): CreateTaskChange => ({
  ...base,
  id,
  type: 'create_task',
  fields: { title: `Task ${id}`, projectId: 'p-rig', assigneeIds: ['u-sara'], due: '2026-10-27', priority: 'NORMAL', description: '' },
  labels: { project: 'Rig Inspection Portal', assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
  ...extra,
});
const update = (id: string, extra: Partial<UpdateTaskChange> = {}): UpdateTaskChange => ({
  ...base,
  id,
  type: 'update_task',
  task: { id: 't14', key: 'RIG-14', title: 'Pressure test report', projectId: 'p-rig', project: 'Rig Inspection Portal', url: '?task=t14' },
  base: { version: 3, assigneeIds: ['u-omar'], activity: 4 },
  before: { due: '2026-10-19', priority: 'NORMAL', columnId: 'c-doing', column: 'In progress', assignees: [{ id: 'u-omar', name: 'Omar Said' }] },
  fields: { due: '2026-10-25' },
  labels: {},
  ...extra,
});
const minutes = (id: string): MinutesChange => ({
  ...base,
  id,
  type: 'draft_minutes',
  meeting: { id: 'm1', title: 'Site visit', startAt: '2026-10-22T06:00:00.000Z', url: '/meetings/m1' },
  fields: { content: { summary: 'S', discussion: [], decisions: [], risks: [], nextSteps: [] } },
  base: { status: 'NONE', savedAt: null },
});
const meeting = (id: string, extra: Partial<MeetingChange['fields']> = {}): MeetingChange => ({
  ...base,
  id,
  type: 'schedule_meeting',
  fields: { title: 'Review', projectId: null, date: '2026-10-27', time: '10:00', minutes: 30, attendeeIds: ['u-sara'], agenda: [], description: '', ...extra },
  labels: { project: null, attendees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
});

describe('MICO AI card helpers', () => {
  it('a day with its weekday, never shifted by the browser’s zone', () => {
    expect(shortDay('2026-10-27')).toBe('Tue 27 Oct');
    expect(shortDay(null)).toBe('No date');
  });

  it('names the card by what is on it', () => {
    expect(cardHeading([create('c1')])).toBe('1 new task');
    expect(cardHeading([create('c1'), create('c2'), create('c3')])).toBe('3 new tasks');
    expect(cardHeading([update('c1'), update('c2')])).toBe('2 task changes');
    expect(cardHeading([meeting('c1')])).toBe('1 meeting to schedule');
    expect(cardHeading([minutes('c1')])).toBe('Final minutes draft');
    expect(cardHeading([create('c1'), meeting('c2')])).toBe('2 changes to make');
  });

  it('labels each change for its tick box', () => {
    expect(changeLabel(create('c1'))).toBe('Create “Task c1”');
    expect(changeLabel(update('c1'))).toBe('Change RIG-14');
    expect(changeLabel(minutes('c1'))).toBe('Draft the final minutes of Site visit');
    expect(changeLabel(meeting('c1'))).toBe('Schedule “Review”');
  });

  it('starts with everything ticked except a change with a problem, and a locked one', () => {
    expect(initialTicks([create('c1'), create('c2', { needs: [{ fields: ['projectId'], message: 'Pick a project.' }], problem: 'Pick a project.' }), update('c3', { locked: true, problem: 'Nothing to change.' })])).toEqual({ c1: true, c2: false, c3: false });
  });

  it('builds Confirm’s body: the ticks, only the edits made, and the invitations box only with a meeting', () => {
    const items: ProposalChange[] = [create('c1'), update('c2'), update('c3', { locked: true, problem: 'x' }), meeting('c4')];
    const body = confirmBody(items, { c1: true, c2: false, c3: true, c4: true }, { c1: { due: '2026-11-02', assigneeIds: [] }, c2: {}, c4: { time: '11:00' } }, false);
    expect(body).toEqual({
      items: [
        { id: 'c1', include: true, edits: { due: '2026-11-02', assigneeIds: [] } },
        { id: 'c2', include: false },
        { id: 'c3', include: false },
        { id: 'c4', include: true, edits: { time: '11:00' } },
      ],
      sendInvites: false,
    });
    expect(confirmBody([create('c1')], { c1: true }, {}, true)).toEqual({ items: [{ id: 'c1', include: true }] });
  });

  it('a task change sends only the fields that are on it', () => {
    const body = confirmBody([update('c1')], { c1: true }, { c1: { due: '2026-10-30', priority: 'HIGH' } }, true);
    expect(body.items[0]).toEqual({ id: 'c1', include: true, edits: { due: '2026-10-30' } });
  });

  it('sums up what happened, and what Undo did', () => {
    const done = (s: 'done' | 'refused' | 'failed' | 'skipped') => ({ status: s, message: null, link: null });
    const items = [create('c1', { result: done('done') }), create('c2', { result: done('done') }), create('c3', { result: done('refused') }), create('c4', { result: done('skipped') })];
    expect(resultSummary(items)).toBe('2 done, 1 refused, 1 skipped');
    expect(resultSummary([create('c1', { result: done('refused') })])).toBe('Nothing was changed: 1 refused');
    const undone = [
      create('c1', { undo: { status: 'undone', message: null } }),
      create('c2', { undo: { status: 'refused', message: 'Sara changed it' } }),
      create('c3', { undo: null }),
    ];
    expect(undoSummary(undone)).toBe('1 put back, 1 left as it was');
  });

  it('the Undo countdown in minutes and seconds', () => {
    expect(countdown(15 * 60_000)).toBe('15:00');
    expect(countdown(14 * 60_000 + 32_400)).toBe('14:32');
    expect(countdown(5_000)).toBe('0:05');
    expect(countdown(-10)).toBe('0:00');
  });

  it('lists edited one item a line', () => {
    expect(linesOf(' Go live\n\n  Train the team \n')).toEqual(['Go live', 'Train the team']);
    expect(textOf(['a', 'b'])).toBe('a\nb');
  });

  it('when a meeting is, and how long', () => {
    expect(meetingWhen(meeting('c1').fields)).toBe('Tue 27 Oct, 10:00–10:30');
    expect(meetingWhen(meeting('c1', { time: '23:30', minutes: 90 }).fields)).toBe('Tue 27 Oct, 23:30–01:00');
    expect(meetingWhen(meeting('c1', { time: null }).fields)).toBe('Tue 27 Oct, time to pick');
    expect(lengthLabel(30)).toBe('30 min');
    expect(lengthLabel(60)).toBe('1 h');
    expect(lengthLabel(90)).toBe('1 h 30 min');
  });

  it('shows the year only when it isn’t this year', () => {
    expect(shortDay('2026-10-27', '2026')).toBe('Tue 27 Oct');
    expect(shortDay('2027-01-05', '2026')).toBe('Tue 5 Jan 2027');
    expect(meetingWhen(meeting('c1', { date: '2027-01-05' }).fields, { thisYear: '2026' })).toBe('Tue 5 Jan 2027, 10:00–10:30');
  });

  it('names a time zone by its city, for meeting times shown in the company’s zone', () => {
    expect(zoneLabel('Asia/Muscat')).toBe('Muscat time');
    expect(zoneLabel('America/New_York')).toBe('New York time');
    expect(zoneLabel('UTC')).toBe('UTC time');
    expect(meetingWhen(meeting('c1').fields, { zone: 'Asia/Muscat' })).toBe('Tue 27 Oct, 10:00–10:30 (Muscat time)');
  });

  it('a need is cleared by an edit to any of its fields; nothing else clears it', () => {
    const item = meeting('c1');
    item.needs = [
      { fields: ['attendeeIds'], message: 'No one matches “Bilaal”.' },
      { fields: ['date', 'time'], message: 'That time has passed.' },
    ];
    expect(remainingNeeds(item, {}).map((n) => n.message)).toEqual(['No one matches “Bilaal”.', 'That time has passed.']);
    expect(remainingNeeds(item, { title: 'Review 2' }).map((n) => n.message)).toEqual(['No one matches “Bilaal”.', 'That time has passed.']);
    expect(remainingNeeds(item, { time: '11:00' }).map((n) => n.message)).toEqual(['No one matches “Bilaal”.']);
    expect(remainingNeeds(item, { attendeeIds: ['u-bilal'], date: '2026-10-28' })).toEqual([]);
    // A need no edit can fix stays.
    item.needs = [{ fields: [], message: 'That edit couldn’t be used.' }];
    expect(remainingNeeds(item, { title: 'x' })).toHaveLength(1);
  });

  it('Confirm never includes a change that still needs putting right, even if it was ticked', () => {
    const blocked = meeting('c1');
    blocked.needs = [{ fields: ['attendeeIds'], message: 'No one matches “Bilaal”.' }];
    expect(confirmBody([blocked], { c1: true }, { c1: { title: 'Review 2' } }, true).items).toEqual([{ id: 'c1', include: false }]);
    expect(confirmBody([blocked], { c1: true }, { c1: { attendeeIds: ['u-bilal'] } }, true).items).toEqual([{ id: 'c1', include: true, edits: { attendeeIds: ['u-bilal'] } }]);
  });

  it('time left on Undo follows the server’s clock, not the device’s', () => {
    const serverNow = '2026-10-26T08:00:00.000Z';
    const undoUntil = '2026-10-26T08:15:00.000Z';
    // The device's clock is 10 minutes fast: it read the card at its 08:10 (the server's 08:00).
    const receivedAt = Date.parse('2026-10-26T08:10:00.000Z');
    expect(undoLeft(undoUntil, serverNow, receivedAt, receivedAt)).toBe(15 * 60_000);
    expect(undoLeft(undoUntil, serverNow, receivedAt, receivedAt + 60_000)).toBe(14 * 60_000);
    expect(undoLeft(null, serverNow, receivedAt, receivedAt)).toBe(0);
  });
});
