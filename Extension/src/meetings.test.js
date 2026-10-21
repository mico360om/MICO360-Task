import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isUnderWay, nextUpMeeting, startsLabel, groupMeetings, upcomingGroups, formatMeetingDay, formatMeetingTimes, formatClockTime,
  safeJoinLink, myInvitation, canAnswer, ANSWERS, answerAfterTap, responseSummary, responseLine, myAnswerText, meetingRepeatText,
  meetingStatusLabel, responseLabel, meetingWebUrl, meetingPlace, answersFor,
} from './meetings.js';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T06:30:00.000Z'); // 10:30 in Muscat
const meeting = (id, startAt, over = {}) => ({
  id, title: `Meeting ${id}`, status: 'SCHEDULED', startAt, endAt: null, projectId: null, organizerId: 'u2', location: null, onlineLink: null,
  recurrenceRule: null, recurrenceParentId: null, updatedAt: '2026-10-01T00:00:00Z', ...over,
});

describe('meetings: when', () => {
  it('under way, or the next one to come — never a draft, cancelled or finished meeting', () => {
    const live = meeting('live', '2026-10-21T06:00:00.000Z'); // started 30 min ago, no end: an hour
    const soon = meeting('soon', '2026-10-21T08:00:00.000Z');
    expect(isUnderWay(live, NOW)).toBe(true);
    expect(nextUpMeeting([soon, live], NOW).id).toBe('live');
    expect(nextUpMeeting([soon, meeting('d', '2026-10-21T07:00:00.000Z', { status: 'DRAFT' }), meeting('c', '2026-10-21T07:00:00.000Z', { status: 'CANCELLED' })], NOW).id).toBe('soon');
    expect(nextUpMeeting([meeting('old', '2026-10-20T06:00:00.000Z')], NOW)).toBeNull();
  });

  it('says when it starts in words, as the web does', () => {
    expect(startsLabel(meeting('a', '2026-10-21T06:00:00.000Z'), NOW, TZ)).toBe('Happening now');
    expect(startsLabel(meeting('b', '2026-10-21T06:55:00.000Z'), NOW, TZ)).toBe('in 25 min');
    expect(startsLabel(meeting('c', '2026-10-22T06:00:00.000Z'), NOW, TZ)).toBe(`Tomorrow at ${formatClockTime('2026-10-22T06:00:00.000Z', TZ)}`);
  });

  it('the upcoming ones in Today, Next 7 days and Later (drafts and past ones stay on the website)', () => {
    const list = [
      meeting('later', '2026-11-20T06:00:00.000Z'), meeting('today', '2026-10-21T10:00:00.000Z'), meeting('week', '2026-10-24T06:00:00.000Z'),
      meeting('past', '2026-10-01T06:00:00.000Z'), meeting('draft', '2026-10-25T06:00:00.000Z', { status: 'DRAFT' }),
    ];
    const groups = upcomingGroups(list, { timeZone: TZ, now: NOW });
    expect(groups.map((g) => [g.label, g.items.map((m) => m.id)])).toEqual([['Today', ['today']], ['Next 7 days', ['week']], ['Later', ['later']]]);
    expect(groupMeetings(list, { timeZone: TZ, now: NOW }, 'date').map((g) => g.key)).toEqual(['today', 'next7', 'later', 'drafts', 'past']);
  });

  it('a repeating meeting says how it repeats', () => {
    expect(meetingRepeatText({ freq: 'WEEKLY', interval: 1, weekdays: [2] }, '2026-10-20T06:00:00.000Z', TZ)).toMatch(/^Repeats every week on Tue/);
  });
});

