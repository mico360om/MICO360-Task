import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AttemptPaper, AttemptResult, AttemptResultQuestion, LessonDone, LessonView, PaperQuestion } from '../../api/training';
import { ApiError } from '../../lib/api-client';
import { Button, buttonClass } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CourseFinished } from './CourseFinished';
import { coursePath, lessonPath, useLearner } from './learner';
import { sideKeys } from './training-queries';
import { TOUCH_MIN, TickIcon, trainingProblem } from './training-ui';
import { clockLeft, quizStartLine } from './training-words';

/** How soon after a change the answers are saved (and again every few seconds while some are unsaved). */
export const ANSWERS_SAVE_MS = 1_500;
/** The countdown says so when this much time is left. */
const LAST_MINUTE_MS = 60_000;

type Answers = Record<string, string[]>;

/** The answers to start from: the saved draft; an ORDER question starts in the order shown (it is always answered). */
export function startingAnswers(paper: AttemptPaper): Answers {
  const out: Answers = {};
  for (const q of paper.questions) out[q.id] = paper.answers[q.id]?.length ? [...paper.answers[q.id]!] : q.kind === 'ORDER' ? q.options.map((o) => o.id) : [];
  return out;
}

export const unansweredOf = (paper: AttemptPaper, answers: Answers) => paper.questions.filter((q) => q.kind !== 'ORDER' && !(answers[q.id]?.length ?? 0));

/** "2 tries left", "no tries left", "try as often as you like". */
const triesText = (left: number | null) => (left === null ? 'try as often as you like' : left === 0 ? 'no tries left' : `${left} ${left === 1 ? 'try' : 'tries'} left`);

/**
 * A quiz lesson (owner answer 5; 12 Nov §5): one line ("5 questions · pass with 70% · try as often as you like") and
 * Start quiz; then one question a page with Back / Next, Hand in on the last one or once all are answered, a
 * countdown when there is a time limit (handed in by itself at 0); then the result — passed: the score, "Course
 * completed" with the certificate when this finished the course, Next, and the answers behind "See your answers";
 * not passed: the score, which questions were wrong (never the right answers before passing: review M9) and Try again.
 */
