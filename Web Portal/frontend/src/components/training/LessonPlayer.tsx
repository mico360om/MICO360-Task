import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LessonDone, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { ApiError } from '../../lib/api-client';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button, buttonClass } from '../ui/Button';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { CourseFinished } from './CourseFinished';
import { DocumentLesson } from './DocumentLesson';
import { GuideLesson } from './GuideLesson';
import { BackToLesson, LessonBar, LessonBarProvider, OutlinePanel, OutlineSheet, OutlineSheetButton, WIDE_LESSON_QUERY, WayButton, type LessonWay } from './LessonNav';
import { QuizLesson } from './QuizLesson';
import { VideoLesson } from './VideoLesson';
import { coursePath, lessonPath, useLearner } from './learner';
import { lessonOutline, nextWay, quizCovers, type LessonOutlineModel } from './lesson-nav';
import { courseChanged, useCourse, useLessonView } from './training-queries';
import { LessonKindIcon, TOUCH_MIN, TickIcon, courseMoved, trainingProblem } from './training-ui';
import { LESSON_KIND_WORDS, lessonsText, minutesText } from './training-words';
import { LIMITS } from '../../api/training';

/** The note the lesson before leaves on arriving here ("“…” done.", "Module done: Tasks"), from the address's state. */
type ArrivalNote = { lessonDone: string | null; moduleDone: string | null } | null;
function arrivalNote(state: unknown): ArrivalNote {
  const s = state as { lessonDone?: unknown; moduleDone?: unknown } | null;
  const lessonDone = typeof s?.lessonDone === 'string' && s.lessonDone ? s.lessonDone : null;
  const moduleDone = typeof s?.moduleDone === 'string' && s.moduleDone ? s.moduleDone : null;
  return lessonDone || moduleDone ? { lessonDone, moduleDone } : null;
}

/**
 * One lesson (staff and the Client portal). 1.23.36 ("Lesson + module outline", owner 14 Nov):
 *  - the header: breadcrumbs, the title, ONE line — the kind's icon · "Module 1 · Getting started — Lesson 1 of 3" ·
 *    minutes (· Done) — and ONE bar of the module's progress, named for screen readers;
 *  - from 1024 px two columns: the lesson (up to 880 px; a video at its full width) and beside it "In this module",
 *    which stays in view: the module's lessons with their states, "1 of 3 done", the one main button and All modules;
 *  - under 1024 px: "Lessons in this module · 2 of 3" opens that list as a sheet, and a bar at the bottom of the window
 *    holds Back and the main button (a guide's steps and a quiz's questions put their own Back / Next there);
 *  - the main button says where it goes: "Next: <lesson>", "Next module: <name>", "Back to the course", or "Finish
 *    course" on the lesson that finishes it. On a guide's last step and on a document it finishes the lesson, then goes
 *    on (12 Nov §4: the same rules as before); elsewhere it goes on — the main look once the lesson is done, a plain
 *    one before (and not at all to a lesson an in-order course keeps locked);
 *  - the "“…” done." / "Module done: Tasks" note from the lesson before shows once: it is taken off the address (Back
 *    never shows it again) and goes when the person does something here (a quiz's result, a guide's step) or opens
 *    another lesson.
 * Old links (1.23.30): a lesson under another course's address goes to its own; a removed one (COURSE_MOVED) to its
 * module. "Course completed" (with the certificate) when this visit finished the course, then Next (My learning).
 */
