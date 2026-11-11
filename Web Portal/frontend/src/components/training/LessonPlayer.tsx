import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LessonDone, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { ApiError } from '../../lib/api-client';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button, buttonClass } from '../ui/Button';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { ProgressBar } from '../portal/portal-ui';
import { DocumentLesson } from './DocumentLesson';
import { GuideLesson } from './GuideLesson';
import { QuizLesson } from './QuizLesson';
import { VideoLesson } from './VideoLesson';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged, useCourse, useLessonView } from './training-queries';
import { AwardIcon, LessonKindIcon, TOUCH_MIN, TickIcon, trainingProblem } from './training-ui';
import { LESSON_KIND_WORDS, minutesText } from './training-words';
import { LIMITS } from '../../api/training';

/**
 * One lesson (staff and the Client portal): the course's name, "Lesson n of N", the course's progress, the lesson
 * itself (a video, a guide, a document or a quiz), Previous / Next, and "Report outdated". Finishing the last lesson
 * says so (and offers the certificate when there is one).
 */
export function LessonPlayer({ courseId, lessonId, renderTitle }: { courseId: string; lessonId: string; renderTitle: (title: string) => ReactNode }) {
  const side = useLearner();
  const qc = useQueryClient();
  const q = useLessonView(lessonId);
  const course = useCourse(courseId);
  const [done, setDone] = useState<LessonDone | null>(null);
  const [reporting, setReporting] = useState(false);
  const courseTo = coursePath(side.base, courseId);

  // Another lesson: start afresh, at the top of the page (Next lesson is at the bottom of the one before).
  useEffect(() => {
    setDone(null);
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
  const n = at >= 0 ? at + 1 : lesson.position + 1;
  const total = outline.length || lesson.lessonCount;
  // The course's progress only grows while a lesson is taken: the highest of what the server has said.
  const progress = Math.max(done?.courseProgressPct ?? 0, course.data?.mine.progressPct ?? 0, lesson.courseProgressPct);
  const nextId = done?.nextLessonId ?? lesson.nextLessonId;

  const finished = (d: LessonDone) => {
    setDone(d);
    courseChanged(qc, side, courseId);
    void qc.invalidateQueries({ queryKey: [...side.keyRoot, 'lesson', lesson.id], exact: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: 'Learning Hub', to: side.base },
            { label: <bdi>{lesson.courseTitle}</bdi>, to: courseTo },
            { label: <bdi>{lesson.title}</bdi> },
          ]}
        />
        {renderTitle(lesson.title)}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <span className="font-semibold text-ink">
            Lesson {n} of {total}
          </span>
          <span className="inline-flex items-center gap-1">
            <LessonKindIcon kind={lesson.kind} size={14} />
            {LESSON_KIND_WORDS[lesson.kind]}
          </span>
          {minutesText(lesson.minutes) ? <span>{minutesText(lesson.minutes)}</span> : null}
          {lesson.progress.done || done ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success">
              <TickIcon size={14} />
              Done
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProgressBar percent={progress} label={`Course progress: ${progress}%`} />
          </div>
          <span className="flex-none text-xs font-semibold text-ink">{progress}% of the course</span>
        </div>
      </div>

      {done?.courseCompleted ? <CourseFinished title={lesson.courseTitle} certificateId={done.certificateId} courseTo={courseTo} /> : null}

      {lesson.body ? (
        <div className="card card-pad">
          <RichNoteView html={lesson.body} className="text-sm text-ink" />
        </div>
      ) : null}

      <LessonBody key={lesson.id} lesson={lesson} onDone={finished} />

      {done && !done.courseCompleted ? (
        <div role="status" className="card card-pad flex flex-wrap items-center justify-between gap-3 border-s-4 border-success">
          <p className="inline-flex items-center gap-2 font-semibold text-ink">
            <span className="text-success">
              <TickIcon />
            </span>
            Lesson done.
          </p>
          {nextId ? (
            <Link to={lessonPath(side.base, courseId, nextId)} className={buttonClass('primary', 'md', TOUCH_MIN)}>
              Next lesson
            </Link>
          ) : (
            <Link to={courseTo} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
              Back to the course
            </Link>
          )}
        </div>
      ) : null}

      <nav aria-label="Lessons" className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {lesson.prevLessonId ? (
            <Link to={lessonPath(side.base, courseId, lesson.prevLessonId)} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
              Previous lesson
            </Link>
          ) : null}
          {nextId && !done ? (
            <Link to={lessonPath(side.base, courseId, nextId)} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
              Next lesson
            </Link>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" className={TOUCH_MIN} onClick={() => setReporting(true)}>
          Report outdated
        </Button>
      </nav>
      {reporting ? <ReportOutdatedDialog lesson={lesson} onClose={() => setReporting(false)} /> : null}
    </div>
  );
}

function LessonBody({ lesson, onDone }: { lesson: LessonView; onDone: (d: LessonDone) => void }) {
  switch (lesson.kind) {
    case 'VIDEO':
      return <VideoLesson lesson={lesson} onDone={onDone} />;
    case 'GUIDE':
      return <GuideLesson lesson={lesson} onDone={onDone} />;
    case 'DOCUMENT':
      return <DocumentLesson lesson={lesson} onDone={onDone} />;
    case 'QUIZ':
      return <QuizLesson lesson={lesson} onDone={onDone} />;
    default:
      return null;
  }
}

/** The course is finished: said plainly, with the certificate when there is one. */
function CourseFinished({ title, certificateId, courseTo }: { title: string; certificateId: string | null; courseTo: string }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const download = async () => {
    if (!certificateId) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await side.api.certificatePdf(certificateId);
      downloadBlob(fileNameOf(blob) ?? 'certificate.pdf', blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="course-finished" data-course-finished className="card card-pad flex flex-col items-center gap-3 border-2 border-success/40 bg-success-soft/30 py-8 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-success-soft text-success">
        <AwardIcon size={28} />
      </span>
      <h2 id="course-finished" ref={heading} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
        Course completed
      </h2>
      <p className="max-w-md text-sm text-ink-2">
        Well done — you finished <span className="font-semibold text-ink">{title}</span>.{certificateId ? ' Your certificate is ready.' : ''}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {certificateId ? (
          <Button className={TOUCH_MIN} loading={busy} onClick={() => void download()}>
            Download certificate (PDF)
          </Button>
        ) : null}
        <Link to={courseTo} className={buttonClass('secondary', 'md', TOUCH_MIN)}>
          Back to the course
        </Link>
        <Link to={side.base} className={buttonClass('ghost', 'md', TOUCH_MIN)}>
          {side.portal ? 'Learning Hub' : 'My learning'}
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** "Report outdated": a note to the training team that this lesson no longer matches the site. */
function ReportOutdatedDialog({ lesson, onClose }: { lesson: LessonView; onClose: () => void }) {
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
            Report outdated
          </h2>
          {sent ? (
            <>
              <p role="status" className="text-sm text-ink">
                Thanks — the training team will look at “{lesson.title}”.
              </p>
              <div className="flex justify-end">
                <Button onClick={onClose}>Close</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">Something in “{lesson.title}” no longer matches the site? Tell the training team what changed.</p>
              <label htmlFor={`${id}-note`} className="text-sm font-semibold text-ink">
                What’s out of date <span className="font-normal text-ink-2">(optional)</span>
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
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button loading={busy} onClick={() => void send()}>
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
