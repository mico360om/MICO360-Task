import { useEffect, useId, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS, MODULE_LABELS, TRAINING_MODULES, type CourseDetail, type TrainingModule } from '../../api/training';
import { ApiError } from '../../lib/api-client';
import { OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Button } from '../ui/Button';
import { CertificatePanel } from './CertificatePanel';
import { CertificateView } from './CertificateView';
import { LessonRow, ModuleList } from './ModuleList';
import { ProgressRing } from './ProgressRing';
import { certificateState, certificateWords, lessonsLeft, mainAction, MAIN_ACTION_WORDS, minutesLeftText } from './dashboard-rules';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged, useCourse } from './training-queries';
import { AwardIcon, CourseLength, DownloadIcon, MandatoryChip, TOUCH_MIN, TickIcon, courseMoved, saveTrainingFile, sizeText, trainingProblem } from './training-ui';
import { courseAction, instantDay, lessonsText, modulesText, shortDay } from './training-words';

const isModule = (v: string | null): v is TrainingModule => !!v && (TRAINING_MODULES as readonly string[]).includes(v);

/**
 * A course's page (staff and the Client portal; 12 Nov §4): the certificate right under the title once earned, what
 * the course is, one Start / Continue / Review button, how far along (only once started), the lessons with ticks —
 * or, for the one course with modules (1.23.30), its modules in order — downloads, "Rate this course" once finished,
 * and questions behind "Ask a question". Breadcrumbs "Learning Hub › the course"; `?module=` (All courses filtered
 * to a module, or Learn this feature) adds that module's courses; `?moduleId=` opens one of the course's modules.
 * An old short course's link (COURSE_MOVED) is replaced by the one course at its module.
 *
 * 13 Nov new look: from 1024 px two columns — the course (its certificate once earned, what it is, the modules with
 * their icons, downloads, rating) and beside it a sticky panel: the progress ring, Due, the one Start / Continue /
 * Review, the certificate card and Questions. On a phone one column: a compact progress row and the button above the
 * list, the certificate card after it, Questions last (the page reads and tabs in the order it shows).
 */
