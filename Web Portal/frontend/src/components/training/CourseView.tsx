import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS, MODULE_LABELS, TRAINING_MODULES, type CertificateRef, type CourseDetail, type TrainingModule } from '../../api/training';
import { ApiError } from '../../lib/api-client';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';
import { Button } from '../ui/Button';
import { ProgressBar } from '../portal/portal-ui';
import { lessonPath, useLearner } from './learner';
import { courseChanged, useCourse } from './training-queries';
import {
  AwardIcon,
  CourseFacts,
  DifficultyChip,
  DownloadIcon,
  LessonKindIcon,
  LockIcon,
  MandatoryChip,
  OverdueChip,
  RatingLine,
  StarterBadge,
  StatusChip,
  TOUCH_MIN,
  TickIcon,
  saveTrainingFile,
  sizeText,
  trainingProblem,
} from './training-ui';
import { ACTION_WORDS, CERTIFICATE_WORDS, LESSON_KIND_WORDS, courseAction, dueText, instantDay, minutesText } from './training-words';

const isModule = (v: string | null): v is TrainingModule => !!v && (TRAINING_MODULES as readonly string[]).includes(v);

/**
 * A course's page (staff and the Client portal): what it is, Start / Resume / Review / Retake, the progress, the
 * lessons (done, locked, to review), downloads, the certificate, a rating and questions. Breadcrumbs "Learning Hub ›
 * the course"; `?module=` (from the catalogue filtered to a module, or Learn this feature) adds that module's courses.
 */
export function CourseView({ courseId, renderHeader }: { courseId: string; renderHeader: (title: string) => ReactNode }) {
  const side = useLearner();
  const q = useCourse(courseId);
  const [params] = useSearchParams();
  // A course opened from a card far down a list starts at the top of its page.
  useEffect(() => {
    document.scrollingElement?.scrollTo?.(0, 0);
  }, [courseId]);
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

  if (q.isPending) {
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
      <CourseBody course={q.data} />
    </div>
  );
}

