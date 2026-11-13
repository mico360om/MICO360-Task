import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LessonDone, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { ApiError } from '../../lib/api-client';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button, buttonClass } from '../ui/Button';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { CourseFinished } from './CourseFinished';
import { DocumentLesson } from './DocumentLesson';
import { GuideLesson, type LessonNext } from './GuideLesson';
import { LessonFooter } from './LessonFooter';
import { ModuleIcon } from './ModuleIcon';
import { QuizLesson } from './QuizLesson';
import { VideoLesson } from './VideoLesson';
import { moduleKeyOf } from './dashboard-rules';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged, useCourse, useLessonView } from './training-queries';
import { LessonKindIcon, TOUCH_MIN, TickIcon, courseMoved, trainingProblem } from './training-ui';
import { LESSON_KIND_WORDS, lessonsText, minutesText } from './training-words';
import { LIMITS } from '../../api/training';

/**
 * One lesson (staff and the Client portal; 12 Nov §4): the breadcrumbs and title, the lesson itself (a video, a guide,
 * a document or a quiz) with ONE way on — "Next lesson", or "Finish course" on the lesson that finishes it, or "Back
 * to the course" — and a small "Report a problem". A guide says "Step 2 of 6"; the others "Lesson 2 of 4". One note
 * when a lesson is done: on the next lesson's page ("“…” done."), or "Course completed" when the course is finished.
 *
 * A lesson of a module (1.23.30): breadcrumbs "Learning Hub › the course › the module" (the title is the heading),
 * and "Module done: Tasks" (one note) when this visit finished its module — on the next lesson's page, or here (a quiz,
 * a video). Next is the server's next lesson (hidden modules skipped). Old links: a lesson opened under another
 * course's address is moved to its own; a removed one (COURSE_MOVED) to its module.
 *
 * 13 Nov new look: a module's lesson has one header line — "Module 2 · Tasks — Lesson 2 of 3" (the module's place among
 * the person's own), a thin bar of the module's progress and "All modules" (the course at this module); every kind of
 * lesson ends with the same footer bar ("Previous lesson" … the one way on).
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
  // Whether the lesson's module was already done when this lesson was first seen (so finishing it here can say so).
  const [moduleAtStart, setModuleAtStart] = useState<{ lessonId: string; done: boolean } | null>(null);
  const courseTo = coursePath(side.base, courseId);
  const arrivedState = location.state as { lessonDone?: unknown; moduleDone?: unknown } | null;
  const arrived = arrivedState?.lessonDone;
  const arrivedModule = typeof arrivedState?.moduleDone === 'string' && arrivedState.moduleDone ? arrivedState.moduleDone : null;

  // Another lesson: start afresh, at the top of the page.
  useEffect(() => {
    setDone(null);
    setFinishedHere(false);
    document.scrollingElement?.scrollTo?.(0, 0);
  }, [lessonId]);

  // Old links: the lesson under another course's address goes to its own; a lesson that moved away (removed as a
  // duplicate) to the one course at its module. The address is replaced (Back doesn't return to the old one).
  const elsewhere = q.data && q.data.id === lessonId && q.data.courseId !== courseId ? lessonPath(side.base, q.data.courseId, q.data.id) : null;
  const moved = courseMoved(q.error);
  const redirect = elsewhere ?? (moved ? coursePath(side.base, moved.courseId, null, moved.moduleId) : null);
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
    // The address decides; navigate is stable for the page.
  }, [redirect]);

  const lessonModule = q.data?.module ?? null;
  const moduleOutline = lessonModule ? course.data?.modules.find((u) => u.id === lessonModule.id) : undefined;
  if (moduleOutline && q.data && moduleAtStart?.lessonId !== q.data.id) setModuleAtStart({ lessonId: q.data.id, done: moduleOutline.status === 'DONE' });

  if (q.isPending || redirect) {
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
  // Where the lesson sits in its module ("Module 2 · Tasks — Lesson 2 of 3"), from the course's outline of the person's
  // own modules and lessons (a module hidden from them never counts).
  const inModule =
    lessonModule && moduleOutline && moduleOutline.lessonIds.includes(lesson.id)
      ? {
          title: lessonModule.title,
          number: (course.data?.modules.findIndex((u) => u.id === moduleOutline.id) ?? -1) + 1,
          at: moduleOutline.lessonIds.indexOf(lesson.id),
          total: moduleOutline.lessonIds.length,
          done: moduleOutline.lessonsDone,
        }
      : null;
  // A plain course's lesson: "Lesson 2 of 4" (a guide says only its steps).
  const place =
    !lessonModule && at >= 0 ? (
      <span className="font-semibold text-ink">
        Lesson {at + 1} of {total}
      </span>
    ) : null;
  // This visit finished the lesson's module: the server says so (a guide, a document, a video), or the course read
  // again shows the module done that wasn't when the lesson opened (a quiz: its result doesn't say). The course
  // finished instead: "Course completed" says it all.
  const moduleFinished = done?.courseCompleted
    ? null
    : (done?.moduleDone?.title ?? (done && moduleAtStart?.lessonId === lesson.id && !moduleAtStart.done && moduleOutline?.status === 'DONE' ? moduleOutline.title : null));

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
      const moduleDone = d?.moduleDone?.title;
      if (nextId) navigate(lessonPath(side.base, courseId, nextId), { state: moduleDone ? { lessonDone: lesson.title, moduleDone } : { lessonDone: lesson.title } });
      else navigate(courseTo);
    },
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={
            lessonModule
              ? [
                  { label: 'Learning Hub', to: side.base },
                  // Back to the course with this lesson's module open.
                  { label: <bdi>{lesson.courseTitle}</bdi>, to: coursePath(side.base, courseId, null, lessonModule.id) },
                  { label: <bdi>{lessonModule.title}</bdi> },
                ]
              : [
                  { label: 'Learning Hub', to: side.base },
                  { label: <bdi>{lesson.courseTitle}</bdi>, to: courseTo },
                  { label: <bdi>{lesson.title}</bdi> },
                ]
          }
        />
        {renderTitle(lesson.title)}
        {inModule && moduleOutline && lessonModule ? <ModuleLine module={inModule} moduleKey={moduleKeyOf(moduleOutline)} to={coursePath(side.base, courseId, null, lessonModule.id)} /> : null}
        {lesson.kind !== 'GUIDE' ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            {place}
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

      {moduleFinished || (arrivedModule && !done) ? (
        <p role="status" className="inline-flex items-center gap-2 self-start rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <TickIcon size={14} />
          <span>
            {'Module done: '}
            <bdi>{moduleFinished ?? arrivedModule}</bdi>
          </span>
        </p>
      ) : typeof arrived === 'string' && arrived && !done ? (
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
        <LessonFooter
          lesson={lesson}
          next={
            nextId ? (
              <Link to={lessonPath(side.base, courseId, nextId)} state={lesson.progress.done || done ? { lessonDone: lesson.title } : undefined} className={buttonClass(lesson.progress.done || done ? 'primary' : 'secondary', 'md', TOUCH_MIN)}>
                Next lesson
              </Link>
            ) : (
              <Link to={courseTo} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
                Back to the course
              </Link>
            )
          }
        />
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

/**
 * A module's lesson's one header line (13 Nov new look): the module's icon, "Module 2 · Tasks — Lesson 2 of 3", "All
 * modules" (back to the course, this module open) and under it a thin bar of how much of the module is done.
 */
function ModuleLine({ module: m, moduleKey, to }: { module: { title: string; number: number; at: number; total: number; done: number }; moduleKey: string | null; to: string }) {
  const pct = m.total > 0 ? Math.min(100, Math.round((m.done / m.total) * 100)) : 0;
  return (
    <div data-lesson-header className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p data-lesson-place className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden="true" className="grid h-6 w-6 flex-none place-items-center rounded-md bg-brand/10 text-brand">
            <ModuleIcon moduleKey={moduleKey} size={14} />
          </span>
          <span className="min-w-0 break-words">
            {m.number > 0 ? `Module ${m.number} · ` : null}
            <bdi>{m.title}</bdi>
            {` — Lesson ${m.at + 1} of ${m.total}`}
          </span>
        </p>
        <Link to={to} className={`inline-flex items-center rounded text-sm font-semibold text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_MIN}`}>
          All modules
        </Link>
      </div>
      <div role="progressbar" aria-label={`${m.title}: ${m.done} of ${lessonsText(m.total)} done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${pct >= 100 ? STATUS_CLASS.DONE.dot : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
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