export function CourseView({ courseId, renderHeader }: { courseId: string; renderHeader: (title: string) => ReactNode }) {
  const side = useLearner();
  const navigate = useNavigate();
  const q = useCourse(courseId);
  const [params] = useSearchParams();
  const openModule = params.get('moduleId');
  // A course opened from a card far down a list starts at the top of its page (a module it opens is brought into
  // view instead).
  useEffect(() => {
    if (!openModule) document.scrollingElement?.scrollTo?.(0, 0);
    // Once per course: the module named later (a Learn link) scrolls itself.
  }, [courseId]);
  const moved = courseMoved(q.error);
  useEffect(() => {
    if (moved) navigate(coursePath(side.base, moved.courseId, null, moved.moduleId), { replace: true });
    // The answer decides; navigate and the side are stable for the page.
  }, [moved?.courseId, moved?.moduleId]);
  const module = params.get('module');
  const crumbs = (title: ReactNode) => (
    <Breadcrumbs
      items={[
        { label: 'Learning Hub', to: side.base },
        ...(isModule(module) ? [{ label: `${MODULE_LABELS[module]} courses`, to: `${side.base}?tab=catalogue&module=${encodeURIComponent(module)}` }] : []),
        { label: title },
      ]}
    />
  );
  const backLink = crumbs(q.data ? <bdi>{q.data.title}</bdi> : '…');

  if (q.isPending || moved) {
    return (
      <div className="flex flex-col gap-3">
        {backLink}
        <p role="status" className="py-12 text-center text-sm text-ink-2">
          <span className="animate-pulse motion-reduce:animate-none">Loading the course…</span>
        </p>
      </div>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        {backLink}
        <div role="alert" className="card card-pad mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          <p className="font-semibold text-ink">{gone ? 'This course isn’t available to you.' : 'Couldn’t load this course.'}</p>
          <p className="text-sm text-ink-2">{gone ? 'It may have been unpublished, or it is meant for other people.' : 'Check your connection and try again.'}</p>
          {gone ? null : (
            <Button variant="secondary" className={TOUCH_MIN} onClick={() => void q.refetch()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {backLink}
      {renderHeader(q.data.title)}
      <CourseBody course={q.data} openModule={openModule} />
    </div>
  );
}

/** From 1024 px (Tailwind's lg) the page has two columns. */
const WIDE = '(min-width: 64em)';

function CourseBody({ course: c, openModule }: { course: CourseDetail; openModule: string | null }) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wide = useMediaQuery(WIDE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = c.mine;
  const withModules = c.modules.length > 0;
  // D3: finished, with modules new for a grown role: Continue (to the first of them, where Continue goes).
  const action = courseAction(m);
  const firstId = c.lessons[0]?.id ?? null;
  const target = action === 'review' ? firstId : (c.resumeLessonId ?? firstId);
  const finished = m.status === 'COMPLETED' || m.status === 'REVIEW';
  const modules = m.modules ?? { done: c.modules.filter((u) => u.status === 'DONE').length, total: c.modules.length };

  const go = async () => {
    if (!target) return;
    setError(null);
    if (m.enrolled) {
      navigate(lessonPath(side.base, c.id, target));
      return;
    }
    setBusy(true);
    try {
      const started = await side.api.start(c.id);
      courseChanged(qc, side, c.id, started);
      navigate(lessonPath(side.base, c.id, started.resumeLessonId ?? started.lessons[0]?.id ?? target));
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t start the course.'));
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <ProgressPanel
      course={c}
      modules={withModules ? modules : null}
      wide={wide}
      button={
        target ? (
          <Button size="lg" className="!min-h-[44px] w-full sm:w-auto lg:w-full" variant={action === 'review' ? 'secondary' : 'primary'} loading={busy} onClick={() => void go()}>
            {MAIN_ACTION_WORDS[mainAction(m)]}
          </Button>
        ) : (
          <p className="text-sm text-ink-2">This course has no lessons yet.</p>
        )
      }
      error={error}
    />
  );
  // The certificate card says what is left to earn it; once there is a certificate, the certificate itself (at the
  // top) says it all — never two certificates on one page.
  const certificateCard = m.certificate ? null : <CertificatePanel course={c} />;

  return (
    <div data-course-layout className="flex w-full flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] lg:items-start lg:gap-5">
      <div data-course-main className="flex min-w-0 flex-col gap-4">
        {m.certificate ? <CertificateView certificate={m.certificate} /> : null}

        <section aria-label="About this course" className="card card-pad flex flex-col gap-3">
          {c.summary ? <p className="whitespace-pre-line break-words text-sm text-ink">{c.summary}</p> : null}
          <div data-course-facts className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CourseLength course={c} />
            <span className="text-xs text-ink-2">· {withModules ? modulesText(modules.total) : lessonsText(c.lessons.length)}</span>
            {m.mandatory && !finished ? <MandatoryChip /> : null}
            {c.certificateOn && !m.certificate ? (
              <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                <AwardIcon size={14} />
                Certificate when you finish
              </span>
            ) : null}
          </div>
          {c.completionRule === 'QUIZZES' ? <p className="text-xs text-ink-2">Pass the quizzes to finish this course.</p> : null}
          {c.inOrder ? <p className="text-xs text-ink-2">Take the lessons in order: each opens when the one before it is done.</p> : null}
        </section>

        {wide ? null : panel}

        {withModules ? (
          <ModuleList course={c} openId={openModule} />
        ) : (
          <section aria-labelledby="course-lessons" className="card card-pad">
            <h2 id="course-lessons" className="mb-2 font-display text-base font-bold text-ink">
              Lessons
            </h2>
            <ol className="flex flex-col divide-y divide-line">
              {c.lessons.map((l, i) => (
                <LessonRow key={l.id} courseId={c.id} lesson={l} number={i + 1} />
              ))}
            </ol>
            {c.lessons.length === 0 ? <p className="text-sm text-ink-2">No lessons yet.</p> : null}
          </section>
        )}

        {wide ? null : certificateCard}
        {c.resources.length ? <Downloads course={c} /> : null}
        {finished ? <RateCourse course={c} /> : null}
      </div>

      {/* Beside the course. Only the progress panel and the certificate card stick (the Client portal's main lets them;
          the staff shell's main clips sideways, so there they simply scroll): a tall sticky column would hide Questions
          below the fold. Questions stay in this column on a phone too, so a question being written never moves. */}
      <div data-course-side className="flex min-w-0 flex-col gap-4">
        <div data-course-sticky className={`flex min-w-0 flex-col gap-4 ${side.portal ? 'lg:sticky lg:top-4' : ''}`}>
          {wide ? panel : null}
          {wide ? certificateCard : null}
        </div>
        <Questions course={c} />
      </div>
    </div>
  );
}

/**
 * How far along, with the one main button (13 Nov new look): the ring ("1 / 3", "modules done"; a plain course in
 * lessons), about how long is left, the due day (overdue in red) or the day it was finished, what a review or a retake
 * means, and Start / Continue / Review. Beside the course from 1024 px (the ring above its words); on a phone a compact
 * row — the ring on the start side of its words — with the button under them.
 */
function ProgressPanel({ course: c, modules, wide, button, error }: { course: CourseDetail; modules: { done: number; total: number } | null; wide: boolean; button: ReactNode; error: string | null }) {
  const id = useId();
  const m = c.mine;
  const finished = m.status === 'COMPLETED' || m.status === 'REVIEW';
  const done = modules ? modules.done : m.lessonsDone;
  const total = modules ? modules.total : c.lessonCount;
  const label = `${done} of ${modules ? modulesText(total) : lessonsText(total)} done`;
  const under = `${modules ? (total === 1 ? 'module' : 'modules') : total === 1 ? 'lesson' : 'lessons'} done`;
  const left = m.status === 'COMPLETED' && m.newForRole === 0 ? null : minutesLeftText(lessonsLeft(c));
  const cert = certificateState(c);
  return (
    <section aria-labelledby={id} data-course-panel className="card card-pad flex flex-col gap-3 lg:text-center">
      <h2 id={id} className="sr-only">
        Your progress
      </h2>
      <div className="flex items-center gap-4 lg:flex-col">
        <ProgressRing done={done} total={total} label={label} size={wide ? 96 : 64} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-semibold text-ink">{under}</p>
          {left ? <p className="text-sm text-ink-2">{left}</p> : null}
          {m.dueDay && !finished ? <p className={`text-sm font-semibold ${m.overdue ? OVERDUE_CLASS.text : 'text-ink-2'}`}>{m.overdue ? `Overdue · was due ${shortDay(m.dueDay)}` : `Due ${shortDay(m.dueDay)}`}</p> : null}
          {m.status === 'COMPLETED' && m.completedAt ? (
            <p className={`inline-flex items-center gap-1.5 text-sm font-semibold lg:justify-center ${STATUS_CLASS.DONE.text}`}>
              <TickIcon size={14} />
              Done · {instantDay(m.completedAt)}
            </p>
          ) : null}
        </div>
      </div>
      {cert.kind === 'updated' && m.certificate ? <p className="text-sm font-semibold text-ink">{certificateWords(cert)}</p> : null}
      {m.status === 'REVIEW' ? <p className="text-sm text-ink-2">Some lessons changed since you finished. Review the ones marked “Review” — your certificate stays valid meanwhile.</p> : null}
      {m.status === 'RETAKE' ? <p className="text-sm text-ink-2">Your certificate has expired. Take the course again to get a new one.</p> : null}
      <div>{button}</div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The course's downloadable resources. */
function Downloads({ course: c }: { course: CourseDetail }) {
  const side = useLearner();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (f: CourseDetail['resources'][number]) => {
    setBusy(f.id);
    setError(null);
    try {
      await saveTrainingFile(side.api.file, f);
    } catch (err) {
      setError(trainingProblem(err, `Couldn’t download ${f.name}.`));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby="course-downloads" className="card card-pad flex flex-col gap-2">
      <h2 id="course-downloads" className="font-display text-base font-bold text-ink">
        Downloads
      </h2>
      <ul className="flex flex-col gap-1">
        {c.resources.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => void save(f)}
              disabled={busy === f.id}
              aria-label={`Download ${f.name}`}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_MIN}`}
            >
              <span className="text-brand">
                <DownloadIcon />
              </span>
              <span className="min-w-0 flex-1 break-words font-semibold text-ink">{f.name}</span>
              <span className="flex-none text-xs text-ink-2">{sizeText(f.sizeBytes)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** 1–5 stars (radio buttons: arrow keys move between them). */
function RateCourse({ course: c }: { course: CourseDetail }) {
  const side = useLearner();
  const qc = useQueryClient();
  const [rating, setRating] = useState<number | null>(c.myRating);
  const [said, setSaid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const rate = async (n: number) => {
    const before = rating;
    setRating(n);
    setError(null);
    setSaid('');
    try {
      await side.api.feedback(c.id, { kind: 'RATING', rating: n });
      setSaid(`Thanks — you gave it ${n} ${n === 1 ? 'star' : 'stars'}.`);
      courseChanged(qc, side, c.id);
    } catch (err) {
      setRating(before);
      setError(trainingProblem(err, 'Couldn’t save your rating.'));
    }
  };
  return (
    <section aria-labelledby={`${name}-title`} className="card card-pad flex flex-col gap-2">
      <h2 id={`${name}-title`} className="font-display text-base font-bold text-ink">
        Rate this course
      </h2>
      <fieldset>
        <legend className="sr-only">Your rating, 1 to 5 stars</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="relative grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-warning hover:bg-ground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <input type="radio" name={name} value={n} checked={rating === n} onChange={() => void rate(n)} className="sr-only" />
              <span className="sr-only">
                {n} {n === 1 ? 'star' : 'stars'}
              </span>
              <svg viewBox="0 0 24 24" width="24" height="24" fill={rating !== null && n <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
              </svg>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-ink-2" role="status">
        {said}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Questions and answers: everyone's answered ones (staff courses; no names) and your own; "Ask a question" opens a small box. */
function Questions({ course: c }: { course: CourseDetail }) {
  const side = useLearner();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const id = useId();
  const ask = async () => {
    const body = text.trim();
    if (!body) {
      setError('Write your question first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaid('');
    try {
      await side.api.feedback(c.id, { kind: 'QUESTION', body });
      setText('');
      setAsking(false);
      setSaid('Sent. The training team will answer here, and you’ll be told.');
      courseChanged(qc, side, c.id);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t send your question.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby={`${id}-title`} className="card card-pad flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-base font-bold text-ink">
          Questions
        </h2>
        <Button variant="secondary" size="sm" className={TOUCH_MIN} aria-expanded={asking} aria-controls={asking ? `${id}-box` : undefined} onClick={() => setAsking((v) => !v)}>
          Ask a question
        </Button>
      </div>
      {asking ? (
        <div id={`${id}-box`} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <label htmlFor={`${id}-ask`} className="text-sm font-semibold text-ink">
            Your question
          </label>
          <textarea
            id={`${id}-ask`}
            value={text}
            maxLength={LIMITS.feedbackBody}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className={TOUCH_MIN} onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className={TOUCH_MIN} loading={busy} onClick={() => void ask()}>
              Send question
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-ink-2 empty:hidden" role="status">
        {said}
      </p>
      {c.questions.length ? (
        <ul className="flex flex-col gap-3">
          {c.questions.map((qa) => (
            <li key={qa.id} className="rounded-xl border border-line px-3 py-2.5">
              <p className="whitespace-pre-line break-words text-sm font-semibold text-ink">{qa.question}</p>
              <p className="mt-0.5 text-xs text-ink-2">
                {qa.mine ? 'You asked' : 'Asked'} {instantDay(qa.askedAt)}
              </p>
              {qa.answer ? (
                <div className="mt-2 rounded-lg bg-ground px-3 py-2">
                  <p className="text-xs font-semibold text-ink-2">Answer{qa.answeredAt ? ` · ${instantDay(qa.answeredAt)}` : ''}</p>
                  <p className="mt-0.5 whitespace-pre-line break-words text-sm text-ink">{qa.answer}</p>
                </div>
              ) : (
                <p className="mt-1 text-xs font-semibold text-warning">Waiting for an answer</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