function CourseBody({ course: c }: { course: CourseDetail }) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = c.mine;
  const action = courseAction(m);
  const due = dueText(m);
  const firstId = c.lessons[0]?.id ?? null;
  const target = action === 'review' ? firstId : (c.resumeLessonId ?? firstId);

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

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <section aria-label="About this course" className="card card-pad flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{MODULE_LABELS[c.moduleKey]}</span>
            <DifficultyChip difficulty={c.difficulty} />
            {c.starter ? <StarterBadge /> : null}
            {m.mandatory ? <MandatoryChip /> : null}
          </div>
          {c.summary ? <p className="whitespace-pre-line break-words text-sm text-ink">{c.summary}</p> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CourseFacts course={c} />
            <RatingLine rating={c.rating} />
            {c.certificateOn ? (
              <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                <AwardIcon size={14} />
                Certificate{c.certificateMonths ? `, valid ${c.certificateMonths} months` : ''}
              </span>
            ) : null}
          </div>
          {c.completionRule === 'QUIZZES' ? <p className="text-xs text-ink-2">Pass the quizzes to complete this course.</p> : null}
          {c.inOrder ? <p className="text-xs text-ink-2">Take the lessons in order: each opens when the one before it is done.</p> : null}
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={m.status} />
              {m.overdue ? <OverdueChip /> : null}
              {due && m.status !== 'COMPLETED' ? <span className={`text-sm font-semibold ${m.overdue ? OVERDUE_CLASS.text : 'text-ink-2'}`}>{due}</span> : null}
              {m.completedAt && m.status === 'COMPLETED' ? <span className="text-sm text-ink-2">Completed {instantDay(m.completedAt)}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ProgressBar percent={m.progressPct} label={`Your progress: ${m.progressPct}%`} />
              </div>
              <span className="flex-none text-sm font-semibold text-ink">{m.progressPct}%</span>
            </div>
            {m.status === 'REVIEW' ? <p className="text-sm text-ink-2">Some lessons changed since you finished. Review the ones marked “Review” — your certificate stays valid meanwhile.</p> : null}
            {m.status === 'RETAKE' ? <p className="text-sm text-ink-2">Your certificate has expired. Take the course again to get a new one.</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {target ? (
                <Button className={TOUCH_MIN} loading={busy} onClick={() => void go()}>
                  {ACTION_WORDS[action]}
                </Button>
              ) : (
                <p className="text-sm text-ink-2">This course has no lessons yet.</p>
              )}
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="course-lessons" className="card card-pad">
          <h2 id="course-lessons" className="mb-3 font-display text-base font-bold text-ink">
            Lessons
          </h2>
          <ol className="flex flex-col divide-y divide-line">
            {c.lessons.map((l, i) => {
              const inner = (
                <>
                  <span className="w-6 flex-none pt-0.5 text-end text-sm font-semibold tabular-nums text-ink-3">{i + 1}.</span>
                  <span className={`mt-0.5 flex-none ${l.done ? 'text-success' : 'text-ink-2'}`}>
                    <LessonKindIcon kind={l.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words text-sm font-semibold ${l.locked ? 'text-ink-2' : 'text-ink'}`}>{l.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                      <span>{LESSON_KIND_WORDS[l.kind]}</span>
                      {minutesText(l.minutes) ? <span>· {minutesText(l.minutes)}</span> : null}
                    </span>
                  </span>
                  <span className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                    {l.review ? <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">Review</span> : null}
                    {l.done ? (
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS.DONE.chip}`}>
                        <TickIcon size={12} />
                        Done
                      </span>
                    ) : null}
                    {l.locked ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2">
                        <LockIcon size={13} />
                        Locked
                      </span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li key={l.id}>
                  {l.locked ? (
                    <div className="flex items-start gap-2.5 py-2.5" title="Finish the lessons before it first">
                      {inner}
                      <span className="sr-only">Finish the lessons before it first.</span>
                    </div>
                  ) : (
                    <Link to={lessonPath(side.base, c.id, l.id)} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40">
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
          {c.lessons.length === 0 ? <p className="text-sm text-ink-2">No lessons yet.</p> : null}
        </section>

        <Questions course={c} />
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        {m.certificate ? <CertificateCard certificate={m.certificate} /> : null}
        {c.resources.length ? <Downloads course={c} /> : null}
        {m.enrolled ? <RateCourse course={c} /> : null}
      </aside>
    </div>
  );
}

/** The certificate: its code, valid / expired / revoked, its dates, the PDF and the public check. */
function CertificateCard({ certificate: cert }: { certificate: CertificateRef }) {
  const side = useLearner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = cert.status === 'VALID' ? 'bg-success-soft text-success' : cert.status === 'EXPIRED' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger';
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await side.api.certificatePdf(cert.id);
      downloadBlob(fileNameOf(blob) ?? `certificate-${cert.code}.pdf`, blob);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t download the certificate.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="course-certificate" className="card card-pad flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="course-certificate" className="inline-flex items-center gap-2 font-display text-base font-bold text-ink">
          <AwardIcon />
          Certificate
        </h2>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>{CERTIFICATE_WORDS[cert.status]}</span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-2">Code</dt>
        <dd className="break-all font-mono font-semibold text-ink">{cert.code}</dd>
        <dt className="text-ink-2">Issued</dt>
        <dd className="text-ink">{instantDay(cert.issuedAt)}</dd>
        <dt className="text-ink-2">Expires</dt>
        <dd className="text-ink">{cert.expiresAt ? instantDay(cert.expiresAt) : 'Never'}</dd>
      </dl>
      <Button variant="secondary" className={TOUCH_MIN} loading={busy} onClick={() => void download()}>
        <DownloadIcon />
        Download certificate (PDF)
      </Button>
      <Link to={`/verify/${encodeURIComponent(cert.code)}`} className={`text-sm font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_MIN} inline-flex items-center`}>
        Check it online
      </Link>
      {error ? (
        <p role="alert" className="text-sm text-danger">
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

/** Questions and answers: everyone's answered ones (staff courses; no names) and your own; "Ask a question". */
function Questions({ course: c }: { course: CourseDetail }) {
  const side = useLearner();
  const qc = useQueryClient();
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
      <h2 id={`${id}-title`} className="font-display text-base font-bold text-ink">
        Questions
      </h2>
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
      ) : (
        <p className="text-sm text-ink-2">No questions yet.</p>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <label htmlFor={`${id}-ask`} className="text-sm font-semibold text-ink">
          Ask a question
        </label>
        <textarea
          id={`${id}-ask`}
          value={text}
          maxLength={LIMITS.feedbackBody}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-2" role="status">
            {said}
          </p>
          <Button variant="secondary" className={TOUCH_MIN} loading={busy} onClick={() => void ask()}>
            Send question
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