describe('meetings: where, and Join', () => {
  it('Join opens only a secure web link (https)', () => {
    expect(safeJoinLink('https://meet.example.com/abc')).toBe('https://meet.example.com/abc');
    expect(safeJoinLink('meet.google.com/abc-defg')).toBe('https://meet.google.com/abc-defg'); // typed without https
    expect(safeJoinLink('http://meet.example.com/abc')).toBeNull();
    expect(safeJoinLink('javascript:alert(1)')).toBeNull();
    expect(safeJoinLink('data:text/html,hi')).toBeNull();
    expect(safeJoinLink('https://intranet/x')).toBeNull(); // no real host
    expect(safeJoinLink('')).toBeNull();
    expect(safeJoinLink(null)).toBeNull();
  });

  it('the place, else “Online” for a meeting with a link', () => {
    expect(meetingPlace({ location: 'Room 2', onlineLink: 'https://x.example' })).toBe('Room 2');
    expect(meetingPlace({ location: null, onlineLink: 'https://x.example' })).toBe('Online');
    expect(meetingPlace({ location: null, onlineLink: null })).toBeNull();
  });

  it('the meeting on the website: its page, with its id encoded', () => {
    expect(meetingWebUrl('https://task.mico360.com/', 'a/b')).toBe('https://task.mico360.com/meetings/a%2Fb');
    expect(meetingWebUrl('', 'm1')).toBeNull();
  });

  it('statuses and answers in the web’s words (a newer server’s word in plain words)', () => {
    expect(meetingStatusLabel('IN_PROGRESS')).toBe('In Progress');
    expect(meetingStatusLabel('ON_HOLD')).toBe('On hold');
    expect(responseLabel('TENTATIVE')).toBe('Maybe');
    expect(responseLabel(undefined)).toBe('No response');
  });
});

describe('meetings: your answer', () => {
  const people = [
    { id: 'a1', userId: 'me', response: 'PENDING' }, { id: 'a2', userId: 'u2', response: 'ACCEPTED' },
    { id: 'a3', userId: null, externalName: 'Guest', response: 'DECLINED' }, { id: 'a4', userId: 'u3' },
  ];

  it('your own row, whether it can still be answered, and Accept / Maybe / Decline in the web’s order', () => {
    expect(myInvitation(people, 'me').id).toBe('a1');
    expect(myInvitation(people, 'nobody')).toBeNull();
    expect(canAnswer({ status: 'SCHEDULED' })).toBe(true);
    expect(canAnswer({ status: 'CANCELLED' })).toBe(false);
    expect(canAnswer({ status: 'COMPLETED' })).toBe(false);
    expect(ANSWERS.map((a) => a.label)).toEqual(['Accept', 'Maybe', 'Decline']);
  });

  it('tapping your answer again takes it back', () => {
    expect(answerAfterTap('PENDING', 'ACCEPTED')).toBe('ACCEPTED');
    expect(answerAfterTap('ACCEPTED', 'ACCEPTED')).toBe('PENDING');
    expect(answerAfterTap(undefined, 'DECLINED')).toBe('DECLINED');
  });

  it('who is coming, in one line, and your answer in words', () => {
    expect(responseLine(responseSummary(people))).toBe('1 accepted · 0 maybe · 1 declined · 2 no response');
    expect(myAnswerText('ACCEPTED')).toBe('You’re going.');
    expect(myAnswerText('TENTATIVE')).toBe('You might go.');
    expect(myAnswerText('DECLINED')).toBe('You’re not going.');
    expect(myAnswerText('PENDING')).toBe('You haven’t answered yet.');
  });

  it('your answers on a list of meetings: each meeting’s people read, yours picked out', () => {
    const answers = answersFor([{ meetingId: 'm1', people }, { meetingId: 'm2', people: [{ id: 'z', userId: 'u2' }] }, { meetingId: 'm3', people: null }], 'me');
    expect(answers).toEqual(new Map([['m1', { attendeeId: 'a1', response: 'PENDING' }]]));
  });
});

// Copies of the web's rules (lib/meeting-list.ts, meetingFormat.ts, meeting-repeat.ts, meeting-flow.ts).
const WEB = resolve(__dirname, '../../Web Portal/frontend/src/lib');
const load = async (name) => (existsSync(resolve(WEB, name)) ? import(pathToFileURL(resolve(WEB, name)).href) : null);
const webList = await load('meeting-list.ts');
const webFormat = await load('meetingFormat.ts');
const webRepeat = await load('meeting-repeat.ts');
const webFlow = await load('meeting-flow.ts');

