import { MODULE_LABELS, type CertificateRef, type CourseCard, type CourseDetail, type LessonOutline, type ModuleOutline, type MyCourseState, type TrainingModule } from '../../api/training';
import { instantDayText } from '../../lib/day-words';
import { minutesText } from './training-words';

/**
 * The learning dashboard's rules (13 Nov new look; pure, tested): the one main button, "About N min left", which module
 * is next ("Module 2 of 8"), what the certificate card says, and which course fills the dashboard. Everything counts
 * only what the server gives the person: `CourseDetail.modules` / `lessons` never hold a module hidden from them.
 */

export type MainAction = 'start' | 'continue' | 'review';

export const MAIN_ACTION_WORDS: Record<MainAction, string> = { start: 'Start', continue: 'Continue', review: 'Review' };

/**
 * The one main button: Start when nothing is done, Continue when part done (or modules are new for their role), Review
 * when the course is finished (a review of changed lessons too: the chip says "Review the changes"). A retake starts
 * again: Start until a lesson of the new round is done.
 */
export function mainAction(mine: Pick<MyCourseState, 'enrolled' | 'status' | 'progressPct' | 'lessonsDone' | 'newForRole'>): MainAction {
  if (mine.status === 'COMPLETED') return mine.newForRole > 0 ? 'continue' : 'review';
  if (mine.status === 'REVIEW') return 'review';
  if (!mine.enrolled || mine.status === 'NOT_STARTED') return 'start';
  if (mine.status === 'RETAKE' && mine.progressPct === 0 && mine.lessonsDone === 0) return 'start';
  return 'continue';
}

/** "About 1 h 10 min left" (the unfinished minutes, rounded to 5), "Under 5 min left", or null when nothing is left. */
export function minutesLeftText(lessons: readonly { minutes: number; done: boolean }[]): string | null {
  const left = lessons.reduce((sum, l) => (l.done ? sum : sum + Math.max(0, l.minutes)), 0);
  if (left <= 0) return null;
  if (left < 5) return 'Under 5 min left';
  return `About ${minutesText(Math.round(left / 5) * 5)} left`;
}

/** The person's lessons still to do: not done, and not in a module already done (a lesson added to it later isn't "left"). */
export function lessonsLeft(course: Pick<CourseDetail, 'lessons' | 'modules'>): LessonOutline[] {
  const inDone = new Set(course.modules.filter((m) => m.status === 'DONE').flatMap((m) => m.lessonIds));
  return course.lessons.filter((l) => !l.done && !inDone.has(l.id));
}

/**
 * Up next's module, "Module N of M" (`index` from 0): the module the resume lesson is in, among the person's modules
 * ("Other lessons" too — its lessons have no moduleId, so the module's own list decides); none on a plain course, and
 * none once every module is done (a review of changed lessons still points at the module to look at).
 */
export function upNextModule(course: Pick<CourseDetail, 'modules' | 'resumeLessonId'> & { mine: Pick<MyCourseState, 'status'> }): { index: number; total: number; module: ModuleOutline } | null {
  const mods = course.modules;
  if (!mods.length) return null;
  if (course.mine.status !== 'REVIEW' && mods.every((m) => m.status === 'DONE')) return null;
  const resume = course.resumeLessonId;
  let index = resume ? mods.findIndex((m) => m.lessonIds.includes(resume)) : -1;
  if (index < 0) index = mods.findIndex((m) => m.status !== 'DONE');
  return index < 0 ? null : { index, total: mods.length, module: mods[index]! };
}

/** A module's name → its feature (the starter modules carry their feature's name; "Getting started" is the general one). */
const KEY_BY_TITLE: ReadonlyMap<string, TrainingModule> = new Map([
  ...(Object.entries(MODULE_LABELS) as [TrainingModule, string][]).map(([key, label]) => [label.toLowerCase(), key] as const),
  ['getting started', 'general'],
]);

const plainTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * A module's feature, for its icon (`ModuleIcon`): the server's `moduleKey` (the feature it teaches, whatever it is
 * called). Without one — "Other lessons", or only a name to go on (a list card's "next" module) — the name says it (the
 * starter modules are named after their feature); otherwise none (a neutral book). General is no feature's icon (13 Nov
 * ruling): a General module is the book (an administrator's own module takes the course's General), except Getting
 * started, which is the brand mark (`general`).
 */
