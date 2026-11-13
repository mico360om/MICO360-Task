import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CourseCard, FileRef, LessonKind, MyCourseState } from '../../api/training';
import { OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';
import { ApiError } from '../../lib/api-client';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { Button, buttonClass } from '../ui/Button';
import { coursePath, lessonPath, useLearner } from './learner';
import { courseChanged } from './training-queries';
import { ACTION_WORDS, DIFFICULTY_WORDS, cardChip, courseAction, minutesText, newForRoleText, progressWords, type ChipTone } from './training-words';

/** Pieces the training pages share (staff and the Client portal): the site's cards, chips and 44px touch targets. */

/** A touch-sized control on a touch screen (44px), as the rest of the site. */
export const TOUCH_MIN = '[@media(pointer:coarse)]:!min-h-11';

const svg = (children: ReactNode, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    {children}
  </svg>
);

/** An open book: Training's mark (the menu item, Learn this feature). */
export const BOOK_PATHS = (
  <>
    <path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2z" />
    <path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7z" />
  </>
);
export const BookIcon = ({ size = 16 }: { size?: number }) => svg(BOOK_PATHS, size);

const KIND_PATHS: Record<LessonKind, ReactNode> = {
  VIDEO: (
    <>
      <rect x="2" y="5" width="15" height="14" rx="2" />
      <path d="m17 10 5-3v10l-5-3" />
    </>
  ),
  GUIDE: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  DOCUMENT: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  QUIZ: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
};

/** A lesson's kind as a small icon (decorative; its words are said beside it). */
export const LessonKindIcon = ({ kind, size = 16 }: { kind: LessonKind; size?: number }) => svg(KIND_PATHS[kind], size);

export const ClockIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    14,
  );

export const TickIcon = ({ size = 16 }: { size?: number }) => svg(<path d="M20 6 9 17l-5-5" />, size);
export const LockIcon = ({ size = 16 }: { size?: number }) =>
  svg(
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
    size,
  );
export const DownloadIcon = ({ size = 16 }: { size?: number }) => svg(<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />, size);
export const AwardIcon = ({ size = 16 }: { size?: number }) =>
  svg(
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M9 14.5 8 22l4-2 4 2-1-7.5" />
    </>,
    size,
  );

const pill = 'inline-flex flex-none items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold';

export const MandatoryChip = () => <span className={`${pill} bg-warning-soft text-warning`}>Mandatory</span>;

const CHIP_TONE: Record<ChipTone, string> = {
  overdue: OVERDUE_CLASS.chip,
  due: 'bg-info-soft text-info',
  done: STATUS_CLASS.DONE.chip,
};

/** A course's one chip (12 Nov §3): "Overdue · was due 9 Nov", "Due 17 Nov", "Done"… or nothing. */
export function CardChipView({ mine }: { mine: Pick<MyCourseState, 'status' | 'overdue' | 'dueDay'> }) {
  const c = cardChip(mine);
  return c ? <span className={`${pill} ${CHIP_TONE[c.tone]}`}>{c.text}</span> : null;
}

/** D3: modules added for the person's grown role after they finished ("New for your role: 2", or just the words). */
export const NewForRoleChip = ({ count }: { count?: number }) => <span className={`${pill} bg-info-soft text-info`}>{count ? newForRoleText(count) : 'New for your role'}</span>;

/**
 * A course's Start / Continue / Review from a list (a card, Up next): it opens the lesson the course points at
 * (`mine.next`, else `nextLessonId`); a course the person hasn't got yet is started first, then its first lesson to
 * take opens (a manager previewing a course that isn't theirs to take hears why).
 */
export function useCourseGo(c: CourseCard) {
  const side = useLearner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = c.mine;
  const lessonId = m.next?.lessonId ?? m.nextLessonId;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await side.api.start(c.id);
      courseChanged(qc, side, c.id, d);
      const first = d.resumeLessonId ?? d.lessons[0]?.id ?? null;
      navigate(first ? lessonPath(side.base, c.id, first) : coursePath(side.base, c.id));
    } catch (err) {
      setError(trainingProblem(err, 'Couldn’t start the course.'));
      setBusy(false);
    }
  };
  return {
    action: courseAction(m),
    /** Where it goes once the course is the person's (no lesson to open: the course's page). */
    to: lessonId ? lessonPath(side.base, c.id, lessonId) : coursePath(side.base, c.id),
    hasLesson: Boolean(lessonId),
    needsStart: !m.enrolled,
    start,
    busy,
    error,
  };
}

/** R1: a card's own small Start / Continue / Review (a sibling above the card's stretched link, never inside it). */
function CardAction({ course: c }: { course: CourseCard }) {
  const go = useCourseGo(c);
  const words = ACTION_WORDS[go.action];
  const name = `${words}: ${c.title}`;
  // Nothing to open: no button (the card itself opens the course's page).
  if (go.needsStart ? c.lessonCount < 1 : !go.hasLesson) return null;
  return (
    <>
      {go.needsStart ? (
        <Button variant="secondary" size="sm" aria-label={name} className={`!rounded-lg ${TOUCH_MIN}`} loading={go.busy} onClick={() => void go.start()}>
          {words}
        </Button>
      ) : (
        <Link to={go.to} aria-label={name} className={buttonClass('secondary', 'sm', `!rounded-lg ${TOUCH_MIN}`)}>
          {words}
        </Link>
      )}
      {go.error ? (
        <p role="alert" className="basis-full rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {go.error}
        </p>
      ) : null}
    </>
  );
}

