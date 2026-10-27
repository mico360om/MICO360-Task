import type { PersonRow } from '../../api/management';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { shortDay } from '../../lib/management';
import { NumberButton, Section, plural, type OpenList } from './parts';

/**
 * People and workload: who has late work, who is over the Workload page's daily limit on a working day
 * this week, and open meeting action items (with the overdue ones) — in the projects shown here.
 */
export function PeopleSection({ people, week, limit, onOpen }: { people: PersonRow[]; week: string; limit: number; onOpen: OpenList }) {
  const late = (p: PersonRow) => <NumberButton value={p.lateTasks} label={`${p.name}: ${plural(p.lateTasks, 'late task')}`} query={{ metric: 'late-tasks', personId: p.id }} onOpen={onOpen} tone="danger" />;
  const over = (p: PersonRow) => (
    <NumberButton value={p.overloadedDays.length} label={`${p.name}: ${plural(p.overloadedDays.length, 'day')} over the limit this week`} query={{ metric: 'person-overloaded', personId: p.id }} onOpen={onOpen} tone="danger" />
  );
  const days = (p: PersonRow) =>
    p.overloadedDays.length ? (
      <span className="text-xs text-ink-2">{p.overloadedDays.map((d) => `${shortDay(d.date)} (${d.count})`).join(', ')}</span>
    ) : null;
  const actions = (p: PersonRow) => (
    <NumberButton value={p.openActions} label={`${p.name}: ${plural(p.openActions, 'open action item')}${p.overdueActions ? `, ${p.overdueActions} overdue` : ''}`} query={{ metric: 'person-actions', personId: p.id }} onOpen={onOpen} />
  );
  const overdue = (p: PersonRow) => (p.overdueActions ? <span className="text-xs font-semibold text-danger">{p.overdueActions} overdue</span> : null);
  const who = (p: PersonRow) => (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={p.name} src={p.avatarUrl} size="sm" />
      <bdi className="truncate font-medium text-ink">{p.name}</bdi>
    </span>
  );

  return (
    <Section id="mgmt-people" title="People and workload" note={`This week from ${shortDay(week)}. Overloaded: more than ${limit} open tasks due on a working day (the Workload limit).`}>
      {people.length === 0 ? (
        <EmptyState bare title="Nobody is behind" description="Nobody has late work, an overloaded day or open action items in these projects." />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">People with late work, overloaded days or open action items</caption>
              <thead>
                <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="px-2 py-2 text-start">Person</th>
                  <th scope="col" className="px-2 py-2 text-center">Late tasks</th>
                  <th scope="col" className="px-2 py-2 text-start">Overloaded days</th>
                  <th scope="col" className="px-2 py-2 text-start">Open action items</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="max-w-[16rem] px-2 py-2">{who(p)}</td>
                    <td className="px-2 py-1.5 text-center">{late(p)}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">{over(p)}{days(p)}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">{actions(p)}{overdue(p)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label="People">
            {people.map((p) => (
              <li key={p.id} className="rounded-xl border border-line p-3">
                {who(p)}
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">Late tasks</dt>
                    <dd className="-ms-2">{late(p)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Overloaded</dt>
                    <dd className="-ms-2">{over(p)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Actions</dt>
                    <dd className="-ms-2">{actions(p)}</dd>
                  </div>
                </dl>
                {days(p) || overdue(p) ? <p className="mt-1 flex flex-wrap gap-x-2">{days(p)}{overdue(p)}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