export function moduleKeyOf(m: Pick<ModuleOutline, 'id' | 'title'> & { moduleKey?: ModuleOutline['moduleKey'] }): TrainingModule | null {
  const key = m.moduleKey || (m.id === 'other' ? null : (KEY_BY_TITLE.get(plainTitle(m.title)) ?? null));
  return key === 'general' && plainTitle(m.title) !== 'getting started' ? null : key;
}

/**
 * A course's icon (All courses' cards, Manage's list): the one course — the built-in General course, "MICO360 Tasks
 * User Training" — the brand mark (`general`); any other General course the book (null); else its feature.
 */
export function courseIconKey(c: { starter: boolean; moduleKey: TrainingModule }): TrainingModule | null {
  if (c.moduleKey !== 'general') return c.moduleKey;
  return c.starter ? 'general' : null;
}

/** "16 Nov" this year, "16 Nov 2025" another (an instant, in the device's zone). */
export function shortInstantDay(iso: string, now: Date = new Date()): string {
  return instantDayText(iso, undefined, { year: new Date(iso).getFullYear() !== now.getFullYear() });
}

export type CertificateState =
  | { kind: 'none' }
  | { kind: 'before'; left: number; unit: 'module' | 'lesson' | 'quiz' }
  | { kind: 'ready'; certificate: CertificateRef }
  | { kind: 'updated'; certificate: CertificateRef | null };

const usable = (c: CertificateRef | null): CertificateRef | null => (c && c.status !== 'REVOKED' ? c : null);

/**
 * The certificate card: before finishing, what is left (the person's modules; a plain course's lessons, or its quizzes
 * when passing them finishes it); ready once finished; "updated" when modules new for their role came after. A course
 * without a certificate, or a finished one whose certificate was withdrawn: none.
 */
export function certificateState(course: Pick<CourseDetail, 'certificateOn' | 'completionRule' | 'lessons'> & { mine: Pick<MyCourseState, 'status' | 'certificate' | 'modules' | 'newForRole'> }): CertificateState {
  const m = course.mine;
  const cert = usable(m.certificate);
  if (!course.certificateOn && !cert) return { kind: 'none' };
  const finished = m.status === 'COMPLETED' || m.status === 'REVIEW';
  if (finished && m.newForRole > 0) return { kind: 'updated', certificate: cert };
  if (finished) return cert ? { kind: 'ready', certificate: cert } : { kind: 'none' };
  if (m.modules) return { kind: 'before', left: Math.max(0, m.modules.total - m.modules.done), unit: 'module' };
  const quizzes = course.lessons.filter((l) => l.kind === 'QUIZ');
  if (course.completionRule === 'QUIZZES' && quizzes.length) return { kind: 'before', left: quizzes.filter((l) => !l.done).length, unit: 'quiz' };
  return { kind: 'before', left: course.lessons.filter((l) => !l.done).length, unit: 'lesson' };
}

const PLURAL = { module: ['module', 'modules'], lesson: ['lesson', 'lessons'], quiz: ['quiz', 'quizzes'] } as const;

/** The certificate card's line. */
export function certificateWords(s: CertificateState): string {
  if (s.kind === 'ready') return 'Certificate ready';
  if (s.kind === 'updated') return 'Finish the new modules for an updated certificate';
  if (s.kind === 'before') return `${s.unit === 'quiz' ? 'Pass' : 'Finish'} ${s.left} more ${PLURAL[s.unit][s.left === 1 ? 0 : 1]} to get it`;
  return '';
}

/**
 * Which course fills the dashboard: the Up next course (today's rule); with nothing open, a finished course with modules
 * new for the person's role (it is Up next again); else, everything done, the course with modules (else the first done)
 * — "All done". Null: no training at all.
 */
export function dashboardFocus(g: { upNext: CourseCard | null; done: CourseCard[] }): { course: CourseCard; allDone: boolean } | null {
  if (g.upNext) return { course: g.upNext, allDone: false };
  const grown = g.done.find((c) => c.mine.newForRole > 0);
  if (grown) return { course: grown, allDone: false };
  const main = g.done.find((c) => c.mine.modules) ?? g.done[0];
  return main ? { course: main, allDone: true } : null;
}
