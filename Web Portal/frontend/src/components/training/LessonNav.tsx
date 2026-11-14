import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useDialog } from '../../hooks/useDialog';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { Button, buttonClass } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { ModuleIcon } from './ModuleIcon';
import { lessonPath, useLearner } from './learner';
import { outlineButtonText, outlineHeading, type LessonOutlineModel } from './lesson-nav';
import { LessonKindIcon, LockIcon, TOUCH_MIN, TickIcon } from './training-ui';
import { LESSON_KIND_WORDS, minutesText } from './training-words';

/**
 * The lesson page's way around (1.23.36, "Lesson + module outline"): on a computer (1024 px and wider) an "In this
 * module" panel beside the lesson that stays in view — the module's lessons with their states, "1 of 3 done", the one
 * main button ("Next: <lesson>") and All modules; under 1024 px a "Lessons in this module · 2 of 3" button that opens
 * the same list as a sheet, and a bar at the bottom of the window with Back and the main button.
 */

/** Two columns (the panel beside the lesson) from here; the sheet and the bottom bar below it. */
export const WIDE_LESSON_QUERY = '(min-width: 64em)';

/** The lesson's one way on, as the panel and the bar show it (LessonPlayer decides it). */
export interface LessonWay {
  label: string;
  /** The label in two parts — "Next: " and the lesson's title — so the title is shown in its own <bdi>. */
  prefix?: string;
  title?: string;
  /** Pressing it finishes the lesson first (a guide's last step, a document), then goes on. */
  finishes: boolean;
  /** The main look once the lesson is done (or the button finishes it); a plain way on while it isn't. */
  primary: boolean;
  /** Where it goes when it doesn't finish anything. */
  to: string;
  state?: unknown;
  run: () => void;
  busy: boolean;
  /** Not offered: a plain way on to a lesson an in-order course keeps locked, or the course was just finished here. */
  hidden: boolean;
  /** Pressing it failed (said beside it). */
  error: string | null;
}

/** The button's words: the title in its own <bdi> (a right-to-left title keeps "Next:" in its place). */
const WayLabel = ({ way }: { way: LessonWay }) => (
  <span className="min-w-0 break-words">
    {way.prefix && way.title ? (
      <>
        {way.prefix}
        <bdi>{way.title}</bdi>
      </>
    ) : (
      way.label
    )}
  </span>
);

/** A failure of the main button, right beside it. */
export const WayError = ({ way, className = '' }: { way: LessonWay; className?: string }) =>
  way.error ? (
    <p role="alert" className={`rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger ${className}`}>
      {way.error}
    </p>
  ) : null;

/** The main button: a button when it finishes the lesson, else a link (it can be opened in a new tab). */
export function WayButton({ way, className = '' }: { way: LessonWay; className?: string }) {
  if (way.hidden) return null;
  const look = way.primary ? 'primary' : 'secondary';
  if (way.finishes)
    return (
      <Button data-look={look} variant={look} className={`${TOUCH_MIN} ${className}`} loading={way.busy} onClick={way.run}>
        <WayLabel way={way} />
      </Button>
    );
  return (
    <Link to={way.to} state={way.state} data-look={look} className={buttonClass(look, 'md', `${TOUCH_MIN} ${className}`)}>
      <WayLabel way={way} />
    </Link>
  );
}

