import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HealthRow, ItemQuery, RagReason } from '../../api/management';
import { ProjectAvatar } from '../ProjectAvatar';
import { EmptyState } from '../ui/EmptyState';
import { STATUS_LABEL, idleText, milestoneText } from '../../lib/management';
import { ListButton, NumberButton, RagMark, Section, plural, type OpenList } from './parts';

type Sort = 'worst' | 'name' | 'late' | 'done';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'worst', label: 'Worst first' },
  { value: 'late', label: 'Most late tasks' },
  { value: 'done', label: 'Least done' },
  { value: 'name', label: 'Name' },
];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** 44px on touch screens (the global rule makes them only 32px). */
const TOUCH = '[@media(pointer:coarse)]:!min-h-11';

function sortRows(rows: HealthRow[], sort: Sort): HealthRow[] {
  if (sort === 'worst') return rows; // the server's order: red, amber, green; then most late; then name
  const copy = [...rows];
  if (sort === 'name') return copy.sort((a, b) => collator.compare(a.name, b.name));
  if (sort === 'late') return copy.sort((a, b) => b.late - a.late || collator.compare(a.name, b.name));
  return copy.sort((a, b) => a.completionPct - b.completionPct || collator.compare(a.name, b.name));
}

/** The list a reason is about, if it has one. */
function reasonList(code: RagReason['code'], projectId: string): ItemQuery | null {
  if (code === 'MILESTONE_LATE') return { metric: 'late-milestones', projectId };
  if (code === 'MANY_LATE' || code === 'LATE_TASKS') return { metric: 'late-tasks', projectId };
  if (code === 'MANY_MISSING_CHECKS' || code === 'MISSING_CHECKS') return { metric: 'missing-checks', projectId };
  return null;
}

function Milestone({ row, onOpen, onOpenTask }: { row: HealthRow; onOpen: OpenList; onOpenTask: (id: string) => void }) {
  const m = row.nextMilestone;
  if (!m) return <span className="text-ink-3">—</span>;
  const late = m.daysLeft !== null && m.daysLeft < 0;
  return (
    <span className="block min-w-0">
      <button type="button" onClick={() => onOpenTask(m.id)} className={`block min-w-0 max-w-full text-start hover:underline ${TOUCH}`}>
        <span className="block truncate font-medium text-ink" title={m.title}>
          <bdi>{m.title}</bdi>
        </span>
      </button>
      {late ? (
        <ListButton label={`Late milestones in ${row.name}`} query={{ metric: 'late-milestones', projectId: row.id }} onOpen={onOpen} className="text-xs font-semibold text-danger">
          {milestoneText(m)}
        </ListButton>
      ) : (
        <span className="block text-xs text-ink-2">{milestoneText(m)}</span>
      )}
    </span>
  );
}

