import { Link } from 'react-router-dom';
import { OVERDUE_CLASS } from '../../lib/colour-classes';
import { useTrainingAccess } from './training-queries';
import { BookIcon } from './training-ui';

/**
 * The dashboard's red "Overdue learning — N" (owner answer 10: remind and escalate, nothing blocked), opening the
 * Learning Hub; nothing when none is overdue (or before the server answers).
 */
export function OverdueTrainingLink() {
  const n = useTrainingAccess().data?.overdue;
  if (typeof n !== 'number' || n <= 0) return null;
  return (
    <Link
      to="/training"
      data-overdue-training
      className={`inline-flex min-h-11 items-center gap-2 self-start rounded-xl border px-4 py-2 text-sm font-semibold outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand/40 ${OVERDUE_CLASS.edge} ${OVERDUE_CLASS.chip}`}
    >
      <BookIcon />
      Overdue learning — {n}
      <span className="sr-only">{n === 1 ? ' course past its due day. Open the Learning Hub.' : ' courses past their due day. Open the Learning Hub.'}</span>
    </Link>
  );
}
