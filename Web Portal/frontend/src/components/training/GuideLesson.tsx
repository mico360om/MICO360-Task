import { useEffect, useRef, useState } from 'react';
import type { LessonDone, LessonStep, LessonView } from '../../api/training';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button } from '../ui/Button';
import { useLearner } from './learner';
import { TOUCH_MIN, TickIcon, trainingProblem, useBlobUrl } from './training-ui';

/** Wide enough for the steps' list beside the step (Tailwind's lg). */
const WIDE = '(min-width: 64em)';

/**
 * A step-by-step guide: one numbered step at a time (its picture and words), Back and Next, the place saved as
 * you go and resumed next time; "Done" on the last step. On a wide screen the steps are listed beside it too.
 */
export function GuideLesson({ lesson, onDone }: { lesson: LessonView; onDone: (done: LessonDone) => void }) {
  const { api } = useLearner();
  const steps = lesson.steps;
  const last = Math.max(0, steps.length - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, lesson.progress.stepIndex), last));
  const [done, setDone] = useState(lesson.progress.done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wide = useMediaQuery(WIDE);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const go = (to: number) => {
    const next = Math.min(Math.max(0, to), last);
    if (next === index) return;
    moved.current = true;
    setIndex(next);
    // The place is saved as they go (a failure only means they start a step earlier next time).
    void api.saveProgress(lesson.id, { stepIndex: next }).catch(() => undefined);
  };

  // A screen reader hears the new step (focus to its heading) — not when the page first opens.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.complete(lesson.id);
      setDone(true);
      onDone(out);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t finish this guide.'));
    } finally {
      setBusy(false);
    }
  };

  if (steps.length === 0) {
    return (
      <div className="card card-pad flex flex-col items-start gap-3">
        <p className="text-sm text-ink-2">This guide has no steps yet.</p>
        {done ? <DoneMark /> : <Button className={TOUCH_MIN} loading={busy} onClick={() => void finish()}>Done</Button>}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    );
  }

  const step = steps[index]!;
  return (
    <div className={wide ? 'grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-5' : 'flex flex-col gap-4'}>
      {wide ? (
        <nav aria-label="Steps" className="card card-pad sticky top-20">
          <ol className="flex flex-col gap-0.5">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? 'step' : undefined}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-sm transition-colors ${i === index ? 'bg-brand/10 font-semibold text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
                >
                  <span className="w-5 flex-none text-end tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 break-words">{s.title || `Step ${i + 1}`}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <section aria-labelledby={`step-${step.id}`} className="card card-pad flex min-w-0 flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id={`step-${step.id}`} ref={heading} tabIndex={-1} className="mt-1 font-display text-lg font-bold text-ink outline-none">
            {step.title || `Step ${index + 1}`}
          </h2>
        </div>
        {step.image ? <StepPicture step={step} /> : null}
        {step.body ? <RichNoteView html={step.body} className="text-sm text-ink" /> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="secondary" className={TOUCH_MIN} disabled={index === 0} onClick={() => go(index - 1)}>
            Back
          </Button>
          {index < last ? (
            <Button className={TOUCH_MIN} onClick={() => go(index + 1)}>
              Next step
            </Button>
          ) : done ? (
            <DoneMark />
          ) : (
            <Button className={TOUCH_MIN} loading={busy} onClick={() => void finish()}>
              Done
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

const DoneMark = () => (
  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
    <TickIcon />
    Guide done
  </span>
);

/** A step's picture: fetched with the person's sign-in (training files are private), shown from memory. */
function StepPicture({ step }: { step: LessonStep }) {
  const { api } = useLearner();
  const pic = useBlobUrl(api.file, step.image?.fileId);
  if (pic.failed) return <p className="rounded-lg bg-ground px-3 py-6 text-center text-sm text-ink-2">The picture couldn’t load.</p>;
  if (!pic.url) return <div role="status" aria-label="Loading the picture" className="aspect-video w-full animate-pulse rounded-xl bg-ground motion-reduce:animate-none" />;
  return <img src={pic.url} alt={step.image?.alt ?? ''} className="h-auto max-w-full rounded-xl border border-line" />;
}
