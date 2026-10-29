import type { ManagementOverview } from '../../api/management';
import { EmptyState } from '../ui/EmptyState';
import { NumberButton, Section, plural, type OpenList } from './parts';

/**
 * Management: tasks waiting for approval — how many in all, and in each project shown (most first).
 * Every number opens the list of those tasks; each opens its task, whose panel has Approve and Send back.
 */
export function ApprovalsSection({ approvals, onOpen }: { approvals: NonNullable<ManagementOverview['approvals']>; onOpen: OpenList }) {
  const total = approvals.total;
  return (
    <Section
      id="mgmt-approvals"
      title="Waiting for approval"
      note="Tasks finished but not approved yet by whoever runs the project. They don’t count as done until then."
      action={
        <span className="text-sm text-ink-2">
          In all:{' '}
          <NumberButton value={total} label={plural(total, 'task') + ' waiting for approval'} query={{ metric: 'awaiting-approval' }} onOpen={onOpen} tone="warning" />
        </span>
      }
    >
      {approvals.projects.length === 0 ? (
        <EmptyState bare title="Nothing is waiting" description="No task in these projects is waiting for approval." />
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3" aria-label="Waiting for approval, by project">
          {approvals.projects.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-1.5 last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0">
              <span className="min-w-0 truncate text-sm text-ink" title={p.name}>
                <span className="me-1.5 font-mono text-[11px] text-ink-3">{p.code}</span>
                <bdi>{p.name}</bdi>
              </span>
              <NumberButton value={p.count} label={`${plural(p.count, 'task')} waiting for approval in ${p.name}`} query={{ metric: 'awaiting-approval', projectId: p.id }} onOpen={onOpen} tone="warning" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
