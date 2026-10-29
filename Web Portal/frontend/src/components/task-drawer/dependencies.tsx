import { useState } from 'react';
import { statusMeta } from '../../lib/taskStatus';
import { filterTasks } from '../../lib/task-picker';
import { ComboPicker } from './combo-picker';
import { failureMessage } from './save-state';

export interface DrawerTaskRef {
  id: string;
  key: string;
  title: string;
  /** Its current status (column) name and stage, when known. */
  statusName?: string;
  statusCategory?: string;
  done?: boolean;
}
export interface DrawerDependencies {
  blockedBy: DrawerTaskRef[];
  blocks: DrawerTaskRef[];
}

function Status({ t }: { t: DrawerTaskRef }) {
  if (!t.statusName) return null;
  return (
    <span className="inline-flex flex-none items-center gap-1 rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: statusMeta(t.statusCategory).color }} />
      {t.statusName}
    </span>
  );
}

function TaskLine({ t, onRemove }: { t: DrawerTaskRef; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-ground/70">
      {t.done ? (
        <span aria-hidden="true" className="text-success">✓</span>
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-warning" />
      )}
      <span className="flex-none font-mono text-xs text-ink-2">{t.key}</span>
      <span dir="auto" className={`min-w-0 flex-1 truncate ${t.done ? 'text-ink-3 line-through' : 'text-ink'}`} title={t.title}>
        {t.title}
      </span>
      <Status t={t} />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove blocker ${t.key}`}
          title="Remove"
          className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger sm:h-7 sm:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </li>
  );
}

/**
 * What this task waits on (and what waits on it): each with its status, a searchable picker to
 * add a blocker — never the task itself, one already linked, or one it blocks (that would be a
 * loop) — and the server's reason when a longer loop is refused.
 */
export function DependenciesSection({
  taskId,
  dependencies,
  availableTasks,
  onAdd,
  onRemove,
}: {
  taskId: string;
  dependencies: DrawerDependencies;
  availableTasks: DrawerTaskRef[];
  onAdd?: (dependsOnTaskId: string) => Promise<void> | void;
  onRemove?: (dependsOnTaskId: string) => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const exclude = new Set([taskId, ...dependencies.blockedBy.map((d) => d.id), ...dependencies.blocks.map((d) => d.id)]);
  const matches = filterTasks(availableTasks, query, exclude);
  const open = dependencies.blockedBy.filter((d) => !d.done).length;

  async function add(id: string) {
    if (!onAdd || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onAdd(id);
      setQuery('');
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t add the blocker.'));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setProblem(null);
    try {
      await onRemove?.(id);
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t remove the blocker.'));
    }
  }

  return (
    <section aria-labelledby="task-deps-heading">
      <h3 id="task-deps-heading" className="eyebrow mb-2">
        Dependencies
      </h3>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-2">Blocked by</p>
        {open > 0 ? (
          <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">{`Waiting on ${open} open ${open === 1 ? 'task' : 'tasks'}`}</span>
        ) : null}
      </div>
      {dependencies.blockedBy.length === 0 ? (
        <p className="mt-1 text-sm text-ink-3">Nothing is blocking this task.</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {dependencies.blockedBy.map((d) => (
            <TaskLine key={d.id} t={d} onRemove={onRemove ? () => void remove(d.id) : undefined} />
          ))}
        </ul>
      )}
      {onAdd ? (
        <div className="mt-2">
          <ComboPicker
            label="Add a blocking task"
            inline
            placeholder="Add a blocker — search by key or title…"
            query={query}
            onQuery={(q) => {
              setQuery(q);
              setProblem(null);
            }}
            disabled={busy}
            options={matches.map((t) => ({
              id: t.id,
              label: t.title,
              lead: <span className="flex-none font-mono text-xs text-ink-2">{t.key}</span>,
              trail: <Status t={t} />,
            }))}
            emptyText="No task matches (a task can’t block itself or one it already blocks)."
            onPick={(id) => void add(id)}
          />
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
          {problem}
        </p>
      ) : null}
      {dependencies.blocks.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-2">Blocks</p>
          <ul className="mt-1 flex flex-col">
            {dependencies.blocks.map((d) => (
              <TaskLine key={d.id} t={d} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
