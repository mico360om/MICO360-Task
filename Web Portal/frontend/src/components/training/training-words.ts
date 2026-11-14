import type { CertificateRef, CertificateStatus, CourseCard, Difficulty, EnrolmentStatus, LessonKind, ModuleOutline, MyCourseState, MyTraining } from '../../api/training';
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

/** "1 module", "8 modules". */
export const modulesText = (n: number) => `${n} ${n === 1 ? 'module' : 'modules'}`;

/**
 * How far along (1.23.30 review: in lessons, not a percentage): "0 of 3 lessons"; the one course with modules:
 * "4 of 8 modules" (only the modules the person sees).
 */
export function progressWords(c: Pick<CourseCard, 'lessonCount'> & { mine: Pick<MyCourseState, 'lessonsDone' | 'modules'> }): string {
  const m = c.mine.modules;
  if (m) return `${m.done} of ${modulesText(m.total)}`;
  return `${c.mine.lessonsDone} of ${lessonsText(c.lessonCount)}`;
}

/** D3: "New for your role: 2" (modules added for a grown role after the course was finished). */
export const newForRoleText = (n: number) => `New for your role: ${n}`;

/** A module's state for the person: "Not started", "In progress · 2 of 5 lessons", "Done · 3 Nov 2026". */
export function moduleStatusWords(m: Pick<ModuleOutline, 'status' | 'lessonsDone' | 'lessonCount' | 'doneAt'>): string {
  if (m.status === 'DONE') return m.doneAt ? `Done · ${instantDayText(m.doneAt)}` : 'Done';
  if (m.status === 'IN_PROGRESS') return `In progress · ${m.lessonsDone} of ${lessonsText(m.lessonCount)}`;
  return 'Not started';
}

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

/**
 * What the course page's (and a card's) main button does, by where the person is. D3: a finished course with modules
 * new for the person's grown role stays Completed, and its button is Continue (to the first of them).
 */
export function courseAction(mine: Pick<MyCourseState, 'enrolled' | 'status' | 'progressPct'> & Partial<Pick<MyCourseState, 'newForRole'>>): CourseAction {
  if (mine.status === 'RETAKE') return 'retake';
  if (mine.status === 'REVIEW') return 'changes';
  if (mine.status === 'COMPLETED') return (mine.newForRole ?? 0) > 0 ? 'resume' : 'review';
  if (!mine.enrolled || (mine.status === 'NOT_STARTED' && mine.progressPct === 0)) return 'start';
  return 'resume';
}

export type ChipTone = 'overdue' | 'due' | 'done';

/**
 * A course card's one chip (12 Nov §3): "Overdue · was due 9 Nov", "Done", "Due 17 Nov", "Review the changes" or
 * "Retake due"; none otherwise — how far along is said in lessons beside it (progressWords, 1.23.30 review).
 */
export function cardChip(m: Pick<MyCourseState, 'status' | 'overdue' | 'dueDay'>, now: Date = new Date()): { text: string; tone: ChipTone } | null {
  if (m.status !== 'COMPLETED' && m.overdue && m.dueDay) return { text: `Overdue · was due ${shortDay(m.dueDay, now)}`, tone: 'overdue' };
  if (m.status === 'COMPLETED') return { text: 'Done', tone: 'done' };
  if (m.dueDay) return { text: `Due ${shortDay(m.dueDay, now)}`, tone: 'due' };
  if (m.status === 'REVIEW') return { text: 'Review the changes', tone: 'due' };
  if (m.status === 'RETAKE') return { text: 'Retake due', tone: 'due' };
  return null;
}

/** How urgent a course is (12 Nov §2): overdue, then the nearest due day, then started, then not started. */
function urgency(c: CourseCard): number {
  const m = c.mine;
  if (m.overdue) return 0;
  if (m.dueDay) return 1;
  if (m.status !== 'NOT_STARTED') return 2;
  return 3;
}

export function byUrgency(a: CourseCard, b: CourseCard): number {
  return (
    urgency(a) - urgency(b) ||
    (a.mine.dueDay ?? '9999-99-99').localeCompare(b.mine.dueDay ?? '9999-99-99', 'en') ||
    Number(b.mine.mandatory) - Number(a.mine.mandatory) ||
    a.title.localeCompare(b.title, 'en')
  );
}

/**
 * My learning (12 Nov §2, R6, R9): "Up next" — the most urgent course; "To do" — the rest, in the same order (a
 * review or retake too); "Done"; and the certificates no Done card carries ("Older certificates"). Each course once.
 * 1.23.34: with nothing open, the built-in course the server offers (`suggested`: optional, not finished) is Up next —
 * after a finished course with modules new for the person's role (dashboardFocus puts that one first); while anything
 * else is open it isn't listed here (it stays in All courses).
 */
export function learningGroups(d: Pick<MyTraining, 'assigned' | 'inProgress' | 'completed' | 'certificates' | 'suggested'>): { upNext: CourseCard | null; todo: CourseCard[]; done: CourseCard[]; olderCertificates: CertificateRef[] } {
  const seen = new Set<string>();
  const open = [...d.assigned, ...d.inProgress].filter((c) => c.mine.status !== 'COMPLETED' && !seen.has(c.id) && (seen.add(c.id), true)).sort(byUrgency);
  const done = d.completed.filter((c) => !seen.has(c.id) && (seen.add(c.id), true));
  const onCards = new Set(done.map((c) => (c.mine.certificate && c.mine.certificate.status !== 'REVOKED' ? c.mine.certificate.id : null)).filter((id): id is string => !!id));
  const s = d.suggested;
  const offered = s && !open.length && !seen.has(s.id) && (s.mine.status === 'NOT_STARTED' || s.mine.status === 'IN_PROGRESS') && !done.some((c) => c.mine.newForRole > 0) ? s : null;
  return { upNext: open[0] ?? offered, todo: open.slice(1), done, olderCertificates: d.certificates.filter((c) => !onCards.has(c.id)) };
}

/** The quiz's one line (12 Nov §5): "5 questions · pass with 70% · try as often as you like". */
export function quizStartLine(q: { questionCount: number; passMark: number; maxAttempts: number | null; attemptsUsed: number; timeLimitMinutes: number | null }): string {
  const left = q.maxAttempts === null ? null : Math.max(0, q.maxAttempts - q.attemptsUsed);
  return [
    questionsText(q.questionCount),
    `pass with ${q.passMark}%`,
    left === null ? 'try as often as you like' : `${left} ${left === 1 ? 'try' : 'tries'} left`,
    ...(q.timeLimitMinutes ? [`${minutesText(q.timeLimitMinutes)} to answer`] : []),
  ].join(' · ');
}

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
