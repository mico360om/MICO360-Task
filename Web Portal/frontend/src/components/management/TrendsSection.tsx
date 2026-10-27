import type { TrendRow } from '../../api/management';
import { LineChart } from '../LineChart';
import { dayMonth } from '../../lib/management';
import { Section } from './parts';

/**
 * Weekly trends over the chosen period (company weeks, the current one last and still going): tasks
 * created against completed, tasks late at the end of each week, and the inspection pass rate — each
 * chart with the same figures in the table under them.
 */
export function TrendsSection({ weeks }: { weeks: TrendRow[] }) {
  const labels = weeks.map((w) => (w.current ? `${w.label} (now)` : w.label));
  const rated = weeks.filter((w) => w.passRate !== null);
  const last = weeks.at(-1);
  return (
    <Section id="mgmt-trends" title="Trends" note={`${weeks.length} weeks${weeks[0] ? ` from ${dayMonth(weeks[0].start)}` : ''}; this week is still going.`}>
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
              ariaLabel={`Inspection pass rate in the weeks with finished inspections${rated.at(-1) ? `; latest ${rated.at(-1)!.passRate}%` : ''}. The figures are in the table below.`}
              labels={rated.map((w) => (w.current ? `${w.label} (now)` : w.label))}
              series={[{ name: 'Pass rate', color: 'rgb(var(--c-info))', values: rated.map((w) => w.passRate ?? 0) }]}
              unit="%"
              height={180}
              maxTicks={4}
            />
          ) : (
            <p className="rounded-lg bg-ground/60 px-3 py-8 text-center text-sm text-ink-2">No inspections finished in these weeks.</p>
          )}
        </figure>
      </div>
      {/* It scrolls: focusable, so the keyboard can scroll it too. */}
      <div tabIndex={0} role="region" aria-label="Weekly figures, scrollable" className="mt-4 max-h-72 overflow-auto rounded-xl border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-brand-text))]">
        <table className="w-full text-sm" aria-label="Weekly figures">
          <thead className="sticky top-0 bg-surface-2">
            <tr className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th scope="col" className="px-3 py-2 text-start">Week of</th>
              <th scope="col" className="px-3 py-2 text-end">Created</th>
              <th scope="col" className="px-3 py-2 text-end">Completed</th>
              <th scope="col" className="px-3 py-2 text-end">Late</th>
              <th scope="col" className="px-3 py-2 text-end">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
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
    </Section>
  );
}
