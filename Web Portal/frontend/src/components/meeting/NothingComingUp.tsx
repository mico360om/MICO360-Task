import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { Meeting } from '../../api/meetings';
import { Button } from '../ui/Button';
import { whenItWas } from '../../lib/meeting-list';
import { TOUCH_TALL } from '../../lib/touch';
import { Icon } from './kit';

/**
 * In the "Up next" place when nothing is scheduled: says so, names the last meeting (a link to it)
 * and offers to schedule the next one, so a quiet week doesn't look like an empty or broken page.
 */
export function NothingComingUp({ last, timeZone, now, onSchedule }: { last: Meeting | null; timeZone: string; now: Date; onSchedule: () => void }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-soft sm:px-5">
      <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-ground text-ink-3">
        {Icon.calendar}
      </span>
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-2">Up next</p>
        <h2 id={titleId} className="font-display text-lg font-bold leading-tight text-ink">
          Nothing coming up
        </h2>
        <p className="mt-0.5 text-sm text-ink-2">
          {last ? (
            <>
              Last meeting:{' '}
              <Link to={`/meetings/${last.id}`} className="font-medium text-ink underline decoration-line-2 underline-offset-2 [overflow-wrap:anywhere] hover:text-brand hover:decoration-brand">
                <bdi>{last.title}</bdi>
              </Link>
              , {whenItWas(last.startAt, now, timeZone)}.
            </>
          ) : (
            'No meeting has been held yet.'
          )}
        </p>
      </div>
      <Button onClick={onSchedule} className={`flex-none max-sm:w-full ${TOUCH_TALL}`}>
        {Icon.calendar}
        Schedule a meeting
      </Button>
    </section>
  );
}
