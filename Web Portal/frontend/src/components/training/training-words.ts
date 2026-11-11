import type { CertificateStatus, Difficulty, EnrolmentStatus, LessonKind, MyCourseState } from '../../api/training';
import { dayText, instantDayText } from '../../lib/day-words';

/** Training's words, in one place (pure, tested). Dates the site's way: "14 Nov", "14 Nov 2027" (another year). */

export const DIFFICULTY_WORDS: Record<Difficulty, string> = { BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced' };

export const LESSON_KIND_WORDS: Record<LessonKind, string> = { VIDEO: 'Video', GUIDE: 'Step-by-step guide', DOCUMENT: 'Document', QUIZ: 'Quiz' };

export const STATUS_WORDS: Record<EnrolmentStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  REVIEW: 'Review the changes',
  RETAKE: 'Retake due',
};

export const CERTIFICATE_WORDS: Record<CertificateStatus, string> = { VALID: 'Valid', EXPIRED: 'Expired', REVOKED: 'Revoked' };

/** "5 min", "1 h", "1 h 25 min"; '' for none. */
export function minutesText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "1 lesson", "6 lessons". */
export const lessonsText = (n: number) => `${n} ${n === 1 ? 'lesson' : 'lessons'}`;

/** A day ('YYYY-MM-DD') without the year when it is this year's: "14 Nov"; "14 Nov 2027". */
export function shortDay(key: string, now: Date = new Date()): string {
  return dayText(key, { year: key.slice(0, 4) !== String(now.getFullYear()) });
}

/** An instant's day in the device's zone: "3 Nov 2026". */
export const instantDay = (iso: string) => instantDayText(iso);

/** "Due 14 Nov" (null without a due day). */
export function dueText(mine: Pick<MyCourseState, 'dueDay'>, now: Date = new Date()): string | null {
  return mine.dueDay ? `Due ${shortDay(mine.dueDay, now)}` : null;
}

/** "4.5 · 12 ratings", "No ratings yet". */
export function ratingText(rating: { average: number | null; count: number }): string {
  if (!rating.count || rating.average === null) return 'No ratings yet';
  return `${rating.average.toFixed(1).replace(/\.0$/, '')} · ${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}`;
}

export type CourseAction = 'start' | 'resume' | 'review' | 'changes' | 'retake';

/** What the course page's main button does, by where the person is. */
export function courseAction(mine: Pick<MyCourseState, 'enrolled' | 'status' | 'progressPct'>): CourseAction {
  if (mine.status === 'RETAKE') return 'retake';
  if (mine.status === 'REVIEW') return 'changes';
  if (mine.status === 'COMPLETED') return 'review';
  if (!mine.enrolled || (mine.status === 'NOT_STARTED' && mine.progressPct === 0)) return 'start';
  return 'resume';
}

export const ACTION_WORDS: Record<CourseAction, string> = {
  start: 'Start course',
  resume: 'Resume',
  review: 'Review course',
  changes: 'Review the changes',
  retake: 'Retake course',
};

/** "2:05" for a countdown (minutes:seconds; hours when needed: "1:02:05"). */
export function clockLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "1 attempt left", "Unlimited attempts" (null = unlimited). */
export function attemptsLeftText(max: number | null, used: number): string {
  if (max === null) return 'Unlimited attempts';
  const left = Math.max(0, max - used);
  return left === 0 ? 'No attempts left' : `${left} ${left === 1 ? 'attempt' : 'attempts'} left`;
}

/** "1 question", "8 questions". */
export const questionsText = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;
