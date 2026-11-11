import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MODULE_LABELS, type CourseCard, type Difficulty, type FileRef, type LessonKind, type MyCourseState } from '../../api/training';
import { DUE_SOON_CLASS, OVERDUE_CLASS, STATUS_CLASS } from '../../lib/colour-classes';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { ProgressBar } from '../portal/portal-ui';
import { DIFFICULTY_WORDS, STATUS_WORDS, dueText, lessonsText, minutesText, ratingText } from './training-words';

/** Pieces the training pages share (staff and the Client portal): the site's cards, chips and 44px touch targets. */

/** A touch-sized control on a touch screen (44px), as the rest of the site. */
export const TOUCH_MIN = '[@media(pointer:coarse)]:min-h-11';

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

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  BEGINNER: 'bg-success-soft text-success',
  INTERMEDIATE: 'bg-info-soft text-info',
  ADVANCED: 'bg-brand/10 text-brand',
};

export const DifficultyChip = ({ difficulty }: { difficulty: Difficulty }) => <span className={`${pill} ${DIFFICULTY_TONE[difficulty]}`}>{DIFFICULTY_WORDS[difficulty]}</span>;

/** Loaded with the site (an administrator can edit or unpublish it). */
export const StarterBadge = () => <span className={`${pill} border border-line bg-ground text-ink-2`}>Starter</span>;

export const OverdueChip = () => <span className={`${pill} ${OVERDUE_CLASS.chip}`}>Overdue</span>;

export const MandatoryChip = () => <span className={`${pill} bg-warning-soft text-warning`}>Mandatory</span>;

/** A course's state in the one colour scheme: started blue, done green, a review like a task in review, a retake due amber. */
const STATUS_TONE: Record<MyCourseState['status'], string> = {
  NOT_STARTED: 'bg-ground text-ink-2',
  IN_PROGRESS: STATUS_CLASS.IN_PROGRESS.chip,
  COMPLETED: STATUS_CLASS.DONE.chip,
  REVIEW: STATUS_CLASS.REVIEW.chip,
  RETAKE: DUE_SOON_CLASS.chip,
};

/** Where the person is on a course, in words (and colour). */
export function StatusChip({ status }: { status: MyCourseState['status'] }) {
  return <span className={`${pill} ${STATUS_TONE[status]}`}>{STATUS_WORDS[status]}</span>;
}

/** The average rating as five stars (read only), with the words beside them. */
export function RatingLine({ rating }: { rating: { average: number | null; count: number } }) {
  const filled = rating.average === null ? 0 : Math.round(rating.average);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      {rating.count ? (
        <span aria-hidden="true" className="inline-flex text-warning">
          {[1, 2, 3, 4, 5].map((n) => (
            <svg key={n} viewBox="0 0 24 24" width="13" height="13" fill={n <= filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
            </svg>
          ))}
        </span>
      ) : null}
      <span>
        {rating.count ? <span className="sr-only">Rated </span> : null}
        {ratingText(rating)}
      </span>
    </span>
  );
}

/** A course's length and size: "25 min · 4 lessons". */
export function CourseFacts({ course }: { course: Pick<CourseCard, 'minutes' | 'lessonCount'> }) {
  const time = minutesText(course.minutes);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
      {time ? (
        <span className="inline-flex items-center gap-1">
          <ClockIcon />
          {time}
        </span>
      ) : null}
      {time ? <span aria-hidden="true">·</span> : null}
      <span>{lessonsText(course.lessonCount)}</span>
    </span>
  );
}

/**
 * One course as a card (My training, the catalogue): its module, title, summary, length, difficulty, rating,
 * and where the person is on it (due day, red Overdue, progress).
 */
export function CourseCardView({ course, to, showState = true }: { course: CourseCard; to: string; showState?: boolean }) {
  const m = course.mine;
  const due = dueText(m);
  const started = m.status === 'IN_PROGRESS' || m.status === 'REVIEW' || m.status === 'RETAKE';
  return (
    <Link
      to={to}
      data-course-card={course.id}
      className={`card card-hover card-pad flex h-full min-w-0 flex-col gap-3 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${m.overdue ? `border-s-4 ${OVERDUE_CLASS.edge}` : ''}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-ink-3">{MODULE_LABELS[course.moduleKey]}</span>
        {course.starter ? <StarterBadge /> : null}
        {m.mandatory ? <MandatoryChip /> : null}
      </div>
      <div className="min-w-0">
        <h3 className="break-words font-display text-base font-bold text-ink">{course.title}</h3>
        {course.summary ? <p className="mt-1 line-clamp-2 text-sm text-ink-2">{course.summary}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CourseFacts course={course} />
        <DifficultyChip difficulty={course.difficulty} />
        {course.certificateOn ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-2">
            <AwardIcon size={14} />
            Certificate
          </span>
        ) : null}
      </div>
      <RatingLine rating={course.rating} />
      {showState && (m.enrolled || m.assigned) ? (
        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={m.status} />
            {m.overdue ? <OverdueChip /> : null}
            {due && m.status !== 'COMPLETED' ? <span className={`text-xs font-semibold ${m.overdue ? OVERDUE_CLASS.text : 'text-ink-2'}`}>{due}</span> : null}
          </div>
          {started ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ProgressBar percent={m.progressPct} label={`${course.title}: ${m.progressPct}% done`} />
              </div>
              <span className="flex-none text-xs font-semibold text-ink">{m.progressPct}%</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Link>
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

/** A plain-words problem for a training request (never a code). */
export function trainingProblem(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | null;
  const own = e?.message && !/^Request failed/.test(e.message) ? e.message : null;
  if (e?.status === 404) return 'This course isn’t available to you.';
  if (e?.status === 429) return 'Too many requests at once. Wait a minute and try again.';
  if (e?.status === 400 || e?.status === 403 || e?.status === 409) return own ?? fallback;
  return `${fallback} Check your connection and try again.`;
}
