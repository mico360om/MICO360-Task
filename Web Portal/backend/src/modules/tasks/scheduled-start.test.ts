import { describe, it, expect } from 'vitest';
import { boardDayAfterStartEdit, isWaitingTask, newTaskBoardDay, notWaitingWhere, startsOnWords, waitingDayKey } from './scheduled-start';

const TZ = 'Asia/Muscat';
// 10:00 on 10 Nov 2026 in Muscat.
const NOW = new Date('2026-11-10T06:00:00Z');
const anchor = (key: string) => new Date(`${key}T12:00:00.000Z`);
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('newTaskBoardDay — where a new task lands (tasks scheduled for the future)', () => {
  it('no start date and no board day: today’s board', () => {
    expect(newTaskBoardDay({}, TZ, NOW)).toEqual(anchor('2026-11-10'));
  });

  it('a start date later than today: that day’s board (it waits)', () => {
    expect(newTaskBoardDay({ startDate: day('2026-11-20') }, TZ, NOW)).toEqual(anchor('2026-11-20'));
  });

  it('a start date today or earlier: today’s board', () => {
    expect(newTaskBoardDay({ startDate: day('2026-11-10') }, TZ, NOW)).toEqual(anchor('2026-11-10'));
    expect(newTaskBoardDay({ startDate: day('2026-11-01') }, TZ, NOW)).toEqual(anchor('2026-11-10'));
  });

  it('a board day given explicitly still wins', () => {
    expect(newTaskBoardDay({ startDate: day('2026-11-20'), boardDate: anchor('2026-11-18') }, TZ, NOW)).toEqual(anchor('2026-11-18'));
    expect(newTaskBoardDay({ startDate: day('2026-11-20'), boardDate: anchor('2026-11-10') }, TZ, NOW)).toEqual(anchor('2026-11-10'));
  });

  it('a start given as an instant is read on the company’s calendar', () => {
    // 21:00 UTC on 19 Nov is 01:00 on 20 Nov in Muscat.
    expect(newTaskBoardDay({ startDate: new Date('2026-11-19T21:00:00Z') }, TZ, NOW)).toEqual(anchor('2026-11-20'));
  });

  describe('time-zone edges (Asia/Muscat is UTC+4)', () => {
    it('just after midnight in Muscat (still yesterday in UTC): a start “today” is today, not tomorrow', () => {
      const justAfterMidnight = new Date('2026-11-10T20:30:00Z'); // 00:30 on 11 Nov in Muscat
      expect(newTaskBoardDay({ startDate: day('2026-11-11') }, TZ, justAfterMidnight)).toEqual(anchor('2026-11-11'));
      expect(waitingDayKey({ boardDate: anchor('2026-11-11') }, TZ, justAfterMidnight)).toBeNull();
    });

    it('late evening in Muscat: tomorrow’s start still waits for tomorrow', () => {
      const lateEvening = new Date('2026-11-10T19:30:00Z'); // 23:30 on 10 Nov in Muscat
      expect(newTaskBoardDay({ startDate: day('2026-11-11') }, TZ, lateEvening)).toEqual(anchor('2026-11-11'));
      expect(waitingDayKey({ boardDate: anchor('2026-11-11') }, TZ, lateEvening)).toBe('2026-11-11');
    });

    it('UTC company: the same instants fall on the UTC days', () => {
      const late = new Date('2026-11-10T23:30:00Z');
      expect(newTaskBoardDay({ startDate: day('2026-11-11') }, 'UTC', late)).toEqual(anchor('2026-11-11'));
      expect(waitingDayKey({ boardDate: anchor('2026-11-11') }, 'UTC', late)).toBe('2026-11-11');
      expect(waitingDayKey({ boardDate: anchor('2026-11-11') }, 'UTC', new Date('2026-11-11T00:00:01Z'))).toBeNull();
    });
  });
});

describe('boardDayAfterStartEdit — the edit rule', () => {
  const waiting = { boardDate: anchor('2026-11-20'), columnCategory: 'TODO', completedAt: null };
  const onToday = { boardDate: anchor('2026-11-10'), columnCategory: 'TODO', completedAt: null };

  it('a not-started task whose start moves later goes to that day’s board (it waits again)', () => {
    expect(boardDayAfterStartEdit(onToday, day('2026-11-25'), TZ, NOW)).toEqual(anchor('2026-11-25'));
    expect(boardDayAfterStartEdit(waiting, day('2026-11-25'), TZ, NOW)).toEqual(anchor('2026-11-25'));
    expect(boardDayAfterStartEdit({ ...onToday, columnCategory: 'BACKLOG' }, day('2026-11-25'), TZ, NOW)).toEqual(anchor('2026-11-25'));
  });

  it('a task already under way (or done) stays where it is', () => {
    for (const columnCategory of ['IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE']) {
      expect(boardDayAfterStartEdit({ ...onToday, columnCategory }, day('2026-11-25'), TZ, NOW)).toBeNull();
    }
    expect(boardDayAfterStartEdit({ ...onToday, completedAt: NOW }, day('2026-11-25'), TZ, NOW)).toBeNull();
    expect(boardDayAfterStartEdit({ ...onToday, approvalRequestedAt: NOW }, day('2026-11-25'), TZ, NOW)).toBeNull();
  });

  it('a waiting task whose start moves to today or earlier (or is cleared) comes onto today’s board', () => {
    expect(boardDayAfterStartEdit(waiting, day('2026-11-10'), TZ, NOW)).toEqual(anchor('2026-11-10'));
    expect(boardDayAfterStartEdit(waiting, day('2026-11-02'), TZ, NOW)).toEqual(anchor('2026-11-10'));
    expect(boardDayAfterStartEdit(waiting, null, TZ, NOW)).toEqual(anchor('2026-11-10'));
  });

  it('a task already on today’s (or a past) board stays when its start moves to today or earlier', () => {
    expect(boardDayAfterStartEdit(onToday, day('2026-11-05'), TZ, NOW)).toBeNull();
    expect(boardDayAfterStartEdit({ ...onToday, boardDate: anchor('2026-11-03') }, day('2026-11-05'), TZ, NOW)).toBeNull();
  });

  it('the same day again changes nothing', () => {
    expect(boardDayAfterStartEdit(waiting, day('2026-11-20'), TZ, NOW)).toBeNull();
  });
});

describe('waiting tasks', () => {
  it('waits while its board day is later than today and it isn’t done', () => {
    expect(isWaitingTask({ boardDate: anchor('2026-11-20') }, TZ, NOW)).toBe(true);
    expect(waitingDayKey({ boardDate: anchor('2026-11-20') }, TZ, NOW)).toBe('2026-11-20');
    expect(isWaitingTask({ boardDate: anchor('2026-11-10') }, TZ, NOW)).toBe(false);
    expect(isWaitingTask({ boardDate: null }, TZ, NOW)).toBe(false);
    expect(isWaitingTask({ boardDate: anchor('2026-11-20'), completedAt: NOW }, TZ, NOW)).toBe(false);
  });

  it('the database filter keeps today’s and earlier board days (and tasks without one)', () => {
    expect(notWaitingWhere(TZ, NOW)).toEqual({ OR: [{ boardDate: null }, { boardDate: { lt: new Date('2026-11-11T00:00:00.000Z') } }] });
  });

  it('says the start day the site’s way', () => {
    expect(startsOnWords('2026-11-20', NOW, TZ)).toBe('starts 20 Nov');
    expect(startsOnWords('2027-01-04', NOW, TZ)).toBe('starts 4 Jan 2027');
  });
});
