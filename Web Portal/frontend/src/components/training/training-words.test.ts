import { describe, expect, it } from 'vitest';
import { ACTION_WORDS, attemptsLeftText, cardChip, clockLeft, courseAction, dueText, learningGroups, lessonsText, minutesText, quizStartLine, ratingText, shortDay } from './training-words';
import { card, mine } from './training-fixtures';

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

  it('one Start / Continue / Review button (12 Nov)', () => {
    expect([ACTION_WORDS.start, ACTION_WORDS.resume, ACTION_WORDS.review]).toEqual(['Start', 'Continue', 'Review']);
  });

  it('a card’s one chip: overdue, done, due, the review or retake, else how far along; none before starting', () => {
    const now = new Date(2026, 10, 12);
    expect(cardChip(mine({ overdue: true, dueDay: '2026-11-09', status: 'IN_PROGRESS' }), now)).toEqual({ text: 'Overdue · was due 9 Nov', tone: 'overdue' });
    expect(cardChip(mine({ status: 'COMPLETED', progressPct: 100, dueDay: null }), now)).toEqual({ text: 'Done', tone: 'done' });
    expect(cardChip(mine({ dueDay: '2026-11-17', status: 'NOT_STARTED', progressPct: 0 }), now)).toEqual({ text: 'Due 17 Nov', tone: 'due' });
    expect(cardChip(mine({ dueDay: null, status: 'IN_PROGRESS', progressPct: 33 }), now)).toEqual({ text: '33% done', tone: 'progress' });
    expect(cardChip(mine({ dueDay: null, status: 'REVIEW', progressPct: 100 }), now)).toEqual({ text: 'Review the changes', tone: 'due' });
    expect(cardChip(mine({ dueDay: null, status: 'RETAKE', progressPct: 0 }), now)).toEqual({ text: 'Retake due', tone: 'due' });
    expect(cardChip(mine({ dueDay: null, status: 'NOT_STARTED', progressPct: 0, enrolled: false, assigned: false }), now)).toBeNull();
  });

  it('My learning: Up next is the most urgent (overdue, then nearest due day, then in progress, then not started); To do the rest in that order; Done; older certificates', () => {
    const notStarted = card({ id: 'ns', title: 'A not started', mine: mine({ status: 'NOT_STARTED', progressPct: 0, dueDay: null, mandatory: false }) });
    const inProgress = card({ id: 'ip', title: 'B in progress', mine: mine({ status: 'IN_PROGRESS', dueDay: null, assigned: false, mandatory: false }) });
    const dueLater = card({ id: 'dl', title: 'C due later', mine: mine({ dueDay: '2026-11-30' }) });
    const dueSoon = card({ id: 'ds', title: 'D due soon', mine: mine({ dueDay: '2026-11-15' }) });
    const overdue = card({ id: 'od', title: 'E overdue', mine: mine({ overdue: true, dueDay: '2026-11-09' }) });
    const cert = { id: 'cert1', code: 'TC-1', courseId: 'dn', courseTitle: 'F done', issuedAt: '2026-11-01T08:00:00.000Z', expiresAt: null, status: 'VALID' as const, completedAt: '2026-11-01T08:00:00.000Z', learnerName: 'Sam Shared', verifyUrl: 'https://tasks.example.com/verify/TC-1' };
    const old = { ...cert, id: 'cert0', courseId: 'gone', courseTitle: 'An archived course', status: 'EXPIRED' as const };
    const done = card({ id: 'dn', title: 'F done', mine: mine({ status: 'COMPLETED', progressPct: 100, certificate: cert }) });
    const g = learningGroups({ assigned: [notStarted, dueLater, overdue, dueSoon], inProgress: [inProgress], completed: [done], certificates: [cert, old] });
    expect(g.upNext?.id).toBe('od');
    expect(g.todo.map((c) => c.id)).toEqual(['ds', 'dl', 'ip', 'ns']);
    expect(g.done.map((c) => c.id)).toEqual(['dn']);
    expect(g.olderCertificates.map((c) => c.id)).toEqual(['cert0']);
    // Each course once (a course assigned and started is listed once).
    expect(learningGroups({ assigned: [dueSoon], inProgress: [dueSoon], completed: [], certificates: [] }).todo).toEqual([]);
    expect(learningGroups({ assigned: [], inProgress: [], completed: [], certificates: [] })).toEqual({ upNext: null, todo: [], done: [], olderCertificates: [] });
    // Review M5: a Done course whose only certificate is revoked: it shows under Older certificates (R6).
    const revoked = { ...cert, id: 'cert9', status: 'REVOKED' as const };
    const doneRevoked = card({ id: 'dn', title: 'F done', mine: mine({ status: 'COMPLETED', progressPct: 100, certificate: revoked }) });
    expect(learningGroups({ assigned: [], inProgress: [], completed: [doneRevoked], certificates: [revoked] }).olderCertificates.map((c) => c.id)).toEqual(['cert9']);
    // Waiting for a review or a retake: To do (R9).
    const review = card({ id: 'rv', mine: mine({ status: 'REVIEW', dueDay: null }) });
    expect(learningGroups({ assigned: [review], inProgress: [], completed: [], certificates: [] }).upNext?.id).toBe('rv');
  });

  it('the quiz’s one line: how many questions, the pass mark, tries and any time limit', () => {
    expect(quizStartLine({ questionCount: 5, passMark: 70, maxAttempts: null, attemptsUsed: 0, timeLimitMinutes: null })).toBe('5 questions · pass with 70% · try as often as you like');
    expect(quizStartLine({ questionCount: 3, passMark: 70, maxAttempts: null, attemptsUsed: 2, timeLimitMinutes: null })).toBe('3 questions · pass with 70% · try as often as you like');
    expect(quizStartLine({ questionCount: 1, passMark: 100, maxAttempts: 3, attemptsUsed: 2, timeLimitMinutes: 10 })).toBe('1 question · pass with 100% · 1 try left · 10 min to answer');
  });
});
