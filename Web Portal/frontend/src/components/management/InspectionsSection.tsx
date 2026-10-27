import type { ReactNode } from 'react';
import type { ManagementOverview } from '../../api/management';
import { EmptyState } from '../ui/EmptyState';
import { NumberButton, Section, plural, type OpenList } from './parts';

/** One figure: its number (opening the list behind it) over its words. */
function Figure({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line p-3">
      <div className="text-xl font-bold leading-none">{children}</div>
      <div className="mt-1 text-xs font-semibold text-ink-2">{label}</div>
      {help ? <div className="mt-0.5 text-[11px] text-ink-3">{help}</div> : null}
    </div>
  );
}

/**
 * Inspections: checks done against those due in the period, done late, missing now, closed without a
 * report, the pass rate (items passed of those passed or failed), open follow-up tasks, and the items
 * and forms that failed most.
 */
export function InspectionsSection({ data, onOpen }: { data: ManagementOverview['inspections']; onOpen: OpenList }) {
  const nothing = data.due === 0 && data.finished === 0 && data.missing === 0 && data.openFollowUps === 0;
  return (
    <Section id="mgmt-inspections" title="Inspections" note="Checks are tasks that carry an inspection form. Due, done and the pass rate cover the chosen period; missing checks and follow-ups are now.">
      {nothing ? (
        <EmptyState bare title="No inspections yet" description="Checks due and inspections finished in this period show here." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Checks due">
              <NumberButton value={data.due} label={`${plural(data.due, 'check')} due in the period`} query={{ metric: 'checks-due' }} onOpen={onOpen} />
            </Figure>
            <Figure label="Done" help={data.due ? `${Math.round((data.done / data.due) * 100)}% of those due` : undefined}>
              <NumberButton value={data.done} label={`${plural(data.done, 'check')} done`} query={{ metric: 'checks-done' }} onOpen={onOpen} />
            </Figure>
            <Figure label="Done late">
              <NumberButton value={data.doneLate} label={`${plural(data.doneLate, 'check')} done late`} query={{ metric: 'checks-done-late' }} onOpen={onOpen} tone="warning" />
            </Figure>
            <Figure label="Missing now">
              <NumberButton value={data.missing} label={`${plural(data.missing, 'missing check')}`} query={{ metric: 'missing-checks' }} onOpen={onOpen} tone="danger" />
            </Figure>
            <Figure label="Closed without a report">
              <NumberButton value={data.noReport} label={`${plural(data.noReport, 'check')} closed without a report`} query={{ metric: 'checks-no-report' }} onOpen={onOpen} tone="warning" />
            </Figure>
            <Figure label="Pass rate" help={data.passRate === null ? 'No items passed or failed yet' : `${plural(data.finished, 'inspection')} · ${data.passed} passed · ${data.failed} failed`}>
              {data.passRate === null ? (
                <span className="px-2 text-ink-3">—</span>
              ) : (
                <NumberButton value={data.finished} display={`${data.passRate}%`} label={`${data.passRate}% of items passed in ${plural(data.finished, 'finished inspection')}`} query={{ metric: 'inspections' }} onOpen={onOpen} />
              )}
            </Figure>
            <Figure label="Open follow-ups">
              <NumberButton value={data.openFollowUps} label={`${plural(data.openFollowUps, 'open follow-up task')}`} query={{ metric: 'follow-ups' }} onOpen={onOpen} />
            </Figure>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-ink">Most-failed items</h3>
              {data.topItems.length === 0 ? (
                <p className="rounded-lg bg-ground/60 px-3 py-3 text-sm text-ink-2">No item failed in this period.</p>
              ) : (
                <ol className="divide-y divide-line rounded-xl border border-line">
                  {data.topItems.map((i) => (
                    <li key={`${i.formId}|${i.itemId}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0">
                        <span dir="auto" className="block truncate text-sm font-medium text-ink">{i.label}</span>
                        <span dir="auto" className="block truncate text-xs text-ink-3">{i.formTitle}</span>
                      </span>
                      <NumberButton value={i.failures} label={`“${i.label}” failed ${plural(i.failures, 'time')}`} query={{ metric: 'failed-item', formId: i.formId ?? 'none', itemId: i.itemId }} onOpen={onOpen} tone="danger" suffix={<span className="text-xs font-normal text-ink-2">×</span>} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-ink">Forms with the most failed items</h3>
              {data.topForms.length === 0 ? (
                <p className="rounded-lg bg-ground/60 px-3 py-3 text-sm text-ink-2">No form had a failed item in this period.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {data.topForms.map((f) => (
                    <li key={f.formId ?? f.title} className="px-3 py-2">
                      <span dir="auto" className="block truncate text-sm font-medium text-ink">{f.title}</span>
                      <span className="block text-xs text-ink-2">
                        {plural(f.failedItems, 'failed item')} · {f.withFailures} of {plural(f.finished, 'inspection')} had a failure
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
