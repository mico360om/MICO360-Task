import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LessonStep, LessonView } from '../../api/training';
import { useDialog } from '../../hooks/useDialog';
import { RichNoteView } from '../rich-text/RichNoteView';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { LessonControls, WayButton, type LessonWay } from './LessonNav';
import { useLearner } from './learner';
import { TOUCH_MIN, TickIcon, useBlobUrl } from './training-ui';

/**
 * A step-by-step guide (12 Nov §4; 1.23.36 look): one step at a time — "Step 2 of 6" with a dot for each step (press
 * one to go there; no second bar on the page), its picture (tap or click to enlarge) and words, then Back and Next
 * between the steps. On the last step the forward button is the lesson's own ("Next: <the next lesson>", "Finish
 * course"): it finishes the guide and goes on (LessonPlayer's `way`). The place is saved as you go and resumed next
 * time. Under 1024 px Back and Next sit in the lesson's bar at the bottom of the window (on the first step its Back
 * is the lesson before: `back`); from 1024 px at the foot of the step's card.
 */
export function GuideLesson({ lesson, done, way, back, onStep, onMoved }: { lesson: LessonView; done: boolean; way: LessonWay; back?: ReactNode; onStep?: (atEnd: boolean) => void; onMoved?: () => void }) {
  const { api } = useLearner();
  const steps = lesson.steps;
  const last = Math.max(0, steps.length - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, lesson.progress.stepIndex), last));
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const atEnd = index >= last;

  // The page's main button finishes the guide only on its last step.
  useEffect(() => {
    onStep?.(atEnd);
  }, [atEnd]);

  const go = (to: number) => {
    const target = Math.min(Math.max(0, to), last);
    if (target === index) return;
    moved.current = true;
    setIndex(target);
    onMoved?.();
    // The place is saved as they go (a failure only means they start a step earlier next time).
    void api.saveProgress(lesson.id, { stepIndex: target }).catch(() => undefined);
  };

  // A screen reader hears the new step (focus to its heading) — not when the page first opens.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);

  if (steps.length === 0) {
    return (
      <div className="card card-pad">
        <p className="text-sm text-ink-2">This guide has no steps yet.</p>
      </div>
    );
  }

  const step = steps[index]!;
  const where = `Step ${index + 1} of ${steps.length}`;
  const controls = (inBar: boolean) => (
    <>
      {index > 0 ? (
        <Button variant="secondary" className={`flex-none ${TOUCH_MIN}`} onClick={() => go(index - 1)}>
          Back
        </Button>
      ) : inBar ? (
        back
      ) : null}
      {index < last ? (
        <Button className={`ms-auto flex-none ${TOUCH_MIN}`} onClick={() => go(index + 1)}>
          Next
        </Button>
      ) : (
        <WayButton way={way} className="ms-auto max-w-full" />
      )}
    </>
  );
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
        <ol aria-label="Steps" className="-ms-1 flex flex-wrap items-center">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-label={s.title ? `Step ${i + 1}: ${s.title}` : `Step ${i + 1}`}
                aria-current={i === index ? 'step' : undefined}
                className="group grid h-6 min-w-6 place-items-center rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${i === index ? 'w-5 bg-brand' : i < index ? 'w-2 bg-brand/45 group-hover:bg-brand/70' : 'w-2 bg-line group-hover:bg-ink-3'}`}
                />
              </button>
            </li>
          ))}
        </ol>
        <h2 id={`step-${step.id}`} ref={heading} tabIndex={-1} className="mt-1 font-display text-lg font-bold text-ink outline-none">
          {step.title || `Step ${index + 1}`}
        </h2>
      </div>
      {step.image ? <StepPicture step={step} /> : null}
      {step.body ? <RichNoteView html={step.body} className="text-sm text-ink" /> : null}
      <LessonControls inline={() => <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">{controls(false)}</div>}>{controls(true)}</LessonControls>
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
