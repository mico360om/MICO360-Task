import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ApiTask, Priority, RecurrenceRule } from '../../api/tasks';
import { statusMeta } from '../../lib/taskStatus';
import { dueInputValue, formatDueDay, isTaskDone } from '../../lib/due-display';
import { isOverdue } from '../../lib/due-date';
import { RecurrenceEditor } from '../RecurrenceEditor';
import { Avatar } from '../ui/Avatar';
import { PriorityBadge } from '../ui/PriorityBadge';
import { ComboPicker } from './combo-picker';
import { SaveIndicator, failureMessage, useSaveState } from './save-state';

export interface DrawerAssignee {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
export interface DrawerStatusColumn {
  id: string;
  name: string;
  category: string;
}
export type FieldPatch = { title?: string; description?: string; priority?: Priority; dueDate?: string | null };

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const PRIORITY_DOT: Record<Priority, string> = {
  LOW: 'rgb(var(--c-ink-3))',
  NORMAL: 'rgb(var(--c-info))',
  HIGH: 'rgb(var(--c-warning))',
  URGENT: 'rgb(var(--c-danger))',
};

export const Sparkle = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" />
  </svg>
);

const selectClass =
  'h-10 w-full appearance-none rounded-lg border border-line bg-surface ps-8 pe-8 text-sm text-ink outline-none transition-colors hover:border-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 sm:h-9';
const Chevron = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-3">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const Dot = ({ color }: { color: string }) => (
  <span aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: color }} />
);

/** One labelled property: label on the left (above it on a narrow card), control and its save state. */
function Row({ label, labelFor, children }: { label: string; labelFor?: string; children: ReactNode }) {
  const name = labelFor ? (
    <label htmlFor={labelFor} className="text-xs font-medium text-ink-2">
      {label}
    </label>
  ) : (
    <span className="text-xs font-medium text-ink-2">{label}</span>
  );
  // Label beside the value; when there is too little room for the value (a narrow panel, large text)
  // it moves under its label instead of being squeezed.
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
      <div className="w-24 flex-none pt-2.5 sm:pt-2">{name}</div>
      <div className="min-w-[10rem] flex-1">{children}</div>
    </div>
  );
}

function StatusField({ task, columns, onChange }: { task: ApiTask; columns: DrawerStatusColumn[]; onChange?: (columnId: string) => Promise<void> | void }) {
  const save = useSaveState();
  const id = useId();
  const [value, setValue] = useState(task.columnId);
  useEffect(() => setValue(task.columnId), [task.columnId]);
  const current = columns.find((c) => c.id === value);
  const meta = statusMeta(current?.category ?? task.columnCategory);
  if (!onChange || columns.length === 0) {
    return (
      <Row label="Status">
        <span className="inline-flex h-9 items-center gap-2 text-sm text-ink">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} aria-hidden />
          {meta.label}
        </span>
      </Row>
    );
  }
  return (
    <Row label="Status" labelFor={id}>
      <div className="relative">
        <Dot color={meta.color} />
        <select
          id={id}
          aria-label="Status"
          value={value}
          disabled={save.busy}
          onChange={async (e) => {
            const next = e.target.value;
            setValue(next);
            if (!(await save.run(() => onChange(next)))) setValue(task.columnId);
          }}
          className={selectClass}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
      <SaveIndicator state={save.state} />
    </Row>
  );
}