export function LessonPlayer({ courseId, lessonId, renderTitle }: { courseId: string; lessonId: string; renderTitle: (title: string) => ReactNode }) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const q = useLessonView(lessonId);
  const course = useCourse(courseId);
  const wide = useMediaQuery(WIDE_LESSON_QUERY, true);
  const [done, setDone] = useState<LessonDone | null>(null);
  // Review I2: finished here, on this visit (latched: the course read again afterwards says COMPLETED).
  const [finishedHere, setFinishedHere] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sheet, setSheet] = useState(false);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState<ArrivalNote>(() => arrivalNote(location.state));
  // A guide on its last step (its main button then finishes it).
  const [guideEnd, setGuideEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wayError, setWayError] = useState<string | null>(null);
  // The phone bar: where a lesson's own controls go, and whether one is there.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback((on: boolean) => setClaims((n) => Math.max(0, n + (on ? 1 : -1))), []);
  const bar = useMemo(() => ({ wide, slot, claim }), [wide, slot, claim]);
  // Whether the lesson's module was already done when this lesson was first seen (so finishing it here can say so).
  const [moduleAtStart, setModuleAtStart] = useState<{ lessonId: string; done: boolean } | null>(null);
  const courseTo = coursePath(side.base, courseId);
  const clearNote = useCallback(() => setNote(null), []);

  // Another lesson: start afresh, at the top of the page. The note from the lesson before is read once and taken off
  // the address, so coming Back here (or reloading) never shows it again.
  useEffect(() => {
    setDone(null);
    setFinishedHere(false);
    setWayError(null);
    setSheet(false);
    const arrived = arrivalNote(location.state);
    setNote(arrived);
    if (arrived) navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
    document.scrollingElement?.scrollTo?.(0, 0);
    // The lesson decides; the address's state is read as it is when the lesson opens.
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
  const all = course.data?.lessons ?? [];
  const outline = course.data ? lessonOutline(course.data, lesson.id) : null;
  // Finished before this visit: going through it again never says "Course completed" again.
  const wasFinished = course.data?.mine.status === 'COMPLETED' || course.data?.mine.status === 'REVIEW';
  const othersDone = all.length > 0 && all.every((l) => l.id === lesson.id || l.done);
  const courseDone = finishedHere && lesson.kind !== 'QUIZ';
  const isDone = lesson.progress.done || done !== null;
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

  // The one way on (12 Nov §4, said where it goes since 1.23.36).
  const finishes = !isDone && ((lesson.kind === 'GUIDE' && (guideEnd || lesson.steps.length === 0)) || (lesson.kind === 'DOCUMENT' && !!lesson.document));
  const nw = nextWay({ course: course.data, lessonId: lesson.id, nextLessonId: lesson.nextLessonId, doneAfter: isDone || finishes, finishesCourse: finishes && othersDone && !wasFinished });
  const target = nw.kind === 'lesson' || nw.kind === 'module' ? nw.lessonId : null;
  const primary = isDone || finishes;
  const nextLocked = !!target && !!all.find((l) => l.id === target)?.locked;
  const runWay = async () => {
    setBusy(true);
    setWayError(null);
    try {
      const out = await side.api.complete(lesson.id);
      finished(out);
      // Finished the course here: "Course completed" says so on this page.
      if (out.courseCompleted && !wasFinished) return;
      const moduleDone = out.moduleDone?.title;
      if (lesson.nextLessonId) navigate(lessonPath(side.base, courseId, lesson.nextLessonId), { state: moduleDone ? { lessonDone: lesson.title, moduleDone } : { lessonDone: lesson.title } });
      else navigate(courseTo);
    } catch (err) {
      setWayError(trainingProblem(err, lesson.kind === 'GUIDE' ? 'Couldn’t finish this guide.' : 'Couldn’t finish this lesson.'));
    } finally {
      setBusy(false);
    }
  };
  const way: LessonWay = {
    label: nw.label,
    finishes,
    primary,
    to: target ? lessonPath(side.base, courseId, target) : courseTo,
    state: isDone ? { lessonDone: lesson.title } : undefined,
    run: () => void runWay(),
    busy,
    hidden: finishedHere || (!primary && nextLocked),
  };

  const prevTitle = all.find((l) => l.id === lesson.prevLessonId)?.title ?? null;
  const back = <BackToLesson courseId={courseId} lessonId={lesson.prevLessonId} title={prevTitle} />;
  const allTo = outline?.moduleId ? coursePath(side.base, courseId, null, outline.moduleId) : courseTo;
  const allLabel = outline?.scope === 'module' ? 'All modules' : 'Course page';
  const showBar = !wide && (claims > 0 || !!lesson.prevLessonId || !way.hidden);

  const body = (
    <div className="flex min-w-0 flex-col gap-4">
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
        <LessonLine lesson={lesson} outline={outline} done={isDone} />
        {!wide && outline ? <OutlineSheetButton outline={outline} open={sheet} onOpen={() => setSheet(true)} buttonRef={sheetButton} /> : null}
      </div>

      {moduleFinished || (note?.moduleDone && !done) ? (
        <p role="status" className="inline-flex items-center gap-2 self-start rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <TickIcon size={14} />
          <span>
            {'Module done: '}
            <bdi>{moduleFinished ?? note?.moduleDone}</bdi>
          </span>
        </p>
      ) : note?.lessonDone && !done ? (
        <p role="status" className="inline-flex items-center gap-2 self-start rounded-lg bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <TickIcon size={14} />
          {`“${note.lessonDone}” done.`}
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

      <LessonBody key={lesson.id} lesson={lesson} done={isDone} way={way} back={back} covers={outline ? quizCovers(outline) : []} onDone={finished} onGuideStep={setGuideEnd} onActivity={clearNote} />

      {wayError ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {wayError}
        </p>
      ) : null}

      <div className="border-t border-line pt-3">
        <button type="button" onClick={() => setReporting(true)} className={`text-sm text-ink-2 underline-offset-2 hover:text-ink hover:underline ${TOUCH_MIN}`}>
          Report a problem
        </button>
      </div>

      {showBar ? (
        <LessonBar slotRef={setSlot} claimed={claims > 0}>
          {back}
          <WayButton way={way} className="ms-auto min-w-0 max-w-full flex-1 sm:flex-none" />
        </LessonBar>
      ) : null}
    </div>
  );

  return (
    <LessonBarProvider value={bar}>
      <div
        data-lesson-layout
        className={`grid w-full min-w-0 gap-6 ${wide ? (side.portal ? 'grid-cols-[minmax(0,1fr)_17.5rem]' : 'grid-cols-[minmax(0,55rem)_17.5rem] xl:grid-cols-[minmax(0,55rem)_18.75rem]') : 'grid-cols-1'}`}
      >
        <div className="min-w-0 self-start">{body}</div>
        {wide ? <div className="min-w-0">{outline ? <OutlinePanel outline={outline} courseId={courseId} allTo={allTo} allLabel={allLabel} way={way} /> : null}</div> : null}
      </div>
      {sheet && outline ? (
        <OutlineSheet
          outline={outline}
          courseId={courseId}
          allTo={allTo}
          allLabel={allLabel}
          onClose={() => {
            setSheet(false);
          }}
        />
      ) : null}
      {reporting ? <ReportProblemDialog lesson={lesson} onClose={() => setReporting(false)} /> : null}
    </LessonBarProvider>
  );
}

/**
 * The header's one line (1.23.36): the kind as an icon (its name for screen readers), "Module 2 · Tasks — Lesson 2 of
 * 3" (a course without modules: "Lesson 2 of 4"), the minutes and, once done, "Done"; under it ONE thin bar of the
 * module's (or course's) lessons done, named for screen readers ("Tasks: 1 of 3 lessons done").
 */
function LessonLine({ lesson, outline, done }: { lesson: LessonView; outline: LessonOutlineModel | null; done: boolean }) {
  const minutes = minutesText(lesson.minutes);
  const pct = outline && outline.total > 0 ? Math.min(100, Math.round((outline.done / outline.total) * 100)) : 0;
  const place = outline ? (
    outline.scope === 'module' ? (
      <>
        {`Module ${outline.number} · `}
        <bdi>{outline.title}</bdi>
        {` — Lesson ${outline.at + 1} of ${outline.total}`}
      </>
    ) : (
      `Lesson ${outline.at + 1} of ${outline.total}`
    )
  ) : lesson.module ? (
    <>
      <bdi>{lesson.module.title}</bdi>
      {` — Lesson ${lesson.module.lessonIndex + 1} of ${lesson.module.lessonCount}`}
    </>
  ) : (
    `Lesson ${lesson.position + 1} of ${lesson.lessonCount}`
  );
  return (
    <div data-lesson-header className="flex flex-col gap-1.5">
      <p data-lesson-line className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center text-ink-2">
          <LessonKindIcon kind={lesson.kind} size={15} />
          <span className="sr-only">{`${LESSON_KIND_WORDS[lesson.kind]}:`}</span>
        </span>
        <span data-lesson-place className="min-w-0 break-words font-semibold text-ink">
          {place}
        </span>
        {minutes ? <span aria-hidden="true">·</span> : null}
        {minutes ? <span>{minutes}</span> : null}
        {done ? (
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <TickIcon size={14} />
            Done
          </span>
        ) : null}
      </p>
      {outline ? (
        <div role="progressbar" aria-label={`${outline.title}: ${outline.done} of ${lessonsText(outline.total)} done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${pct >= 100 ? STATUS_CLASS.DONE.dot : 'bg-brand'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function LessonBody({
  lesson,
  done,
  way,
  back,
  covers,
  onDone,
  onGuideStep,
  onActivity,
}: {
  lesson: LessonView;
  done: boolean;
  way: LessonWay;
  back: ReactNode;
  covers: string[];
  onDone: (d: LessonDone) => void;
  onGuideStep: (atEnd: boolean) => void;
  onActivity: () => void;
}) {
  switch (lesson.kind) {
    case 'VIDEO':
      return <VideoLesson lesson={lesson} onDone={onDone} />;
    case 'GUIDE':
      return <GuideLesson lesson={lesson} done={done} way={way} back={back} onStep={onGuideStep} onMoved={onActivity} />;
    case 'DOCUMENT':
      return <DocumentLesson lesson={lesson} />;
    case 'QUIZ':
      return <QuizLesson lesson={lesson} onDone={onDone} covers={covers} onActivity={onActivity} />;
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