/** The module's (or course's) name with its icon, and "1 of 3 done" with a small bar (its words say it). */
function OutlineHead({ outline, headingId }: { outline: LessonOutlineModel; headingId: string }) {
  const pct = outline.total > 0 ? Math.round((outline.done / outline.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand/10 text-brand">
          <ModuleIcon moduleKey={outline.moduleKey} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{outlineHeading(outline)}</p>
          <h2 id={headingId} className="break-words font-display text-base font-bold leading-snug text-ink">
            <bdi>{outline.title}</bdi>
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-none text-xs font-semibold text-ink-2">{`${outline.done} of ${outline.total} done`}</span>
        <span aria-hidden="true" className="block h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-line">
          <span className={`block h-full rounded-full ${pct >= 100 ? STATUS_CLASS.DONE.dot : 'bg-brand'}`} style={{ width: `${pct}%` }} />
        </span>
      </div>
    </div>
  );
}

/**
 * The lessons, in order: a tick when done, the open one marked (a brand edge, "current page"), a lock on an in-order
 * course's lessons that can't be opened yet (not a link); every other lesson is a link (jump freely: D4).
 */
export function OutlineList({ outline, courseId, onPick }: { outline: LessonOutlineModel; courseId: string; onPick?: () => void }) {
  const side = useLearner();
  return (
    <ol aria-label="Lessons" className="flex flex-col gap-0.5">
      {outline.items.map((l, i) => {
        const minutes = minutesText(l.minutes);
        const inner = (
          <>
            <span
              aria-hidden="true"
              className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold ${l.done ? 'bg-success-soft text-success' : l.current ? 'bg-brand text-white' : 'bg-ground text-ink-2'}`}
            >
              {l.done ? <TickIcon size={13} /> : l.locked ? <LockIcon size={12} /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-sm leading-snug ${l.current ? 'font-bold text-ink' : l.locked ? 'font-medium text-ink-2' : 'font-medium text-ink'}`}>
                <bdi>{l.title}</bdi>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
                <LessonKindIcon kind={l.kind} size={12} />
                <span className="sr-only">{LESSON_KIND_WORDS[l.kind]}</span>
                {minutes ? <span>{minutes}</span> : null}
                {l.review ? <span className="rounded-md bg-warning-soft px-1.5 py-px text-[11px] font-semibold text-warning">Review</span> : null}
                {l.locked ? (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <LockIcon size={11} />
                    Locked
                  </span>
                ) : null}
              </span>
            </span>
            {l.done ? <span className="sr-only">, done</span> : null}
          </>
        );
        const row = 'flex min-h-11 items-start gap-2.5 rounded-lg border-s-[3px] px-2 py-2';
        return (
          <li key={l.id}>
            {l.locked ? (
              <div className={`${row} border-transparent`} title="Finish the lessons before it first">
                {inner}
                <span className="sr-only">: finish the lessons before it first.</span>
              </div>
            ) : (
              <Link
                to={lessonPath(side.base, courseId, l.id)}
                aria-current={l.current ? 'page' : undefined}
                onClick={onPick}
                className={`${row} outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${l.current ? 'border-brand bg-brand/[0.06]' : 'border-transparent hover:bg-ground'}`}
              >
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const linkClass = `inline-flex items-center justify-center rounded text-sm font-semibold text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_MIN}`;

/**
 * "In this module" beside the lesson (1024 px and wider): stays in view while the lesson scrolls. Without the course's
 * outline (still loading, or it couldn't be read — `problem`), the way on is still there ("Where next"), with the
 * reason and Try again (review 1).
 */
export function OutlinePanel({
  outline,
  courseId,
  allTo,
  allLabel,
  way,
  problem,
}: {
  outline: LessonOutlineModel | null;
  courseId: string;
  allTo: string;
  allLabel: string;
  way: LessonWay;
  problem?: { text: string; retry: () => void } | null;
}) {
  const side = useLearner();
  const id = useId();
  // Below the staff site's 56 px top bar (the portal's header scrolls away).
  const stick = side.portal ? 'lg:top-4 lg:max-h-[calc(100dvh-2rem)]' : 'lg:top-[4.5rem] lg:max-h-[calc(100dvh-5.5rem)]';
  const foot = (
    <>
      {!way.hidden ? <WayButton way={way} className="w-full" /> : null}
      <WayError way={way} />
      <Link to={allTo} className={`${linkClass} self-center`}>
        {allLabel}
      </Link>
    </>
  );
  if (!outline) {
    return (
      <aside aria-label="Where next" data-lesson-panel className={`card flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:overflow-y-auto ${stick}`}>
        {problem ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-ink-2">{problem.text}</p>
            <Button variant="secondary" size="sm" className={TOUCH_MIN} onClick={problem.retry}>
              Try again
            </Button>
          </div>
        ) : null}
        {foot}
      </aside>
    );
  }
  return (
    <nav aria-label={outlineHeading(outline)} data-lesson-panel className={`card flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:overflow-y-auto ${stick}`}>
      <OutlineHead outline={outline} headingId={id} />
      <OutlineList outline={outline} courseId={courseId} />
      {foot}
    </nav>
  );
}

const ListIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

/** Under 1024 px: "Lessons in this module · 2 of 3", which opens the list as a sheet. */
export function OutlineSheetButton({ outline, open, onOpen }: { outline: LessonOutlineModel; open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className={`flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-start text-sm font-semibold text-ink outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40 sm:w-auto sm:self-start ${TOUCH_MIN}`}
    >
      <ListIcon />
      <span className="min-w-0 flex-1">{outlineButtonText(outline)}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-2">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

/** The same list as the panel, as a sheet from the bottom of the screen (Escape, Close or a tap outside closes it). */
export function OutlineSheet({ outline, courseId, allTo, allLabel, onClose }: { outline: LessonOutlineModel; courseId: string; allTo: string; allLabel: string; onClose: () => void }) {
  const ref = useDialog(onClose);
  const id = useId();
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={`${outlineHeading(outline)}: ${outline.title}`}
          data-lesson-sheet
          className="card relative flex max-h-[min(85dvh,calc(var(--visible-height)-1rem))] w-full animate-scale-in flex-col gap-3 overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-b-2xl"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <OutlineHead outline={outline} headingId={id} />
            </div>
            <Button variant="secondary" size="sm" className={`flex-none ${TOUCH_MIN}`} onClick={onClose}>
              Close
            </Button>
          </div>
          <OutlineList outline={outline} courseId={courseId} onPick={onClose} />
          <Link to={allTo} onClick={onClose} className={`${linkClass} self-center`}>
            {allLabel}
          </Link>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Under 1024 px the bar at the bottom of the window (it stays in view while the lesson scrolls): Back (the lesson
 * before) and the main button. A guide's steps and a quiz's questions put their own Back / Next in it instead
 * (LessonControls), so a phone never shows two sets.
 */
interface BarSlot {
  wide: boolean;
  slot: HTMLElement | null;
  claim: (on: boolean) => void;
}
const LessonBarContext = createContext<BarSlot | null>(null);
export const LessonBarProvider = LessonBarContext.Provider;

/** A lesson's own controls: in the bar under 1024 px (taking the bar's place), inline otherwise. */
export function LessonControls({ children, inline }: { children: ReactNode; inline: (c: ReactNode) => ReactNode }) {
  const ctx = useContext(LessonBarContext);
  const inBar = !!ctx && !ctx.wide;
  const claim = ctx?.claim;
  useEffect(() => {
    if (!inBar || !claim) return;
    claim(true);
    return () => claim(false);
  }, [inBar, claim]);
  if (!inBar) return <>{inline(children)}</>;
  return ctx.slot ? createPortal(children, ctx.slot) : null;
}

const BackChevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none rtl:-scale-x-100">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/** "Back" to the lesson before (named for screen readers: "Back: <its title>"). */
export function BackToLesson({ courseId, lessonId, title }: { courseId: string; lessonId: string | null; title: string | null }) {
  const side = useLearner();
  if (!lessonId) return null;
  return (
    <Link to={lessonPath(side.base, courseId, lessonId)} aria-label={title ? `Back: ${title}` : 'Back'} className={buttonClass('secondary', 'md', `flex-none gap-1.5 !px-3 ${TOUCH_MIN}`)}>
      <BackChevron />
      Back
    </Link>
  );
}

/** The bar itself; `slotRef` receives a lesson's own controls (then `children`, the default Back / Next, step aside). */
export function LessonBar({ slotRef, claimed, error, children }: { slotRef: (el: HTMLElement | null) => void; claimed: boolean; error?: ReactNode; children: ReactNode }) {
  return (
    <div data-lesson-bar className="sticky bottom-0 z-20 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      <div className="flex min-h-[3.75rem] flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface/95 px-2.5 py-2 shadow-lift backdrop-blur">
        <div ref={slotRef} className="contents" />
        {claimed ? null : children}
        {error ? <div className="basis-full">{error}</div> : null}
      </div>
    </div>
  );
}
