import { describe, expect, it } from 'vitest';
import { attemptsLeftText, clockLeft, courseAction, dueText, lessonsText, minutesText, ratingText, shortDay } from './training-words';

describe('training words', () => {
  it('minutes: "5 min", "1 h", "1 h 25 min"; nothing for none', () => {
    expect(minutesText(5)).toBe('5 min');
    expect(minutesText(60)).toBe('1 h');
    expect(minutesText(85)).toBe('1 h 25 min');
    expect(minutesText(0)).toBe('');
    expect(lessonsText(1)).toBe('1 lesson');
    expect(lessonsText(6)).toBe('6 lessons');
  });

  it('due days the site’s way, the year only when it isn’t this year’s', () => {
    const now = new Date(2026, 10, 11);
    expect(shortDay('2026-11-14', now)).toBe('14 Nov');
    expect(shortDay('2027-01-03', now)).toBe('3 Jan 2027');
    expect(dueText({ dueDay: '2026-11-14' }, now)).toBe('Due 14 Nov');
    expect(dueText({ dueDay: null }, now)).toBeNull();
  });

  it('ratings', () => {
    expect(ratingText({ average: null, count: 0 })).toBe('No ratings yet');
    expect(ratingText({ average: 4, count: 1 })).toBe('4 · 1 rating');
    expect(ratingText({ average: 4.25, count: 12 })).toBe('4.3 · 12 ratings');
  });

  it('the course page’s main button follows where the person is', () => {
    expect(courseAction({ enrolled: false, status: 'NOT_STARTED', progressPct: 0 })).toBe('start');
    expect(courseAction({ enrolled: true, status: 'NOT_STARTED', progressPct: 0 })).toBe('start');
    expect(courseAction({ enrolled: true, status: 'IN_PROGRESS', progressPct: 40 })).toBe('resume');
    expect(courseAction({ enrolled: true, status: 'COMPLETED', progressPct: 100 })).toBe('review');
    expect(courseAction({ enrolled: true, status: 'REVIEW', progressPct: 80 })).toBe('changes');
    expect(courseAction({ enrolled: true, status: 'RETAKE', progressPct: 0 })).toBe('retake');
  });

  it('a countdown and attempts', () => {
    expect(clockLeft(125_000)).toBe('2:05');
    expect(clockLeft(3_725_000)).toBe('1:02:05');
    expect(clockLeft(-5)).toBe('0:00');
    expect(attemptsLeftText(null, 4)).toBe('Unlimited attempts');
    expect(attemptsLeftText(3, 2)).toBe('1 attempt left');
    expect(attemptsLeftText(3, 3)).toBe('No attempts left');
  });
});