/** "8 min", and the difficulty only when it isn't Beginner (12 Nov §1). */
export function CourseLength({ course }: { course: Pick<CourseCard, 'minutes' | 'difficulty'> }) {
  const time = minutesText(course.minutes);
  return (
    <>
      {time ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-2">
          <ClockIcon />
          {time}
        </span>
      ) : null}
      {course.difficulty !== 'BEGINNER' ? <span className="text-xs text-ink-2">{DIFFICULTY_WORDS[course.difficulty]}</span> : null}
    </>
  );
}

/**
 * One course as a slim card (12 Nov §3: My learning, All courses, the portal): its title (the link that covers the
 * card), a one-line summary, the minutes, Mandatory when it applies, one chip, how far along ("0 of 3 lessons", "4 of
 * 8 modules"; not on a finished card), "New for your role: 2" (D3), and its own small Start / Continue / Review (R1).
 * The action and `extra` (a Done card's certificate) sit in a row ABOVE the title's stretched link, never inside it.
 */
export function CourseCardView({ course, to, showState = true, extra }: { course: CourseCard; to: string; showState?: boolean; extra?: ReactNode }) {
  const m = course.mine;
  const newForRole = m.newForRole > 0 ? m.newForRole : 0;
  return (
    <article
      data-course-card={course.id}
      className={`card card-hover relative flex h-full min-w-0 flex-col gap-1.5 p-4 focus-within:ring-2 focus-within:ring-brand/40 ${showState && m.overdue && m.status !== 'COMPLETED' ? `border-s-4 ${OVERDUE_CLASS.edge}` : ''}`}
    >
      <h3 className="break-words font-display text-base font-bold text-ink">
        <Link to={to} className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']">
          <bdi>{course.title}</bdi>
        </Link>
      </h3>
      {course.summary ? <p className="line-clamp-1 text-sm text-ink-2">{course.summary}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
        <CourseLength course={course} />
        {m.mandatory && m.status !== 'COMPLETED' ? <MandatoryChip /> : null}
        {showState ? <CardChipView mine={m} /> : null}
        {showState && newForRole ? <NewForRoleChip count={newForRole} /> : null}
        {showState && (m.status !== 'COMPLETED' || newForRole) ? <span className="text-xs font-semibold text-ink-2">{progressWords(course)}</span> : null}
      </div>
      {showState || extra ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2 pt-1 empty:hidden">
          {showState ? <CardAction course={course} /> : null}
          {extra}
        </div>
      ) : null}
    </article>
  );
}

/** "1.2 MB", "340 KB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Save a training file under its own name (the server's name when it gives one). */
export async function saveTrainingFile(fetch: (id: string) => Promise<Blob>, file: Pick<FileRef, 'id' | 'name'>): Promise<void> {
  const blob = await fetch(file.id);
  downloadBlob(fileNameOf(blob) ?? file.name, blob);
}

/**
 * A training file (a step's picture, a lesson's PDF) as an object URL for an <img> or a frame — fetched with the
 * person's sign-in (training files are private), let go when the page closes or the file changes.
 */
export function useBlobUrl(fetch: (id: string) => Promise<Blob>, fileId: string | null | undefined): { url: string | null; failed: boolean; blob: Blob | null } {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean; blob: Blob | null } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let made: string | null = null;
    fetch(fileId).then(
      (blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setState({ id: fileId, url: made, failed: false, blob });
      },
      () => {
        if (!cancelled) setState({ id: fileId, url: null, failed: true, blob: null });
      },
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
    // The fetcher is the side's API (stable for the page); the file decides.
  }, [fileId]);
  if (!fileId || !state || state.id !== fileId) return { url: null, failed: false, blob: null };
  return { url: state.url, failed: state.failed, blob: state.blob };
}

/**
 * 1.23.30: an old short course's link (or one of its lessons removed as a duplicate) answers 404 COURSE_MOVED with
 * where it lives now — the one course and its module (null: the course's page). Anything else: null.
 */
export function courseMoved(err: unknown): { courseId: string; moduleId: string | null } | null {
  if (!(err instanceof ApiError) || err.code !== 'COURSE_MOVED') return null;
  const d = err.details as { courseId?: unknown; moduleId?: unknown } | null | undefined;
  if (!d || typeof d.courseId !== 'string' || !d.courseId) return null;
  return { courseId: d.courseId, moduleId: typeof d.moduleId === 'string' && d.moduleId ? d.moduleId : null };
}

/** A plain-words problem for a training request (never a code). */
export function trainingProblem(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | null;
  const own = e?.message && !/^Request failed/.test(e.message) ? e.message : null;
  if (e?.status === 404) return 'This course isn’t available to you.';
  if (e?.status === 429) return 'Too many requests at once. Wait a minute and try again.';
  if (e?.status === 400 || e?.status === 403 || e?.status === 409) return own ?? fallback;
  return `${fallback} Check your connection and try again.`;
}