export function QuizLesson({ lesson, onDone }: { lesson: LessonView; onDone: (done: LessonDone) => void }) {
  const side = useLearner();
  const qc = useQueryClient();
  const quiz = lesson.quiz;
  const [paper, setPaper] = useState<AttemptPaper | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState<'start' | 'last' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!quiz) return <p className="card card-pad text-sm text-ink-2">This quiz isn’t ready yet.</p>;

  // The one way on after passing: the next lesson; My learning once the course is finished; else the course.
  const next = (finished: boolean) =>
    lesson.nextLessonId
      ? { label: 'Next lesson', to: lessonPath(side.base, lesson.courseId, lesson.nextLessonId) }
      : finished
        ? { label: 'Next', to: side.base }
        : { label: 'Back to the course', to: coursePath(side.base, lesson.courseId) };

  const start = async () => {
    setBusy('start');
    setError(null);
    try {
      const p = await side.api.startAttempt(lesson.id);
      setResult(null);
      setPaper(p);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t start the quiz.'));
    } finally {
      setBusy(null);
    }
  };

  const showLast = async () => {
    if (!quiz.lastAttemptId) return;
    setBusy('last');
    setError(null);
    try {
      setFresh(false);
      setResult(await side.api.result(quiz.lastAttemptId));
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t load your last result.'));
    } finally {
      setBusy(null);
    }
  };

  const handedIn = (r: AttemptResult) => {
    setPaper(null);
    setFresh(true);
    setResult(r);
    // The lesson's attempts and best score change: read it again for the start.
    void qc.invalidateQueries({ queryKey: sideKeys.lesson(side, lesson.id), exact: true });
    // Passed: the lesson is done (the course may be finished, a certificate ready).
    if (r.passed) onDone({ courseProgressPct: lesson.courseProgressPct, courseCompleted: r.courseCompleted, certificateId: r.certificateId, nextLessonId: lesson.nextLessonId });
  };

  if (paper) return <QuizPaper paper={paper} onResult={handedIn} />;
  if (result) {
    const again = !result.passed && (result.attemptsLeft === null || result.attemptsLeft > 0);
    // Course completed is said when this hand-in finished it (not when an old result is read again).
    const finished = fresh && result.passed && result.courseCompleted;
    return (
      <QuizResultView
        result={result}
        courseTitle={lesson.courseTitle}
        finished={finished}
        openAnswers={!fresh}
        next={result.passed ? next(result.courseCompleted) : null}
        canTryAgain={again}
        busy={busy === 'start'}
        error={error}
        onTryAgain={() => void start()}
      />
    );
  }

  const passed = quiz.best?.passed === true;
  const line = quizStartLine(quiz);
  return (
    <section aria-label="Quiz" className="card card-pad flex flex-col gap-3">
      {passed ? (
        <p className="inline-flex items-center gap-2 font-semibold text-success">
          <TickIcon />
          {`You passed with ${quiz.best!.scorePct}%.`}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink">{line}</p>
          {quiz.best ? <p className="text-sm text-ink-2">{`Your best so far: ${quiz.best.scorePct}%.`}</p> : null}
          {quiz.timeLimitMinutes ? <p className="text-xs text-ink-2">The clock starts when you start. When the time is up, your answers are handed in by themselves.</p> : null}
          {!quiz.canStart && quiz.reason ? <p className="text-sm text-ink-2">{quiz.reason}</p> : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {passed ? (
          <>
            {quiz.lastAttemptId ? (
              <Button variant="secondary" className={TOUCH_MIN} loading={busy === 'last'} onClick={() => void showLast()}>
                See your answers
              </Button>
            ) : null}
            <Link to={next(lesson.courseProgressPct >= 100).to} className={buttonClass('primary', 'md', TOUCH_MIN)}>
              {next(lesson.courseProgressPct >= 100).label}
            </Link>
          </>
        ) : quiz.openAttemptId ? (
          <Button className={TOUCH_MIN} loading={busy === 'start'} onClick={() => void start()}>
            Resume quiz
          </Button>
        ) : quiz.canStart ? (
          <Button className={TOUCH_MIN} loading={busy === 'start'} onClick={() => void start()}>
            {quiz.attemptsUsed > 0 ? 'Try again' : 'Start quiz'}
          </Button>
        ) : null}
        {!passed && quiz.lastAttemptId ? (
          <Button variant="ghost" className={TOUCH_MIN} loading={busy === 'last'} onClick={() => void showLast()}>
            See your last result
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The attempt: questions, answers saved as they go, the countdown, Hand in. */
function QuizPaper({ paper, onResult }: { paper: AttemptPaper; onResult: (r: AttemptResult) => void }) {
  const { api } = useLearner();
  const [answers, setAnswers] = useState<Answers>(() => startingAnswers(paper));
  const [at, setAt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [now, setNow] = useState(() => Date.now());
  const [said, setSaid] = useState('');
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const dirty = useRef(false);
  const handingIn = useRef(false);
  const lastMinuteSaid = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const deadline = paper.deadlineAt ? Date.parse(paper.deadlineAt) : null;
  const left = deadline === null ? null : deadline - now;

  const saveNow = async () => {
    if (!dirty.current || handingIn.current) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      await api.saveAnswers(paper.id, answersRef.current);
      setSaveState(dirty.current ? 'unsaved' : 'saved');
    } catch {
      dirty.current = true;
      setSaveState('failed');
    }
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  // Saved shortly after each change, and again every few seconds while something is unsaved.
  useEffect(() => {
    const t = window.setInterval(() => void saveRef.current(), ANSWERS_SAVE_MS * 3);
    return () => {
      window.clearInterval(t);
      void saveRef.current();
    };
  }, []);

  const change = (qid: string, value: string[]) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    dirty.current = true;
    setSaveState('unsaved');
  };
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void saveRef.current(), ANSWERS_SAVE_MS);
    return () => window.clearTimeout(t);
  }, [answers]);

  const handIn = async () => {
    if (handingIn.current) return;
    handingIn.current = true;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      onResult(await api.submit(paper.id, answersRef.current));
    } catch (err) {
      // Handed in already (by the server, when the time ran out): its result.
      if (err instanceof ApiError && err.status === 409 && (err.code === 'TIME_UP' || err.code === 'SUBMITTED')) {
        try {
          onResult(await api.result(paper.id));
          return;
        } catch {
          /* fall through to the message */
        }
      }
      handingIn.current = false;
      setError(trainingProblem(err, 'Couldn’t hand in your answers.'));
    } finally {
      setBusy(false);
    }
  };
  const handInRef = useRef(handIn);
  handInRef.current = handIn;

  // The countdown: a second at a time; said at one minute; handed in by itself at 0.
  useEffect(() => {
    if (deadline === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [deadline]);
  useEffect(() => {
    if (left === null) return;
    if (left <= LAST_MINUTE_MS && left > 0 && !lastMinuteSaid.current) {
      lastMinuteSaid.current = true;
      setSaid('One minute left.');
    }
    if (left <= 0 && !handingIn.current) {
      setSaid('Time is up. Your answers are being handed in.');
      void handInRef.current();
    }
  }, [left]);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [at]);

  const questions = paper.questions;
  const unanswered = unansweredOf(paper, answers);
  const goTo = (i: number) => {
    moved.current = true;
    setAt(Math.min(Math.max(0, i), questions.length - 1));
  };
  const shown = questions[at] ? [{ q: questions[at]!, i: at }] : [];
  const last = at === questions.length - 1;

  return (
    <section aria-label="Quiz" className="flex flex-col gap-4">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <ol aria-label="Questions" className="flex flex-wrap gap-1.5">
            {questions.map((q, i) => {
              const done = q.kind === 'ORDER' || (answers[q.id]?.length ?? 0) > 0;
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Question ${i + 1}, ${done ? 'answered' : 'not answered'}`}
                    aria-current={i === at ? 'step' : undefined}
                    className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${
                      i === at ? 'bg-brand text-white' : done ? 'bg-brand/15 text-brand' : 'border border-line bg-surface text-ink-2 hover:bg-ground'
                    }`}
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-ink-2" aria-live="polite">
            {saveState === 'saving' ? 'Saving your answers…' : saveState === 'failed' ? 'Your answers couldn’t be saved just now — trying again.' : saveState === 'unsaved' ? 'Saving soon…' : 'Your answers are saved as you go.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {left !== null ? (
            <span data-quiz-clock className={`rounded-lg px-3 py-1.5 font-mono text-sm font-semibold tabular-nums ${left <= LAST_MINUTE_MS ? 'bg-danger-soft text-danger' : 'bg-ground text-ink'}`}>
              <span className="sr-only">Time left: </span>
              {clockLeft(left)}
            </span>
          ) : null}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="assertive">
        {said}
      </p>

      {shown.map(({ q, i }) => (
        <QuestionCard
          key={q.id}
          q={q}
          index={i}
          total={questions.length}
          value={answers[q.id] ?? []}
          onChange={(v) => change(q.id, v)}
          headingRef={i === at ? heading : undefined}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {at > 0 ? (
          <Button variant="secondary" className={TOUCH_MIN} onClick={() => goTo(at - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {!last ? (
            <Button variant={unanswered.length ? 'primary' : 'secondary'} className={TOUCH_MIN} onClick={() => goTo(at + 1)}>
              Next
            </Button>
          ) : null}
          {last || unanswered.length === 0 ? (
            <Button className={TOUCH_MIN} loading={busy} onClick={() => (unanswered.length ? setConfirming(true) : void handIn())}>
              Hand in
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={unanswered.length === 1 ? 'Hand in with 1 question unanswered?' : `Hand in with ${unanswered.length} questions unanswered?`}
          confirmLabel="Hand in"
          keepLabel="Keep answering"
          tone="primary"
          onConfirm={() => void handIn()}
          onClose={() => setConfirming(false)}
        >
          An unanswered question counts as wrong.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** One question: radios (one answer, true or false), checkboxes (all that apply), or an order to put right. */
function QuestionCard({
  q,
  index,
  total,
  value,
  onChange,
  headingRef,
}: {
  q: PaperQuestion;
  index: number;
  total: number;
  value: string[];
  onChange: (v: string[]) => void;
  headingRef?: RefObject<HTMLHeadingElement>;
}) {
  const name = `answer-${q.id}`;
  const hint = q.kind === 'MULTIPLE' ? 'Choose all that apply.' : q.kind === 'ORDER' ? 'Put these in the right order with the Move up and Move down buttons.' : null;
  return (
    <section id={`question-${q.id}`} aria-labelledby={`${name}-title`} className="card card-pad flex scroll-mt-20 flex-col gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Question {index + 1} of {total}
        </p>
        <h2 id={`${name}-title`} ref={headingRef} tabIndex={-1} className="mt-1 whitespace-pre-line break-words font-display text-base font-bold text-ink outline-none">
          {q.prompt}
        </h2>
        {hint ? <p className="mt-1 text-xs text-ink-2">{hint}</p> : null}
      </div>
      {q.kind === 'ORDER' ? (
        <OrderAnswer q={q} value={value} onChange={onChange} />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{q.prompt}</legend>
          {q.options.map((o) => {
            const checked = value.includes(o.id);
            const multiple = q.kind === 'MULTIPLE';
            return (
              <label
                key={o.id}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${checked ? 'border-brand bg-brand/5 text-ink' : 'border-line bg-surface text-ink hover:bg-ground'}`}
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={name}
                  value={o.id}
                  checked={checked}
                  onChange={() => onChange(multiple ? (checked ? value.filter((v) => v !== o.id) : [...value, o.id]) : [o.id])}
                  className="mt-0.5 h-4 w-4 flex-none accent-brand"
                />
                <span className="min-w-0 break-words">{o.text}</span>
              </label>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}

/** Put the steps in order: Move up / Move down on each (keyboard and touch; no dragging needed). */
function OrderAnswer({ q, value, onChange }: { q: PaperQuestion; value: string[]; onChange: (v: string[]) => void }) {
  const text = new Map(q.options.map((o) => [o.id, o.text]));
  const order = value.length === q.options.length ? value : q.options.map((o) => o.id);
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [said, setSaid] = useState('');
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    buttons.current.get(focus)?.focus();
    setFocus(null);
  }, [focus, order]);

  const move = (id: string, by: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    next[i] = order[j]!;
    next[j] = id;
    onChange(next);
    setSaid(`Moved “${text.get(id)}” to place ${j + 1} of ${order.length}.`);
    // Keep the focus on the moved item: the same button, or the other one at the end of the list.
    const edge = (by === -1 && j === 0) || (by === 1 && j === order.length - 1);
    setFocus(`${id}:${edge ? (by === -1 ? 'down' : 'up') : by === -1 ? 'up' : 'down'}`);
  };

  return (
    <div>
      <ol className="flex flex-col gap-2">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span className="w-6 flex-none text-end font-semibold tabular-nums text-ink-2">{i + 1}.</span>
            <span className="min-w-0 flex-1 break-words text-ink">{text.get(id)}</span>
            <span className="flex flex-none gap-1">
              <button
                type="button"
                ref={(el) => void buttons.current.set(`${id}:up`, el)}
                onClick={() => move(id, -1)}
                disabled={i === 0}
                aria-label={`Move “${text.get(id)}” up`}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                ref={(el) => void buttons.current.set(`${id}:down`, el)}
                onClick={() => move(id, 1)}
                disabled={i === order.length - 1}
                aria-label={`Move “${text.get(id)}” down`}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * The result (12 Nov §5). Passed: the score, "Course completed" with the certificate (when this finished the course),
 * the one Next, and the answers folded behind "See your answers". Not passed: the score, the questions that were wrong
 * (the right answers only once the server shows them: passed, or no tries left — review M9) and Try again.
 */
function QuizResultView({
  result,
  courseTitle,
  finished,
  openAnswers,
  next,
  canTryAgain,
  busy,
  error,
  onTryAgain,
}: {
  result: AttemptResult;
  courseTitle: string;
  finished: boolean;
  openAnswers: boolean;
  next: { label: string; to: string } | null;
  canTryAgain: boolean;
  busy: boolean;
  error: string | null;
  onTryAgain: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [showAnswers, setShowAnswers] = useState(openAnswers);
  const answersId = useId();
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const right = result.questions.filter((q) => q.right).length;
  const wrong = result.questions.filter((q) => !q.right);
  const canSee = result.passed || result.answersShown;
  return (
    <section aria-labelledby="quiz-result" className="flex flex-col gap-4">
      <div className={`card card-pad flex flex-col gap-2 border-s-4 ${result.passed ? 'border-success' : 'border-danger'}`}>
        <h2 id="quiz-result" ref={heading} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
          {result.passed ? 'You passed' : 'Not passed this time'} — {result.scorePct}%
        </h2>
        <p className="text-sm text-ink-2">{`${right} of ${result.questions.length} right · pass mark ${result.passMark}% · ${triesText(result.attemptsLeft)}`}</p>
        {result.timedOut ? <p className="text-sm text-warning">Time ran out — your saved answers were handed in.</p> : null}
        {!result.passed && wrong.length ? (
          <div>
            <p className="text-sm font-semibold text-ink">Wrong:</p>
            <ul aria-label="Wrong answers" className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
              {wrong.map((q) => (
                <li key={q.id} className="whitespace-pre-line break-words">
                  {q.prompt}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canTryAgain ? (
          <div>
            <Button className={TOUCH_MIN} loading={busy} onClick={onTryAgain}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
      {finished ? <CourseFinished title={courseTitle} certificateId={result.certificateId} focus={false} /> : null}
      {next ? (
        <div>
          <Link to={next.to} className={buttonClass('primary', 'lg', '!min-h-[44px]')}>
            {next.label}
          </Link>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {canSee ? (
        <div className="flex flex-col gap-3">
          {openAnswers ? null : (
            <button
              type="button"
              aria-expanded={showAnswers}
              aria-controls={answersId}
              onClick={() => setShowAnswers((v) => !v)}
              className={`self-start text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN}`}
            >
              See your answers
            </button>
          )}
          {showAnswers ? (
            <ol id={answersId} className="flex flex-col gap-3">
              {result.questions.map((q, i) => (
                <li key={q.id}>
                  <ResultQuestion q={q} index={i} shown={result.answersShown} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ResultQuestion({ q, index, shown }: { q: AttemptResultQuestion; index: number; shown: boolean }) {
  const byId = new Map(q.options.map((o) => [o.id, o]));
  return (
    <article aria-labelledby={`result-${q.id}`} className="card card-pad flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${q.right ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
        >
          {q.right ? '✓' : '✗'}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Question {index + 1} · <span className={q.right ? 'text-success' : 'text-danger'}>{q.right ? 'Right' : 'Wrong'}</span>
          </p>
          <h3 id={`result-${q.id}`} className="whitespace-pre-line break-words font-semibold text-ink">
            {q.prompt}
          </h3>
        </div>
      </div>
      {q.kind === 'ORDER' ? (
        <div className={`grid gap-3 ${shown ? 'sm:grid-cols-2' : ''}`}>
          <div>
            <p className="text-xs font-semibold text-ink-2">Your order</p>
            <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm text-ink">
              {(q.chosen.length ? q.chosen : []).map((id) => (
                <li key={id}>{byId.get(id)?.text ?? ''}</li>
              ))}
            </ol>
            {q.chosen.length === 0 ? <p className="text-sm text-ink-2">Not answered.</p> : null}
          </div>
          {shown ? (
            <div>
              <p className="text-xs font-semibold text-ink-2">The right order</p>
              <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm text-ink">
                {[...q.options]
                  .sort((a, b) => a.position - b.position)
                  .map((o) => (
                    <li key={o.id}>{o.text}</li>
                  ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.options.map((o) => {
            const chosen = q.chosen.includes(o.id);
            // Before the answers are shown: only "your answer" is marked (the question's right/wrong says the rest).
            const tone = shown ? (o.correct ? 'border-success/50 bg-success-soft/40' : chosen ? 'border-danger/50 bg-danger-soft/40' : 'border-line') : chosen ? 'border-brand/40 bg-brand/5' : 'border-line';
            return (
              <li key={o.id} className={`rounded-xl border px-3 py-2 text-sm ${tone}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-ink">{o.text}</span>
                  {chosen ? <span className="rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">Your answer</span> : null}
                  {shown && o.correct ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success">
                      <TickIcon size={12} />
                      Right answer
                    </span>
                  ) : null}
                </div>
                {o.feedback && (chosen || (shown && o.correct)) ? <p className="mt-1 text-xs text-ink-2">{o.feedback}</p> : null}
              </li>
            );
          })}
          {q.chosen.length === 0 ? <li className="text-sm text-ink-2">Not answered.</li> : null}
        </ul>
      )}
      {shown && q.explanation ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink">
          <span className="font-semibold">Why: </span>
          {q.explanation}
        </p>
      ) : null}
    </article>
  );
}