describe.skipIf(!webList || !webFormat || !webRepeat || !webFlow)('meetings match the web’s (lib/meeting-*.ts, meetingFormat.ts)', () => {
  const STARTS = ['2026-10-21T06:00:00.000Z', '2026-10-21T06:45:00.000Z', '2026-10-21T19:59:00.000Z', '2026-10-22T03:00:00.000Z', '2026-10-25T10:00:00.000Z', '2026-11-30T23:00:00.000Z', '2026-10-01T06:00:00.000Z'];
  const NOWS = ['2026-10-21T06:30:00.000Z', '2026-10-21T19:30:00.000Z', '2026-12-31T21:00:00.000Z'].map((s) => new Date(s));
  const list = STARTS.flatMap((s, i) => [
    meeting(`m${i}`, s, { endAt: i % 2 ? null : new Date(Date.parse(s) + 5400000).toISOString(), updatedAt: `2026-10-0${(i % 9) + 1}T00:00:00Z` }),
    meeting(`d${i}`, s, { status: ['DRAFT', 'IN_PROGRESS', 'CANCELLED', 'COMPLETED'][i % 4] }),
  ]);

  it('the same “when”, next meeting and groups', () => {
    for (const now of NOWS) {
      for (const tz of [TZ, 'UTC', 'America/Los_Angeles']) {
        for (const m of list) {
          expect(isUnderWay(m, now)).toBe(webList.isUnderWay(m, now));
          expect(startsLabel(m, now, tz), `${m.startAt} ${tz} ${now.toISOString()}`).toBe(webList.startsLabel(m, now, tz));
        }
        for (const sort of ['date', 'title', 'updated']) expect(groupMeetings(list, { timeZone: tz, now }, sort)).toEqual(webList.groupMeetings(list, { timeZone: tz, now }, sort));
      }
      expect(nextUpMeeting(list, now)).toEqual(webList.nextUpMeeting(list, now));
    }
  });

  it('the same days and times', () => {
    for (const m of list) {
      for (const tz of [TZ, 'UTC', 'Pacific/Kiritimati']) {
        expect(formatMeetingDay(m.startAt, tz)).toBe(webFormat.formatMeetingDay(m.startAt, tz));
        expect(formatMeetingTimes(m.startAt, m.endAt, tz)).toBe(webFormat.formatMeetingTimes(m.startAt, m.endAt, tz));
        expect(formatClockTime(m.startAt, tz)).toBe(webFormat.formatClockTime(m.startAt, tz));
      }
    }
  });

  it('a Join link only where the web would make one — and only https', () => {
    for (const link of ['https://meet.example.com/a', 'meet.example.com/a', 'http://meet.example.com/a', 'HTTPS://Meet.Example.com/A', ' https://x.example ', 'ftp://x.example', 'javascript:x', 'localhost:3000/x', 'https://localhost/x', '//x.example/a', '']) {
      const web = webFormat.safeMeetingHref(link);
      const mine = safeJoinLink(link);
      if (mine) expect(mine, link).toBe(web);
      expect(mine, link).toBe(web && web.startsWith('https:') ? web : null);
    }
  });

  it('the same repeat words and answer counts', () => {
    const rules = [{ freq: 'DAILY', interval: 1 }, { freq: 'WEEKLY', interval: 2, weekdays: [1, 3] }, { freq: 'WEEKLY', interval: 1 }, { freq: 'MONTHLY', interval: 1, dayOfMonth: 15, count: 6 }, { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 }, until: '2027-03-31' }];
    for (const rule of rules) for (const s of STARTS) for (const tz of [TZ, 'UTC']) expect(meetingRepeatText(rule, s, tz)).toBe(webRepeat.meetingRepeatText(rule, s, tz));
    const people = [{ response: 'ACCEPTED' }, {}, { response: 'DECLINED' }, { response: 'TENTATIVE' }, { response: 'PENDING' }];
    expect(responseSummary(people)).toEqual(webFlow.responseSummary(people));
  });
});
