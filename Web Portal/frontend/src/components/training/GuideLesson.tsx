import { useEffect, useRef, useState } from 'react';
import type { LessonDone, LessonStep, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { useLearner } from './learner';
import { TOUCH_MIN, TickIcon, trainingProblem, useBlobUrl } from './training-ui';

/** The lesson's one way on (12 Nov §4): "Next lesson", "Finish course" or "Back to the course", and what it does. */
export interface LessonNext {
  label: string;
  /** After the lesson is done: `d` is what the server said (null: it was done before). */
  go: (d: LessonDone | null) => void;
}

/**
 * A step-by-step guide (12 Nov §4): one step at a time — "Step 2 of 6" and a thin bar, its picture (tap or click to
 * enlarge) and words, Back and one Next. On the last step the Next is the lesson's own ("Next lesson" or "Finish
 * course"): it finishes the guide and goes on. The place is saved as you go and resumed next time.
 */
export function GuideLesson({ lesson, onDone, next }: { lesson: LessonView; onDone: (done: LessonDone) => void; next: LessonNext }) {
  const { api } = useLearner();
  const steps = lesson.steps;
  const last = Math.max(0, steps.length - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, lesson.progress.stepIndex), last));
  const [done, setDone] = useState(lesson.progress.done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const go = (to: number) => {
    const target = Math.min(Math.max(0, to), last);
    if (target === index) return;
    moved.current = true;
    setIndex(target);
    // The place is saved as they go (a failure only means they start a step earlier next time).
    void api.saveProgress(lesson.id, { stepIndex: target }).catch(() => undefined);
  };

  // A screen reader hears the new step (focus to its heading) — not when the page first opens.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);

  const finish = async () => {
    if (done) {
      next.go(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.complete(lesson.id);
      setDone(true);
      onDone(out);
      next.go(out);
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t finish this guide.'));
    } finally {
      setBusy(false);
    }
  };

  const finishButton = (
    <Button className={TOUCH_MIN} loading={busy} onClick={() => void finish()}>
      {next.label}
    </Button>
  );

  if (steps.length === 0) {
    return (
      <div className="card card-pad flex flex-col items-start gap-3">
        <p className="text-sm text-ink-2">This guide has no steps yet.</p>
        {finishButton}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    );
  }

  const step = steps[index]!;
  const pct = Math.round(((index + 1) / steps.length) * 100);
  const where = `Step ${index + 1} of ${steps.length}`;
  return (
    <section aria-labelledby={`step-${step.id}`} className="card card-pad flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{where}</p>
          {done ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
              <TickIcon size={13} />
              Done
            </span>
          ) : null}
        </div>
        <div role="progressbar" aria-label={where} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-full bg-ground">
          <div className="h-full rounded-full bg-brand transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
        <h2 id={`step-${step.id}`} ref={heading} tabIndex={-1} className="mt-1 font-display text-lg font-bold text-ink outline-none">
          {step.title || `Step ${index + 1}`}
        </h2>
      </div>
      {step.image ? <StepPicture step={step} /> : null}
      {step.body ? <RichNoteView html={step.body} className="text-sm text-ink" /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {index > 0 ? (
          <Button variant="secondary" className={TOUCH_MIN} onClick={() => go(index - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {index < last ? (
          <Button className={TOUCH_MIN} onClick={() => go(index + 1)}>
            Next
          </Button>
        ) : (
          finishButton
        )}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const ZoomIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </svg>
);

/** A step's picture: fetched with the person's sign-in (training files are private); tap or click to enlarge. */
function StepPicture({ step }: { step: LessonStep }) {
  const { api } = useLearner();
  const pic = useBlobUrl(api.file, step.image?.fileId);
  const [big, setBig] = useState(false);
  const alt = step.image?.alt ?? '';
  if (pic.failed) return <p className="rounded-lg bg-ground px-3 py-6 text-center text-sm text-ink-2">The picture couldn’t load.</p>;
  if (!pic.url) return <div role="status" aria-label="Loading the picture" className="aspect-video w-full animate-pulse rounded-xl bg-ground motion-reduce:animate-none" />;
  return (
    <>
      <div className="relative self-start">
        <img src={pic.url} alt={alt} className="block h-auto max-w-full rounded-xl border border-line" />
        <button
          type="button"
          onClick={() => setBig(true)}
          aria-label={alt ? `Enlarge the picture: ${alt}` : 'Enlarge the picture'}
          className="absolute inset-0 cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span className="absolute bottom-2 end-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white">
            <ZoomIcon />
          </span>
        </button>
      </div>
      {big ? <PictureDialog url={pic.url} alt={alt} onClose={() => setBig(false)} /> : null}
    </>
  );
}

/** The picture as big as the screen allows (phones especially); Escape, Close or a tap outside closes it. */
function PictureDialog({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label={alt || 'Picture'} className={`card relative ${dialogPanel('wide')} flex animate-scale-in flex-col gap-2 p-2`}>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" className={TOUCH_MIN} onClick={onClose}>
              Close
            </Button>
          </div>
          <div className="min-h-0 overflow-auto">
            <img src={url} alt={alt} className="mx-auto h-auto max-h-[calc(var(--visible-height)-6rem)] w-auto max-w-full object-contain" />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
