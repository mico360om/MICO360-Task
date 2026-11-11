import { Link } from 'react-router-dom';
import type { TrainingModule } from '../../api/training';
import { coursePath } from './learner';
import { useLearn } from './training-queries';
import { BookIcon } from './training-ui';

/** Where Learn this feature goes: the one course for the module, else the catalogue filtered to it. */
export function learnTarget(base: string, module: TrainingModule, found: { courseId: string | null; count: number }): string | null {
  if (!found.count || found.count < 1) return null;
  if (found.count === 1 && found.courseId) return coursePath(base, found.courseId, module);
  return `${base}?tab=catalogue&module=${encodeURIComponent(module)}`;
}

/**
 * The link itself: a book and the words (just "Learn" on a phone, or always when `compact` — a narrow header; its
 * name stays whole), 44px on a touch screen.
 */
export function LearnLinkView({ to, compact = false }: { to: string; compact?: boolean }) {
  return (
    <Link
      to={to}
      data-learn-link
      aria-label="Learn this feature"
      className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-sm font-semibold text-brand outline-none transition-colors hover:bg-brand/5 focus-visible:ring-2 focus-visible:ring-brand/40 [@media(pointer:coarse)]:min-h-11"
    >
      <BookIcon />
      <span className={compact ? '' : 'sm:hidden'}>Learn</span>
      {compact ? null : <span className="max-sm:hidden">Learn this feature</span>}
    </Link>
  );
}

/**
 * "Learn this feature" (design: contextual help) on a staff page's header: shown only when the server says a course
 * for the module exists for this person (one read per module, kept 5 minutes); nothing while it is asked or when
 * there is none.
 */
export function LearnLink({ module, compact = false }: { module: TrainingModule; compact?: boolean }) {
  const q = useLearn(module);
  const d = q.data;
  const to = d && typeof d.count === 'number' ? learnTarget('/training', module, d) : null;
  return to ? <LearnLinkView to={to} compact={compact} /> : null;
}
