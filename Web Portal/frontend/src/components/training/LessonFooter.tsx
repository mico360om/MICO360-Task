import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LessonView } from '../../api/training';
import { buttonClass } from '../ui/Button';
import { lessonPath, useLearner } from './learner';
import { TOUCH_MIN } from './training-ui';

/** A left-pointing chevron (turned round in a right-to-left page). */
const Back = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none rtl:-scale-x-100">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/**
 * The bar at the foot of every lesson (13 Nov new look): the way back at the start, the way on at the end, the same on a
 * guide, a video, a document and a quiz. The way back is "Previous lesson" (the person's lesson before, as the server
 * says; none on the first) unless the lesson gives its own (`back`: a guide's step before, a quiz's question before).
 * The end holds `status` ("Read", "Done") and `next` — the lesson's ONE way on (12 Nov §4) — or nothing yet (a quiz
 * not passed).
 */
export function LessonFooter({ lesson, back, status, next }: { lesson: Pick<LessonView, 'courseId' | 'prevLessonId'>; back?: ReactNode; status?: ReactNode; next?: ReactNode }) {
  const side = useLearner();
  const start =
    back !== undefined ? (
      back
    ) : lesson.prevLessonId ? (
      <Link to={lessonPath(side.base, lesson.courseId, lesson.prevLessonId)} className={buttonClass('ghost', 'md', `gap-1.5 !px-2.5 ${TOUCH_MIN}`)}>
        <Back />
        Previous lesson
      </Link>
    ) : null;
  return <FooterBar start={start} end={status || next ? <>{status}{next}</> : null} />;
}

/** The bar itself (a quiz's questions use it too): `start` at the start, `end` at the end, wrapping on a phone. */
export function FooterBar({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <div data-lesson-footer className="card flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden">{start}</div>
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 empty:hidden">{end}</div>
    </div>
  );
}