function Reasons({ row, onOpen }: { row: HealthRow; onOpen: OpenList }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {row.reasons.map((r) => {
        const tone = r.level === 'RED' ? 'text-danger' : r.level === 'AMBER' ? 'text-warning' : 'text-ink-2';
        const query = reasonList(r.code, row.id);
        return (
          <li key={r.code + r.text} className={tone}>
            {query ? (
              <ListButton label={r.text} query={query} onOpen={onOpen}>
                <bdi>{r.text}</bdi>
              </ListButton>
            ) : (
              <bdi>{r.text}</bdi>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DoneBar({ pct }: { pct: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-9 text-end tabular-nums text-ink">{pct}%</span>
      <span aria-hidden="true" className="h-1.5 w-14 overflow-hidden rounded-full bg-ground">
        <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/**
 * Project health: every project's mark (a word and a dot) with its reasons, % done, late tasks, the
 * next milestone, missing checks and the last activity — worst first. A table on wide screens (1280 and
 * up, where all eight columns fit beside the menu), cards below that (a phone, a tablet, a laptop, a
 * narrow window). Every count opens the list behind it.
 */
export function HealthSection({
  rows,
  today,
  timeZone,
  onOpen,
  onOpenTask,
  chosenHidden,
}: {
  rows: HealthRow[];
  today: string;
  timeZone: string;
  onOpen: OpenList;
  onOpenTask: (id: string) => void;
  /** Projects were chosen, but the status filter leaves them out. */
  chosenHidden?: boolean;
}) {
  const [sort, setSort] = useState<Sort>('worst');
  const shown = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const late = (r: HealthRow) => (
    <NumberButton value={r.late} label={`${plural(r.late, 'late task')} in ${r.name}`} query={{ metric: 'late-tasks', projectId: r.id }} onOpen={onOpen} tone="danger" />
  );
  const missing = (r: HealthRow) => (
    <NumberButton value={r.missingChecks} label={`${plural(r.missingChecks, 'missing check')} in ${r.name}`} query={{ metric: 'missing-checks', projectId: r.id }} onOpen={onOpen} tone="danger" />
  );
  const name = (r: HealthRow) => (
    <Link to={`/projects/${encodeURIComponent(r.id)}`} className={`flex min-w-0 items-center gap-2 hover:underline ${TOUCH}`}>
      <ProjectAvatar project={r} size="sm" />
      <span className="min-w-0">
        <span className="line-clamp-2 font-semibold text-ink" title={r.name}>
          <bdi>{r.name}</bdi>
        </span>
        <span className="block truncate text-xs text-ink-3">
          {r.code} · {STATUS_LABEL[r.status]}
          {r.owner ? <> · <bdi>{r.owner.name}</bdi></> : null}
        </span>
      </span>
    </Link>
  );

  return (
    <Section
      id="mgmt-health"
      title="Project health"
      note="Red: a milestone is late, a quarter or more of the open tasks are late (at least 3), or 3 or more checks are missing. Amber: any late task or missing check, or an active project with no change for 14 days."
      action={
        rows.length > 1 ? (
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink ${TOUCH}`}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          bare
          title="No projects to show"
          description={
            chosenHidden
              ? 'The projects you chose have a status the filter leaves out. Tick their status, or clear the filters.'
              : 'No project matches these filters. Choose other statuses or projects, or clear the filters.'
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Project health, {SORTS.find((s) => s.value === sort)!.label.toLowerCase()}</caption>
              <thead>
                <tr className="border-b border-line text-start text-xs font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="px-2 py-2 text-start">Mark</th>
                  <th scope="col" className="px-2 py-2 text-start">Project</th>
                  <th scope="col" className="px-2 py-2 text-end">Done</th>
                  <th scope="col" className="px-2 py-2 text-center">Late</th>
                  <th scope="col" className="px-2 py-2 text-start">Next milestone</th>
                  <th scope="col" className="px-2 py-2 text-center">Missing checks</th>
                  <th scope="col" className="px-2 py-2 text-start">Last activity</th>
                  <th scope="col" className="px-2 py-2 text-start">Why</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-0">
                    <td className="px-2 py-2.5"><RagMark rag={r.rag} /></td>
                    <td className="max-w-[16rem] px-2 py-2">{name(r)}</td>
                    <td className="px-2 py-2.5"><DoneBar pct={r.completionPct} /></td>
                    <td className="px-2 py-1.5 text-center">{late(r)}</td>
                    <td className="max-w-[12rem] px-2 py-2"><Milestone row={r} onOpen={onOpen} onOpenTask={onOpenTask} /></td>
                    <td className="px-2 py-1.5 text-center">{missing(r)}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-ink-2">{idleText(r.lastActivityAt, today, timeZone)}</td>
                    <td className="min-w-[10rem] px-2 py-2.5"><Reasons row={r} onOpen={onOpen} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2 xl:hidden" aria-label="Projects">
            {shown.map((r) => (
              <li key={r.id} className="min-w-0 rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  {name(r)}
                  <RagMark rag={r.rag} />
                </div>
                <div className="mt-2"><Reasons row={r} onOpen={onOpen} /></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">Done</dt>
                    <dd><DoneBar pct={r.completionPct} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Last activity</dt>
                    <dd className="text-ink-2">{idleText(r.lastActivityAt, today, timeZone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Late tasks</dt>
                    <dd className="-ms-2">{late(r)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Missing checks</dt>
                    <dd className="-ms-2">{missing(r)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-ink-3">Next milestone</dt>
                    <dd><Milestone row={r} onOpen={onOpen} onOpenTask={onOpenTask} /></dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
