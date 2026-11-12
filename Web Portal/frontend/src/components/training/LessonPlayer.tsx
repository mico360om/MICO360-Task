import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LessonDone, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { ApiError } from '../../lib/api-client';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button, buttonClass } from '../ui/Button';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { CourseFinished } from './CourseFinished';
import { DocumentLesson } from './DocumentLesson';
import { GuideLesson, type LessonNext } from './GuideLesson';
import { QuizLesson } from './QuizLesson';
import { VideoLesson } from './VideoLesson';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged, useCourse, useLessonView } from './training-queries';
import { LessonKindIcon, TOUCH_MIN, TickIcon, trainingProblem } from './training-ui';
import { LESSON_KIND_WORDS, minutesText } from './training-words';
import { LIMITS } from '../../api/training';

/**
 * One lesson (staff and the Client portal; 12 Nov §4): the breadcrumbs and title, the lesson itself (a video, a guide,
 * a document or a quiz) with ONE way on — "Next lesson", or "Finish course" on the lesson that finishes it, or "Back
 * to the course" — and a small "Report a problem". A guide says "Step 2 of 6"; the others "Lesson 2 of 4". One note
 * when a lesson is done: on the next lesson's page ("“…” done."), or "Course completed" when the course is finished.
 */
export function LessonPlayer({ courseId, lessonId, renderTitle }: { courseId: string; lessonId: string; renderTitle: (title: string) => ReactNode }) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const q = useLessonView(lessonId);
  const course = useCourse(courseId);
  const [done, setDone] = useState<LessonDone | null>(null);
  // Review I2: finished here, on this visit (latched: the course read again afterwards says COMPLETED).
  const [finishedHere, setFinishedHere] = useState(false);
  const [reporting, setReporting] = useState(false);
  const courseTo = coursePath(side.base, courseId);
  const arrived = (location.state as { lessonDone?: unknown } | null)?.lessonDone;

  // Another lesson: start afresh, at the top of the page.
  useEffect(() => {
    setDone(null);
    setFinishedHere(false);
    document.scrollingElement?.scrollTo?.(0, 0);
  }, [lessonId]);

  if (q.isPending) {
    return (
      <p role="status" className="py-12 text-center text-sm text-ink-2">
        <span className="animate-pulse motion-reduce:animate-none">Loading the lesson…</span>
      </p>
    );
  }
  if (q.isError) {
    const locked = q.error instanceof ApiError && q.error.code === 'LESSON_LOCKED';
    return (
      <div role="alert" className="card card-pad mx-auto flex max-w-md flex-col items-center gap-3 text-center">
        <p className="font-semibold text-ink">{locked ? 'Finish the lessons before this one first.' : trainingProblem(q.error, 'Couldn’t load this lesson.')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!locked && !(q.error instanceof ApiError && q.error.status === 404) ? (
            <Button variant="secondary" className={TOUCH_MIN} onClick={() => void q.refetch()}>
              Try again
            </Button>
          ) : null}
          <Link to={courseTo} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
            Back to the course
          </Link>
        </div>
      </div>
    );
  }

  const lesson = q.data;
  const outline = course.data?.lessons ?? [];
  const at = outline.findIndex((l) => l.id === lesson.id);
  const total = outline.length || lesson.lessonCount;
  const nextId = lesson.nextLessonId;
  // Finished before this visit: going through it again never says "Course completed" again.
  const wasFinished = course.data?.mine.status === 'COMPLETED' || course.data?.mine.status === 'REVIEW';
  const othersDone = outline.length > 0 && outline.every((l) => l.id === lesson.id || l.done);
  const courseDone = finishedHere && lesson.kind !== 'QUIZ';

  const finished = (d: LessonDone) => {
    setDone(d);
    if (d.courseCompleted && !wasFinished) setFinishedHere(true);
    courseChanged(qc, side, courseId);
    void qc.invalidateQueries({ queryKey: [...side.keyRoot, 'lesson', lesson.id], exact: true });
  };

  /** The one way on (12 Nov §4). After the course is finished here, "Course completed" is said instead, with its Next. */
  const next: LessonNext = {
    label: nextId ? 'Next lesson' : othersDone && !wasFinished ? 'Finish course' : 'Back to the course',
    go: (d) => {
      if ((d?.courseCompleted && !wasFinished) || finishedHere) return;
      if (nextId) navigate(lessonPath(side.base, courseId, nextId), { state: { lessonDone: lesson.title } });
      else navigate(courseTo);
    },
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: 'Learning Hub', to: side.base },
            { label: <bdi>{lesson.courseTitle}</bdi>, to: courseTo },
            { label: <bdi>{lesson.title}</bdi> },
          ]}
        />
        {renderTitle(lesson.title)}
        {lesson.kind !== 'GUIDE' ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            {at >= 0 ? (
              <span className="font-semibold text-ink">
                Lesson {at + 1} of {total}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <LessonKindIcon kind={lesson.kind} size={14} />
              {LESSON_KIND_WORDS[lesson.kind]}
            </span>
            {minutesText(lesson.minutes) ? <span>· {minutesText(lesson.minutes)}</span> : null}
            {lesson.progress.done || done ? (
              <span className="inline-flex items-center gap-1 font-semibold text-success">
                <TickIcon size={14} />
                Done
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {typeof arrived === 'string' && arrived && !done ? (
        <p role="status" className="inline-flex items-center gap-2 self-start rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <TickIcon size={14} />
          {`“${arrived}” done.`}
        </p>
      ) : null}

      {courseDone ? (
        <>
          <CourseFinished title={lesson.courseTitle} certificateId={done!.certificateId} />
          <div>
            <Link to={side.base} className={buttonClass('primary', 'lg', '!min-h-[44px]')}>
              Next
            </Link>
          </div>
        </>
      ) : null}

      {lesson.body ? (
        <div className="card card-pad">
          <RichNoteView html={lesson.body} className="text-sm text-ink" />
        </div>
      ) : null}

      <LessonBody key={lesson.id} lesson={lesson} onDone={finished} next={next} />

      {lesson.kind === 'VIDEO' && !courseDone ? (
        <div>
          {nextId ? (
            <Link to={lessonPath(side.base, courseId, nextId)} state={lesson.progress.done || done ? { lessonDone: lesson.title } : undefined} className={buttonClass(lesson.progress.done || done ? 'primary' : 'secondary', 'md', TOUCH_MIN)}>
              Next lesson
            </Link>
          ) : (
            <Link to={courseTo} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
              Back to the course
            </Link>
          )}
        </div>
      ) : null}

      <div className="border-t border-line pt-3">
        <button type="button" onClick={() => setReporting(true)} className={`text-sm text-ink-2 underline-offset-2 hover:text-ink hover:underline ${TOUCH_MIN}`}>
          Report a problem
        </button>
      </div>
      {reporting ? <ReportProblemDialog lesson={lesson} onClose={() => setReporting(false)} /> : null}
    </div>
  );
}

function LessonBody({ lesson, onDone, next }: { lesson: LessonView; onDone: (d: LessonDone) => void; next: LessonNext }) {
  switch (lesson.kind) {
    case 'VIDEO':
      return <VideoLesson lesson={lesson} onDone={onDone} />;
    case 'GUIDE':
      return <GuideLesson lesson={lesson} onDone={onDone} next={next} />;
    case 'DOCUMENT':
      return <DocumentLesson lesson={lesson} onDone={onDone} next={next} />;
    case 'QUIZ':
      return <QuizLesson lesson={lesson} onDone={onDone} />;
    default:
      return null;
  }
}

/** "Report a problem": a note to the training team that something in this lesson is wrong or out of date. */
function ReportProblemDialog({ lesson, onClose }: { lesson: LessonView; onClose: () => void }) {
  const side = useLearner();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const ref = useDialog(busy ? () => {} : onClose);
  const id = useId();
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await side.api.feedback(lesson.courseId, { kind: 'OUTDATED', lessonId: lesson.id, body: note.trim() || undefined });
      setSent(true);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t send your report.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className={`card relative ${dialogPanel('small')} flex animate-scale-in flex-col gap-3 overflow-y-auto p-5`}>
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">
            Report a problem
          </h2>
          {sent ? (
            <>
              <p role="status" className="text-sm text-ink">
                Thanks — the training team will look at “{lesson.title}”.
              </p>
              <div className="flex justify-end">
                <Button className={TOUCH_MIN} onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">Something in “{lesson.title}” is wrong, or no longer matches the site? Tell the training team.</p>
              <label htmlFor={`${id}-note`} className="text-sm font-semibold text-ink">
                What’s wrong <span className="font-normal text-ink-2">(optional)</span>
              </label>
              <textarea
                id={`${id}-note`}
                value={note}
                maxLength={LIMITS.feedbackBody}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="For example: the New task button is now at the top of the page."
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" className={TOUCH_MIN} onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button className={TOUCH_MIN} loading={busy} onClick={() => void send()}>
                  Send report
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
