import { useState } from 'react';
import type { TrendRow } from '../../api/management';
import { LineChart } from '../LineChart';
import { dayMonth } from '../../lib/management';
import { Section } from './parts';

/** The weekly table shows this many weeks (the latest) until all are asked for. */
const SHOWN_WEEKS = 6;

/**
 * Weekly trends over the chosen period (company weeks, the current one last and still going): tasks
 * created against completed, tasks late at the end of each week, and the inspection pass rate — the
 * three charts over the same weeks (a gap where a week had no inspection), with the same figures in a
 * table under them.
 */
export function TrendsSection({ weeks }: { weeks: TrendRow[] }) {
  const [all, setAll] = useState(false);
  const labels = weeks.map((w) => w.label);
  const last = weeks.at(-1);
  const rated = weeks.filter((w) => w.passRate !== null);
  const newestFirst = [...weeks].reverse();
  const rows = all ? newestFirst : newestFirst.slice(0, SHOWN_WEEKS);
  return (
    <Section id="mgmt-trends" title="Trends" note={`${weeks.length} weeks${weeks[0] ? ` from ${dayMonth(weeks[0].start)}` : ''}; the last one is this week, still going.`}>
      <div className="grid gap-5 lg:grid-cols-3">
        <figure className="min-w-0">
          <figcaption className="mb-1 text-sm font-semibold text-ink">Tasks created and completed</figcaption>
          <LineChart
            ariaLabel={`Tasks created and completed each week${last ? `; this week ${last.created} created, ${last.completed} completed` : ''}. The figures are in the table below.`}
            labels={labels}
            series={[
              { name: 'Created', color: 'rgb(var(--c-ink-2))', values: weeks.map((w) => w.created) },
              { name: 'Completed', color: 'rgb(var(--c-success))', values: weeks.map((w) => w.completed), area: true },
            ]}
            height={180}
            maxTicks={4}
          />
        </figure>
        <figure className="min-w-0">
          <figcaption className="mb-1 text-sm font-semibold text-ink">Late tasks at each week’s end</figcaption>
          <LineChart
            ariaLabel={`Late tasks at the end of each week${last ? `; now ${last.late}` : ''}. The figures are in the table below.`}
            labels={labels}
            series={[{ name: 'Late', color: 'rgb(var(--c-danger))', values: weeks.map((w) => w.late), area: true }]}
            height={180}
            maxTicks={4}
          />
        </figure>
        <figure className="min-w-0">
          <figcaption className="mb-1 text-sm font-semibold text-ink">Inspection pass rate</figcaption>
          {rated.length ? (
            <LineChart
              ariaLabel={`Inspection pass rate each week (no point where a week had no finished inspection); latest ${rated.at(-1)!.passRate}%. The figures are in the table below.`}
              labels={labels}
              series={[{ name: 'Pass rate', color: 'rgb(var(--c-info))', values: weeks.map((w) => w.passRate) }]}
              unit="%"
              height={180}
              maxTicks={4}
            />
          ) : (
            <p className="rounded-lg bg-ground/60 px-3 py-8 text-center text-sm text-ink-2">No inspections finished in these weeks.</p>
          )}
        </figure>
      </div>
      {/* On a narrow screen the table scrolls sideways: focusable, so the keyboard can scroll it too. */}
      <div tabIndex={0} role="region" aria-label="Weekly figures, scrolls sideways on a narrow screen" className="mt-4 overflow-x-auto rounded-xl border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-brand-text))]">
        <table className="w-full text-sm" aria-label="Weekly figures">
          <thead className="bg-surface-2">
            <tr className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th scope="col" className="px-3 py-2 text-start">Week of</th>
              <th scope="col" className="px-3 py-2 text-end">Created</th>
              <th scope="col" className="px-3 py-2 text-end">Completed</th>
              <th scope="col" className="px-3 py-2 text-end">Late</th>
              <th scope="col" className="px-3 py-2 text-end">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.start} className="border-t border-line">
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-start font-medium text-ink">
                  {dayMonth(w.start)}
                  {w.current ? <span className="ms-1 text-xs font-normal text-ink-3">(this week)</span> : null}
                </th>
                <td className="px-3 py-1.5 text-end tabular-nums">{w.created}</td>
                <td className="px-3 py-1.5 text-end tabular-nums">{w.completed}</td>
                <td className={`px-3 py-1.5 text-end tabular-nums ${w.late ? 'text-danger' : ''}`}>{w.late}</td>
                <td className="px-3 py-1.5 text-end tabular-nums">{w.passRate === null ? '—' : `${w.passRate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {weeks.length > SHOWN_WEEKS ? (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="tap mt-2 rounded-lg px-2 text-sm font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">
          {all ? `Show the latest ${SHOWN_WEEKS} weeks` : `Show all ${weeks.length} weeks`}
        </button>
      ) : null}
    </Section>
  );
}
