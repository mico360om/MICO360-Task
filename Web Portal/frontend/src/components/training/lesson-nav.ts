import type { CourseDetail, LessonKind, TrainingModule } from '../../api/training';
import { courseIconKey, moduleKeyOf } from './dashboard-rules';

/**
 * Where a lesson sits and what comes next (1.23.36, "Lesson + module outline"; pure, tested). Read from the course's
 * outline as the server gives it to the person: only their modules and lessons — a hidden module, or a lesson hidden
 * from learners (a video waiting for its link), is not in it, so it never shows or counts here.
 */

export interface OutlineItem {
  id: string;
  title: string;
  kind: LessonKind;
  minutes: number;
  done: boolean;
  /** The lesson open now. */
  current: boolean;
  /** An in-order course's lesson after one not done (never the open one): it can't be opened yet. */
  locked: boolean;
  /** Changed by a Major change since they finished it. */
  review: boolean;
}

export interface LessonOutlineModel {
  /** A module's lessons, or (a course without modules) the course's. */
  scope: 'module' | 'course';
  /** The module's id (null for a course without modules). */
  moduleId: string | null;
  /** The module's title, or the course's. */
  title: string;
  /** Its icon (the module's feature; the one course the brand mark; null the book). */
  moduleKey: TrainingModule | null;
  /** The module's place among the person's own modules (1-based); 0 for a course without modules. */
  number: number;
  items: OutlineItem[];
  done: number;
  total: number;
  /** The open lesson's place in `items` (0-based). */
  at: number;
}

/** The outline beside a lesson: its module's lessons (or the course's); null when the lesson isn't in it. */
export function lessonOutline(course: CourseDetail, lessonId: string): LessonOutlineModel | null {
  const byId = new Map(course.lessons.map((l) => [l.id, l]));
  let scope: LessonOutlineModel['scope'];
  let ids: string[];
  let head: Pick<LessonOutlineModel, 'moduleId' | 'title' | 'moduleKey' | 'number'>;
  if (course.modules.length) {
    const i = course.modules.findIndex((m) => m.lessonIds.includes(lessonId));
    const m = course.modules[i];
    if (!m) return null;
    scope = 'module';
    ids = m.lessonIds;
    head = { moduleId: m.id, title: m.title, moduleKey: moduleKeyOf(m), number: i + 1 };
  } else {
    scope = 'course';
    ids = course.lessons.map((l) => l.id);
    head = { moduleId: null, title: course.title, moduleKey: courseIconKey(course), number: 0 };
  }
  const items: OutlineItem[] = ids
    .map((id) => byId.get(id))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => ({ id: l.id, title: l.title, kind: l.kind, minutes: l.minutes, done: l.done, current: l.id === lessonId, locked: l.locked && l.id !== lessonId, review: l.review }));
  const at = items.findIndex((l) => l.current);
  if (at < 0) return null;
  return { scope, ...head, items, done: items.filter((l) => l.done).length, total: items.length, at };
}

/** The panel's heading: "In this module", or "In this course" for a course without modules. */
export const outlineHeading = (o: Pick<LessonOutlineModel, 'scope'>) => (o.scope === 'module' ? 'In this module' : 'In this course');

/** The phone's button that opens the list: "Lessons in this module · 2 of 3". */
export const outlineButtonText = (o: Pick<LessonOutlineModel, 'scope' | 'at' | 'total'>) => `Lessons in this ${o.scope === 'module' ? 'module' : 'course'} · ${o.at + 1} of ${o.total}`;

/** What a quiz covers (its start page): the lessons before it in its module or course, other quizzes left out. */
export function quizCovers(o: Pick<LessonOutlineModel, 'items' | 'at'>): string[] {
  return o.items.slice(0, Math.max(0, o.at)).filter((l) => l.kind !== 'QUIZ').map((l) => l.title);
}

/** `label` is the whole text; `prefix` + `title` the same in two parts (the title shown in its own <bdi>). */
export type NextWay =
  | { kind: 'lesson'; label: string; lessonId: string; prefix?: string; title?: string }
  | { kind: 'module'; label: string; lessonId: string; prefix: string; title: string }
  | { kind: 'finish'; label: 'Finish course' }
  | { kind: 'course'; label: 'Back to the course' };

/**
 * The lesson's one way on, in words that say where it goes: "Next: <the next lesson>"; on a module's last lesson,
 * once done (or done by the button itself), "Next module: <name>"; after the course's last lesson "Back to the course";
 * "Finish course" on the lesson whose button finishes the course (review 2: even with lessons after it). Next is the server's next lesson (hidden modules skipped).
 */
export function nextWay(a: { course: CourseDetail | undefined; lessonId: string; nextLessonId: string | null; doneAfter: boolean; finishesCourse: boolean }): NextWay {
  // The button that finishes the course says so, even when lessons come after it (taken earlier, out of order).
  if (a.finishesCourse) return { kind: 'finish', label: 'Finish course' };
  if (!a.nextLessonId) return { kind: 'course', label: 'Back to the course' };
  const lessonId = a.nextLessonId;
  const next = a.course?.lessons.find((l) => l.id === lessonId);
  if (!a.course || !next) return { kind: 'lesson', label: 'Next lesson', lessonId };
  if (a.course.modules.length && a.doneAfter) {
    const mine = a.course.modules.find((m) => m.lessonIds.includes(a.lessonId));
    const theirs = a.course.modules.find((m) => m.lessonIds.includes(lessonId));
    if (theirs && mine && theirs.id !== mine.id) return { kind: 'module', label: `Next module: ${theirs.title}`, lessonId, prefix: 'Next module: ', title: theirs.title };
  }
  return { kind: 'lesson', label: `Next: ${next.title}`, lessonId, prefix: 'Next: ', title: next.title };
}

/**
 * When the lesson page has two columns (the lesson and "In this module" beside it), by the room the lesson gets — it
 * stays about 640 px or more (coordinator, 15 Nov): staff from 1280 px while the side menu is full (240 px), from
 * 1024 px when it is folded to its icon rail; the Client portal (no side menu) from 1024 px. Below: one column, the
 * "Lessons in this module" sheet and the bottom bar.
 */
export function twoColumnQuery({ portal, menuFolded }: { portal: boolean; menuFolded: boolean }): string {
  return portal || menuFolded ? '(min-width: 64em)' : '(min-width: 80em)';
}