function PriorityField({
  priority,
  onSave,
  onSuggest,
}: {
  priority: Priority;
  onSave?: (p: Priority) => Promise<void> | void;
  onSuggest?: () => Promise<{ priority: Priority; reason: string }>;
}) {
  const save = useSaveState();
  const id = useId();
  const [value, setValue] = useState<Priority>(priority);
  useEffect(() => setValue(priority), [priority]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ priority: Priority; reason: string } | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function apply(next: Priority) {
    setValue(next);
    if (!(await save.run(() => onSave?.(next)))) setValue(priority);
  }
  async function suggest() {
    if (!onSuggest || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    try {
      setSuggestion(await onSuggest());
    } catch (err) {
      setSuggestError(failureMessage(err, 'The AI suggestion failed.'));
    } finally {
      setSuggesting(false);
    }
  }

  if (!onSave) {
    return (
      <Row label="Priority">
        <div className="flex h-9 items-center">
          <PriorityBadge priority={priority} />
        </div>
      </Row>
    );
  }
  return (
    <Row label="Priority" labelFor={id}>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Dot color={PRIORITY_DOT[value]} />
          <select id={id} aria-label="Priority" value={value} disabled={save.busy} onChange={(e) => void apply(e.target.value as Priority)} className={selectClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
        {onSuggest ? (
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={suggesting}
            aria-label="Suggest priority with AI"
            title="Suggest a priority with AI"
            className="inline-flex h-10 flex-none items-center gap-1 rounded-lg border border-line px-2 text-[11px] font-semibold text-brand transition-colors hover:border-brand disabled:opacity-60 sm:h-9"
          >
            {suggesting ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : <Sparkle />}
            AI
          </button>
        ) : null}
      </div>
      {suggestion ? (
        <div className="mt-2 rounded-lg border border-brand/30 bg-brand/5 p-2.5 text-xs">
          <p className="flex items-start gap-1.5 text-ink">
            <span className="mt-px text-brand">
              <Sparkle />
            </span>
            <span>
              {suggestion.priority === value ? (
                <>
                  AI agrees: <strong>{PRIORITY_LABEL[suggestion.priority]}</strong> is right.{' '}
                </>
              ) : (
                <>
                  AI suggests <strong>{PRIORITY_LABEL[suggestion.priority]}</strong>.{' '}
                </>
              )}
              <span className="text-ink-2">{suggestion.reason}</span>
            </span>
          </p>
          {suggestion.priority === value ? (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setSuggestion(null)} className="h-8 rounded-md px-2.5 font-medium text-ink-2 hover:bg-ground">
                OK
              </button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                aria-label={`Apply ${PRIORITY_LABEL[suggestion.priority]}`}
                onClick={() => {
                  const next = suggestion.priority;
                  setSuggestion(null);
                  void apply(next);
                }}
                className="h-8 rounded-md bg-brand px-2.5 font-semibold text-white hover:bg-brand-2"
              >
                Apply
              </button>
              <button type="button" onClick={() => setSuggestion(null)} className="h-8 rounded-md px-2.5 text-ink-2 hover:bg-ground">
                Dismiss
              </button>
            </div>
          )}
        </div>
      ) : null}
      {suggestError ? (
        <p role="alert" className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">
          {suggestError}
        </p>
      ) : null}
      <SaveIndicator state={save.state} />
    </Row>
  );
}

function DueDateField({ task, timeZone, onSave }: { task: ApiTask; timeZone: string; onSave?: (dueDate: string | null) => Promise<void> | void }) {
  const save = useSaveState();
  const id = useId();
  const stored = dueInputValue(task.dueDate, timeZone);
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [stored]);
  const overdue = !isTaskDone(task) && isOverdue(task.dueDate, timeZone);

  async function apply(next: string) {
    setValue(next);
    if (!(await save.run(() => onSave?.(next || null)))) setValue(stored);
  }

  if (!onSave) {
    return (
      <Row label="Due date">
        <span className={`inline-flex h-9 items-center gap-2 text-sm ${overdue ? 'font-semibold text-danger' : 'text-ink'}`}>
          {formatDueDay(task.dueDate, timeZone) || 'No due date'}
          {overdue ? <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">Overdue</span> : null}
        </span>
      </Row>
    );
  }
  return (
    <Row label="Due date" labelFor={id}>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="date"
          aria-label="Due date"
          aria-invalid={overdue || undefined}
          aria-describedby={overdue ? `${id}-overdue` : undefined}
          value={value}
          disabled={save.busy}
          onChange={(e) => void apply(e.target.value)}
          className={`h-10 min-w-0 flex-1 rounded-lg border bg-surface px-3 text-sm outline-none transition-colors focus:ring-2 sm:h-9 ${overdue ? 'border-danger font-semibold text-danger focus:ring-danger/20' : 'border-line text-ink hover:border-ink-3 focus:border-brand focus:ring-brand/20'}`}
        />
        {value ? (
          <button
            type="button"
            onClick={() => void apply('')}
            disabled={save.busy}
            aria-label="Clear due date"
            title="Clear due date"
            className="grid h-10 w-10 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-danger sm:h-9 sm:w-9"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
      {overdue ? (
        <p id={`${id}-overdue`} className="mt-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">
          Overdue
        </p>
      ) : null}
      <SaveIndicator state={save.state} />
    </Row>
  );
}

function RepeatField({ task, timeZone, onSet }: { task: ApiTask; timeZone: string; onSet: (rule: RecurrenceRule | null) => Promise<void> | void }) {
  const save = useSaveState();
  return (
    <Row label="Repeat">
      {!task.recurrenceNextId ? (
        <RecurrenceEditor compact value={task.recurrenceRule ?? null} onChange={(rule) => void save.run(() => onSet(rule))} dueDate={dueInputValue(task.dueDate, timeZone)} />
      ) : (
        // Repeating an earlier copy would start a second, parallel series.
        <p className="pt-2 text-xs text-ink-2">An earlier copy of a repeating series — change the repeat on its newest copy.</p>
      )}
      <SaveIndicator state={save.state} />
    </Row>
  );
}

function AssigneesField({
  assignees,
  assignable,
  onAssign,
  onUnassign,
}: {
  assignees: DrawerAssignee[];
  assignable: DrawerAssignee[];
  onAssign?: (userId: string) => Promise<void> | void;
  onUnassign?: (userId: string) => Promise<void> | void;
}) {
  const save = useSaveState();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const assigned = new Set(assignees.map((a) => a.id));
  const q = query.trim().toLowerCase();
  const matches = assignable.filter((u) => !assigned.has(u.id) && (!q || u.name.toLowerCase().includes(q)));
  return (
    <Row label="Assignees">
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {assignees.length === 0 ? <span className="text-sm text-ink-3">Unassigned</span> : null}
        {assignees.map((a) => (
          <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 ps-0.5 pe-1 text-xs text-ink">
            <Avatar name={a.name} size="sm" src={a.avatarUrl} />
            <span dir="auto" className="truncate">
              {a.name}
            </span>
            {onUnassign ? (
              <button
                type="button"
                onClick={() => void save.run(() => onUnassign(a.id))}
                aria-label={`Remove ${a.name}`}
                title={`Remove ${a.name}`}
                className="grid h-7 w-7 flex-none place-items-center rounded-full text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger sm:h-5 sm:w-5"
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {onAssign && !picking ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand sm:h-7"
          >
            <span aria-hidden="true">+</span> Add assignee
          </button>
        ) : null}
      </div>
      {picking && onAssign ? (
        <div className="mt-2 rounded-lg border border-line bg-ground/50 p-2">
          <ComboPicker
            label="Find a teammate"
            placeholder="Search by name…"
            query={query}
            onQuery={setQuery}
            alwaysOpen
            autoFocus
            options={matches.map((u) => ({ id: u.id, label: u.name, lead: <span aria-hidden="true" className="flex"><Avatar name={u.name} size="sm" src={u.avatarUrl} /></span> }))}
            emptyText={assignable.length === assigned.size ? 'Everyone on the project is assigned.' : 'No teammate matches.'}
            onPick={(userId) => {
              setQuery('');
              void save.run(() => onAssign(userId));
            }}
            onClose={() => setPicking(false)}
          />
          <button type="button" onClick={() => { setPicking(false); setQuery(''); }} className="mt-1.5 h-8 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-ground">
            Done
          </button>
        </div>
      ) : null}
      <SaveIndicator state={save.state} />
    </Row>
  );
}

/** The task's properties card: status, priority, due date, repeat and assignees, each saved as it changes. */
export function PropertiesPanel({
  task,
  timeZone,
  statusColumns,
  onChangeStatus,
  onSaveField,
  onSuggestPriority,
  onSetRecurrence,
  assignees,
  assignableUsers,
  onAssignUser,
  onUnassignUser,
  inSeries,
  scope,
  onScope,
}: {
  task: ApiTask;
  timeZone: string;
  statusColumns: DrawerStatusColumn[];
  onChangeStatus?: (columnId: string) => Promise<void> | void;
  onSaveField?: (patch: FieldPatch) => Promise<void> | void;
  onSuggestPriority?: () => Promise<{ priority: Priority; reason: string }>;
  onSetRecurrence?: (rule: RecurrenceRule | null) => Promise<void> | void;
  assignees?: DrawerAssignee[];
  assignableUsers: DrawerAssignee[];
  onAssignUser?: (userId: string) => Promise<void> | void;
  onUnassignUser?: (userId: string) => Promise<void> | void;
  inSeries: boolean;
  scope: 'one' | 'series';
  onScope: (scope: 'one' | 'series') => void;
}) {
  return (
    <section aria-labelledby="task-props-heading" className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <h3 id="task-props-heading" className="eyebrow mb-1">
        Details
      </h3>
      {inSeries && onSaveField ? (
        <fieldset className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-ground/60 px-2.5 py-2 text-xs">
          <legend className="sr-only">Apply edits to</legend>
          <span aria-hidden="true" className="font-medium text-ink-2">
            Edits apply to
          </span>
          {(['one', 'series'] as const).map((s) => (
            <label key={s} className="inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 text-ink">
              <input type="radio" name="task-edit-scope" checked={scope === s} onChange={() => onScope(s)} className="accent-brand" />
              {s === 'one' ? 'This task' : 'Entire series'}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="divide-y divide-line/60">
        <StatusField task={task} columns={statusColumns} onChange={onChangeStatus} />
        <PriorityField priority={task.priority} onSave={onSaveField ? (priority) => onSaveField({ priority }) : undefined} onSuggest={onSaveField ? onSuggestPriority : undefined} />
        <DueDateField task={task} timeZone={timeZone} onSave={onSaveField ? (dueDate) => onSaveField({ dueDate }) : undefined} />
        {onSetRecurrence ? <RepeatField task={task} timeZone={timeZone} onSet={onSetRecurrence} /> : null}
        {assignees ? <AssigneesField assignees={assignees} assignable={assignableUsers} onAssign={onAssignUser} onUnassign={onUnassignUser} /> : null}
      </div>
    </section>
  );
}
